// ---------------------------------------------------------------------------
// TOOLS: outline(files, entry) and refs(files, entry, name)
//
// `outline` answers "what is in this page, and where", as a flat list of
// declarations with real line numbers. `refs` answers "if I change this symbol,
// what else moves", which is the query that turns a one-edit model into a
// multi-edit one.
//
// Both are built on the symbol table `compileFromMemory` now returns, which the
// compiler's own directive handlers record as they parse. There is no second
// parser here on purpose: a parser beside the compiler drifts, and the day it
// disagrees is the day a model is told something true about a file that will not
// compile.
//
// The one thing the compiler cannot cheaply supply is a line number for a `{ … }`
// binding in prose, because markdown is rendered a chunk at a time with no line
// index in scope. The compiler records those reads WITHOUT a line but WITH the
// exact expression text, and this module locates them by searching the source
// for that compiler-supplied string. That is a substring search for a known
// needle, not a parse: the compiler still decides what is true.
// ---------------------------------------------------------------------------

import { compileFromMemory } from "../compiler.js";
import { shortPath } from "./validate.js";

/** Longest a `detail` may be before it is elided. A multi-line JSON seed is
 *  otherwise the widest thing in the outline and tells the model nothing. */
const DETAIL_MAX = 52;

/**
 * @param {string} s
 * @returns {string}
 */
function short(s) {
  const one = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > DETAIL_MAX ? `${one.slice(0, DETAIL_MAX - 1)}…` : one;
}

/**
 * Map a symbol's absolute compile path back to the caller's own file key.
 * The virtual root is an implementation detail of `compileFromMemory`; a model
 * that never saw `/site/pages/` must not be handed it back.
 * @param {string} abs
 * @param {Record<string, string>} files
 * @returns {string}
 */
function fileKeyOf(abs, files) {
  const want = String(abs).replace(/^\//, "");
  return Object.keys(files).find((k) => k.replace(/^\//, "") === want) ?? want;
}

/**
 * Resolve the line(s) a line-less read sits on, by finding the compiler's own
 * expression text in the source.
 *
 * Matches only inside a `{ … }` binding, comparing the brace's whole trimmed
 * contents to the expression. A bare substring search is not good enough and the
 * failure is not theoretical: searching for `count` matched the heading "Click
 * counter", its own `:state count = 0` declaration, and the `count++` inside a
 * button, turning one real read into four. Anything a tool reports has to be
 * something the model can act on.
 *
 * A binding repeated on several lines is several reads, so every match is
 * returned rather than just the first.
 *
 * @param {string} source
 * @param {string} expr
 * @returns {number[]} 1-based lines.
 */
function locate(source, expr) {
  const needle = norm(expr);
  if (!needle) return [];
  /** @type {number[]} */
  const out = [];
  source.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\{([^{}]*)\}/g)) {
      if (norm(m[1]) === needle) {
        out.push(i + 1);
        break;
      }
    }
  });
  return out;
}

/**
 * Collapse whitespace so `{ cart | count }` and `{cart|count}` compare equal.
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Compile and return one symbol per source construct, with every line resolved.
 *
 * Two foldings happen here, both forced by how the compiler works rather than by
 * taste. A statically-unrolled `@loop` recompiles its body once per row, so a
 * directive inside it records N identical symbols at one `file:line`; and a prose
 * read inside such a loop records N line-less reads. Both collapse to one.
 *
 * The `compiled` half is the compiler's own result, derived from the function
 * rather than restated here: widening it to `object` compiled fine while these
 * lived under bench/, and silently lost every property check the moment they
 * became part of the package.
 *
 * @typedef {ReturnType<typeof compileFromMemory>} Compiled
 * @typedef {import("../compiler/context.js").Symbol} Symbol
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: true, symbols: Symbol[], compiled: Compiled} | {ok: false, error: string}}
 */
