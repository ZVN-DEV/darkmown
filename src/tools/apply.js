// ---------------------------------------------------------------------------
// TOOL: apply(files, entry, edits)
//
// Applies targeted edits to one file and hands back the new content. It does not
// write anything and does not compile: the caller applies, then validates, so a
// rejected edit costs nothing.
//
// WHY THERE ARE THREE WAYS TO SAY WHERE
//
// The obvious design is anchored edits only, ruling out line numbers because
// "small models cannot count lines and a stale number silently corrupts a
// file". The first half of that is the wrong worry and the second half is real
// but fixable.
//
// Measured across file sizes, quoting a line back verbatim gets HARDER as a
// file grows, and the anchor is where anchored editing dies: it accounts for
// 42% of failed tasks at 16 lines and 67% at 244. The model is not failing to
// count. It is failing to recall a string it read once.
//
// So this tool accepts three ways to say where, and the model is expected to use
// whichever the previous tool call already handed it:
//
//   { anchor: "…" }   verbatim source text, must appear exactly once
//   { line: 7 }       a line number, as printed by `outline`
//   { symbol: "cart" } a declaration, as named by `outline` / `refs`
//
// The objection to line numbers was staleness, and staleness is what the design
// prevents rather than what it ignores: every target is resolved against the
// snapshot passed to THIS call, all edits in a call are applied against that one
// snapshot in descending line order, and a `line` target must still contain what
// the caller expected if it says so. The model is never counting; it is quoting
// a number a tool just printed.
// ---------------------------------------------------------------------------

import { symbolsOf } from "./outline.js";
import { shortPath } from "./validate.js";

/** The operations a caller may ask for. Closed, and validated per edit. */
export const OPS = new Set(["replace", "insert_after", "insert_before", "delete"]);

/**
 * One edit, as a caller (or a model) writes it.
 *
 * Every field is optional because a malformed edit is REPORTED, not thrown: the
 * whole point of this surface is that a model gets a sentence back telling it
 * what to fix. Typing them as required would describe a contract this module
 * deliberately does not enforce at the boundary.
 *
 * @typedef {object} Edit
 * @property {string} [op] One of {@link OPS}.
 * @property {number} [line] 1-based line, as printed by `outline`.
 * @property {string} [symbol] A symbol target, e.g. `state:cart`.
 * @property {string} [anchor] Exact source text to find.
 * @property {string} [text] Replacement or inserted text.
 * @property {string} [expect] What the caller believed is at `line`, for staleness.
 */

/** Symbol kinds that DEFINE the name they carry, as opposed to referencing it. */
const DECLARING_KINDS = new Set([
  "state",
  "store",
  "computed",
  "theme",
  "fetch",
  "form",
  "field",
  "loop"
]);

/**
 * Resolve one edit's target to a 1-based inclusive line range in `source`.
 *
 * Every rejection names what was wrong AND what would have worked, because a
 * rejection a model cannot act on is just a failed attempt.
 *
 * @param {string} source
 * @param {Edit} edit
 * @param {import("../compiler/context.js").Symbol[]} symbols
 * @returns {{ok: true, from: number, to: number} | {ok: false, error: string}}
 */
export function resolveTarget(source, edit, symbols) {
  const lines = source.split("\n");

  if (typeof edit.line === "number") {
    if (!Number.isInteger(edit.line) || edit.line < 1 || edit.line > lines.length) {
      return {
        ok: false,
        error: `line ${edit.line} is outside the file, which has ${lines.length} lines. To add something at the end, use {"op": "insert_after", "line": ${lines.length}}.`
      };
    }
    // Optional belt and braces: if the caller says what it expected to find, a
    // snapshot that moved under it is caught here instead of corrupting the file.
    if (typeof edit.expect === "string" && !lines[edit.line - 1].includes(edit.expect)) {
      return {
        ok: false,
        error: `line ${edit.line} is "${lines[edit.line - 1].trim()}", not the expected "${edit.expect}". Run outline again; the file has changed.`
      };
    }
    return { ok: true, from: edit.line, to: edit.line };
  }

  if (typeof edit.symbol === "string") {
    // `state:cart` disambiguates when a name is both declared and looped.
    const [maybeKind, maybeName] = edit.symbol.includes(":")
      ? edit.symbol.split(":")
      : [null, edit.symbol];
    // Unqualified means "where this is DECLARED". A read or a conditional that
    // mentions the name is a reference, not a definition, and is targeted by the
    // line `refs` prints for it. Without this, the most natural target form is
    // ambiguous on every page that both declares and uses a symbol, which is
    // every page worth editing.
    const candidates = symbols.filter(
      (s) => s.line != null && s.name === maybeName && (!maybeKind || s.kind === maybeKind)
    );
    const hits = maybeKind ? candidates : candidates.filter((s) => DECLARING_KINDS.has(s.kind));
    if (hits.length === 0) {
      const known = [
        ...new Set(symbols.filter((s) => s.line != null).map((s) => `${s.kind}:${s.name}`))
      ].sort();
      return {
        ok: false,
        error: `no symbol "${edit.symbol}". This file declares: ${known.join(", ") || "nothing"}`
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        error: `"${edit.symbol}" is ambiguous: ${hits.map((h) => `${h.kind}:${h.name} at line ${h.line}`).join(", ")}. Qualify it as kind:name, or use a line.`
      };
    }
    // A block directive spans its whole construct. Replacing a `@loop` means
    // replacing the loop, not decapitating it and stranding the `@endloop`,
    // which was the most common compile failure of the round-4 tool run.
    // `line` is nullable on a Symbol (a prose read the compiler could not
    // locate), but a definition hit always has one, and an unlocatable symbol
    // is not addressable anyway.
    const at = hits[0].line;
    if (at == null) {
      return { ok: false, error: `"${edit.symbol}" has no line to address; use an anchor.` };
    }
    return { ok: true, from: at, to: hits[0].endLine ?? at };
  }

  if (typeof edit.anchor === "string") {
    const anchor = edit.anchor.replace(/\n+$/, "");
    if (!anchor.trim()) return { ok: false, error: "an empty anchor matches nothing" };
    const anchorLines = anchor.split("\n");
    /** @type {number[]} */
    const starts = [];
    for (let i = 0; i + anchorLines.length <= lines.length; i++) {
      if (anchorLines.every((a, k) => lines[i + k] === a)) starts.push(i + 1);
    }
    if (starts.length === 0) {
      return {
        ok: false,
        error: `that anchor is not in the file, character for character. Use outline to get a line number instead of quoting.`
      };
    }
    if (starts.length > 1) {
      return {
        ok: false,
        error: `that anchor appears ${starts.length} times (lines ${starts.join(", ")}). Add a neighbouring line to make it unique, or use a line number.`
      };
    }
    return { ok: true, from: starts[0], to: starts[0] + anchorLines.length - 1 };
  }

  return {
    ok: false,
    error: `this edit says nothing about where it goes. Give one of: {"line": 7}, {"symbol": "cart"}, or {"anchor": "the exact source line"}.`
  };
}