export function symbolsOf(files, entry) {
  if (!files || !entry || !(entry in files)) {
    return { ok: false, error: `no such file "${shortPath(entry)}" in this project` };
  }
  let compiled;
  try {
    compiled = compileFromMemory(files, entry);
  } catch (err) {
    return { ok: false, error: String(/** @type {any} */ (err)?.message ?? err) };
  }

  const seen = new Set();
  /** @type {Symbol[]} */
  const symbols = [];
  for (const sym of compiled.symbols ?? []) {
    const file = fileKeyOf(sym.file ?? entry, files);
    const lines = sym.line != null ? [sym.line] : locate(files[file] ?? "", sym.detail ?? "");
    // A read whose expression cannot be found is still a real read; keep it with
    // a null line rather than silently dropping a fact the compiler established.
    for (const line of lines.length ? lines : [null]) {
      const id = `${file}|${line}|${sym.kind}|${sym.name}|${sym.detail ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      symbols.push({ ...sym, file, line });
    }
  }
  symbols.sort((a, b) =>
    a.file === b.file ? (a.line ?? 1e9) - (b.line ?? 1e9) : a.file < b.file ? -1 : 1
  );
  return { ok: true, symbols, compiled };
}

/**
 * TOOL ENTRY POINT: outline(files, entry)
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function outline(files, entry) {
  const got = symbolsOf(files, entry);
  if (!got.ok) return { ok: false, text: got.error, data: {} };

  const byFile = new Map();
  for (const s of got.symbols) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  // The entry always leads, even when it declares nothing, so a model asking for
  // an outline of an empty page gets an answer rather than silence.
  if (!byFile.has(entry)) byFile.set(entry, []);

  const out = [];
  for (const [file, syms] of [...byFile.entries()].sort((a, b) =>
    a[0] === entry ? -1 : b[0] === entry ? 1 : a[0] < b[0] ? -1 : 1
  )) {
    const lines = (files[file] ?? "").split("\n").length;
    out.push(`${shortPath(file)}  (${lines} lines)`);
    if (!syms.length) {
      out.push("  (no directives: plain markdown)");
      continue;
    }
    for (const s of syms) {
      // A block's span is printed as `:16-21`, because a model that is only
      // told where a loop STARTS will replace its header and strand the closer.
      const at = s.line == null ? "" : s.endLine ? `:${s.line}-${s.endLine}` : `:${s.line}`;
      const tag = s.kind === "loop" && s.reactive ? "loop*" : s.kind;
      out.push(`  ${at.padEnd(8)} ${tag.padEnd(9)} ${short(s.detail ?? s.name)}`);
    }
  }
  const reactive = got.compiled.assets?.runtime;
  out.push("");
  out.push(
    `${reactive ? "reactive page (ships the runtime)" : "static page (ships zero JavaScript)"}. loop* = reactive loop.`
  );

  return {
    ok: true,
    text: out.join("\n"),
    data: { symbols: got.symbols, runtime: Boolean(reactive) }
  };
}

/** Symbol kinds that WRITE the state key they name. */
const WRITE_KINDS = new Set(["state", "store", "computed", "theme", "fetch", "action", "form"]);

/**
 * TOOL ENTRY POINT: refs(files, entry, name)
 *
 * Every place a symbol is declared, written, or read, across the entry and
 * everything it includes. This is the query behind impact expansion: "what else
 * needs to change" is a lookup, not something a model should be recalling.
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @param {string} [name] Symbol name, e.g. `cart`. Missing is reported, not thrown.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function refs(files, entry, name) {
  const got = symbolsOf(files, entry);
  if (!got.ok) return { ok: false, text: got.error, data: {} };
  if (!name || typeof name !== "string") {
    return { ok: false, text: 'refs needs a symbol name, e.g. refs("cart")', data: {} };
  }

  // A dotted read of `cart.total` is a reference to `cart`, and a loop over
  // `products` targets it too. Match the head segment, not the whole string.
  const head = (/** @type {string} */ s) => String(s ?? "").split(".")[0];
  const hits = got.symbols.filter((s) => head(s.name) === name || head(s.target ?? "") === name);

  if (!hits.length) {
    const known = [...new Set(got.symbols.map((s) => head(s.name)))].filter(Boolean).sort();
    return {
      ok: true,
      text: `"${name}" is not declared or referenced anywhere.\nThis page has: ${known.join(", ") || "nothing"}`,
      data: { name, refs: [] }
    };
  }

  const rows = hits.map((s) => ({
    role:
      s.kind === "read"
        ? "read"
        : s.kind === "loop"
          ? "read"
          : s.kind === "if"
            ? "read"
            : WRITE_KINDS.has(s.kind)
              ? s.kind === "action"
                ? "write"
                : "declare"
              : "read",
    ...s
  }));

  const text = [
    name,
    ...rows.map(
      (r) =>
        `  ${r.role.padEnd(8)} ${short(r.detail ?? r.name).padEnd(DETAIL_MAX)} ${shortPath(r.file)}${r.line != null ? `:${r.line}` : ""}`
    )
  ].join("\n");

  return { ok: true, text, data: { name, refs: rows } };
}

/**
 * TOOL ENTRY POINT: deps(files, entry)
 *
 * What this page pulls in (includes, data files, collections) and, for any other
 * page in the project, whether it pulls in the same thing. The reverse direction
 * is what makes "I changed a partial, what breaks" answerable.
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function deps(files, entry) {
  const got = symbolsOf(files, entry);
  if (!got.ok) return { ok: false, text: got.error, data: {} };

  const reads = [...(got.compiled.deps ?? [])]
    .map((d) => fileKeyOf(d, files))
    .filter((d) => d !== entry)
    .sort();
  const collections = [...(got.compiled.collectionsUsed ?? [])].sort();

  // Reverse edges: every OTHER page that also reads this entry. Compiling each
  // one is affordable because it is in memory, and a page that fails to compile
  // is reported rather than skipped silently.
  const usedBy = [];
  const broken = [];
  for (const other of Object.keys(files)) {
    if (other === entry || !/\.(wd|md)$/.test(other)) continue;
    const o = symbolsOf(files, other);
    if (!o.ok) {
      broken.push(other);
      continue;
    }
    if ([...(o.compiled.deps ?? [])].map((d) => fileKeyOf(d, files)).includes(entry)) {
      usedBy.push(other);
    }
  }

  const out = [`${shortPath(entry)}`];
  out.push(reads.length ? `  includes: ${reads.map(shortPath).join(", ")}` : "  includes: nothing");
  if (collections.length) out.push(`  loops collections: ${collections.join(", ")}`);
  out.push(
    usedBy.length ? `  included by: ${usedBy.map(shortPath).join(", ")}` : "  included by: nothing"
  );
  for (const b of broken)
    out.push(`  note: ${shortPath(b)} does not compile, so its includes are unknown`);

  return {
    ok: true,
    text: out.join("\n"),
    data: { entry, includes: reads, collections, usedBy, broken }
  };
}