/**
 * TOOL ENTRY POINT.
 *
 * @param {Record<string, string>} files
 * @param {string} entry File to edit, in the same key form as `files`.
 * @param {Edit[]} [edits] Missing or empty is reported, not thrown.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function apply(files, entry, edits) {
  if (!files || !(entry in files)) {
    return { ok: false, text: `no such file "${shortPath(entry)}" in this project`, data: {} };
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, text: "apply needs a non-empty list of edits", data: {} };
  }

  const source = files[entry];
  // The symbol table is only needed for `symbol:` targets, and a file that does
  // not compile still has anchors and line numbers. So a compile failure here is
  // not fatal: it only removes the symbol vocabulary.
  const got = symbolsOf(files, entry);
  const symbols = got.ok ? got.symbols.filter((s) => s.file === entry) : [];

  /** @type {{from: number, to: number, edit: Edit}[]} */
  const resolved = [];
  for (const [i, edit] of edits.entries()) {
    if (!edit?.op || !OPS.has(edit.op)) {
      return {
        ok: false,
        text: `edit ${i + 1}: unknown op "${edit?.op}". Use one of: ${[...OPS].join(", ")}`,
        data: {}
      };
    }
    if (edit.op !== "delete" && typeof edit.text !== "string") {
      return { ok: false, text: `edit ${i + 1}: ${edit.op} needs "text"`, data: {} };
    }
    if (typeof edit.symbol === "string" && !got.ok) {
      return {
        ok: false,
        text: `edit ${i + 1}: cannot use a symbol target because the file does not compile (${got.error}). Fix the error first, or target a line.`,
        data: {}
      };
    }
    const target = resolveTarget(source, edit, symbols);
    if (!target.ok) return { ok: false, text: `edit ${i + 1}: ${target.error}`, data: {} };
    resolved.push({ from: target.from, to: target.to, edit });
  }

  // Overlap is a caller bug that would otherwise produce a plausible-looking but
  // wrong file, which is the single worst outcome for an automated loop.
  const ordered = [...resolved].sort((a, b) => a.from - b.from);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].from <= ordered[i - 1].to) {
      return {
        ok: false,
        text: `two edits target overlapping lines (${ordered[i - 1].from}-${ordered[i - 1].to} and ${ordered[i].from}-${ordered[i].to}). Combine them into one edit.`,
        data: {}
      };
    }
  }

  // Descending, so an earlier edit never shifts a later one's line numbers.
  const lines = source.split("\n");
  for (const { from, to, edit } of [...resolved].sort((a, b) => b.from - a.from)) {
    const body = edit.op === "delete" ? [] : (edit.text ?? "").replace(/\n$/, "").split("\n");
    if (edit.op === "replace" || edit.op === "delete")
      lines.splice(from - 1, to - from + 1, ...body);
    else if (edit.op === "insert_after") lines.splice(to, 0, ...body);
    else lines.splice(from - 1, 0, ...body);
  }

  const content = lines.join("\n");
  const changed = countChanged(source, content);
  return {
    ok: true,
    text: `applied ${resolved.length} edit${resolved.length === 1 ? "" : "s"} to ${shortPath(entry)} (${changed} line${changed === 1 ? "" : "s"} differ)`,
    data: { content, files: { ...files, [entry]: content }, edits: resolved.length, changed }
  };
}

/**
 * How many lines differ, as a blunt blast-radius signal for the caller.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function countChanged(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  let same = 0;
  const pool = [...y];
  for (const line of x) {
    const i = pool.indexOf(line);
    if (i !== -1) {
      same++;
      pool.splice(i, 1);
    }
  }
  return Math.max(x.length, y.length) - same;
}
