// ---------------------------------------------------------------------------
// TOOL: validate(files, entry)
//
// Compiles a whole virtual project with the REAL compiler and answers in the
// model's own vocabulary: either "it compiles, here is what it became", or one
// error with its code, its location, the corrective template, and a concrete
// example line.
//
// This is the tool the agent loop leans on hardest, and it is nearly free:
// `compileFromMemory` runs in process against an in-memory reader, no disk, so
// a model can afford to check after every edit rather than at the end.
//
// The error path deliberately surfaces `err.wd` (the structured companion the
// framework already attaches) instead of re-parsing the prose message. That is
// the same discipline as the outline tool: never re-derive what the compiler
// already knows.
// ---------------------------------------------------------------------------

import { compileFromMemory } from "../compiler.js";

/**
 * Reduce any path the compiler hands back to the caller's own key form.
 *
 * The caller addresses files with POSIX keys (`site/pages/index.wd`), but
 * `compileFromMemory` resolves them against its virtual root with
 * `path.resolve`, which is PLATFORM-NATIVE: on Windows the same file comes back
 * as `C:\site\pages\index.wd`. Comparing that to the caller's keys matches
 * nothing, so every symbol gets filed under a path that is not in the project
 * and every symbol-targeted edit fails. The virtual root is not a real
 * filesystem and its separator is an accident of the host, so normalising here
 * is the fix rather than a workaround.
 *
 * @param {string} p
 * @returns {string}
 */
export function posixKey(p) {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "");
}

/**
 * Shorten a virtual absolute path to what the author would call the file.
 * The model never saw `/site/pages/`, so echoing it back is noise it may copy.
 * @param {string} p
 * @returns {string}
 */
export function shortPath(p) {
  if (!p) return "";
  return posixKey(p)
    .replace(/^site\/pages\//, "")
    .replace(/^site\/_\//, "_/");
}

/** A virtual project path as it appears mid-sentence, either separator. */
const EMBEDDED_PATH = /(?:[A-Za-z]:)?[\\/]?site[\\/](?:pages|_)[\\/][^\s,)]*/g;

/**
 * The same shortening applied to paths EMBEDDED in a sentence.
 *
 * `shortPath` only anchors at the start of a string, which covered the location
 * this tool prints and missed the one place the model actually reads: the
 * compiler's own message, which names the file mid-sentence ("Malformed @loop in
 * /site/pages/index.wd:3"). A model that is shown the virtual root will use it,
 * and the path it then writes resolves to nothing.
 *
 * Whole tokens are matched and rewritten rather than separators being replaced
 * globally, so a Windows path is normalised without touching anything else in
 * the sentence.
 *
 * @param {string} s
 * @returns {string}
 */
function shortenPaths(s) {
  return String(s ?? "").replace(EMBEDDED_PATH, (match) => {
    // A trailing `:3` line marker is part of the location, not the path.
    const [, file, line] = /^(.*?)(:\d+)?$/.exec(match) ?? [];
    return `${shortPath(file ?? match)}${line ?? ""}`;
  });
}

/**
 * TOOL ENTRY POINT.
 *
 * @param {Record<string, string>} files Project-relative path → contents, e.g.
 *   `{"site/pages/index.wd": "---\ntitle: X\n---\n"}`.
 * @param {string} entry Which file to compile, in the same key form.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function validate(files, entry) {
  if (!files || typeof files !== "object") {
    return { ok: false, text: "validate needs a files object", data: { code: "TOOL_ARGS" } };
  }
  if (!entry || !(entry in files)) {
    return {
      ok: false,
      text: `no such file "${shortPath(entry)}". The project has: ${Object.keys(files).map(shortPath).join(", ")}`,
      data: { code: "TOOL_ARGS" }
    };
  }

  let compiled;
  try {
    compiled = compileFromMemory(files, entry);
  } catch (err) {
    // Every author-facing compile error carries the compiler's own structured
    // payload on `err.wd` (see wdError in src/compiler/context.js). Naming that
    // type rather than restating its fields is what keeps this in step when a
    // field is added there.
    const wd = /** @type {Partial<import("../compiler/context.js").WdErrorInfo>} */ (
      /** @type {any} */ (err)?.wd ?? {}
    );
    // `file` is optional: a pure string->string pass (compileSkin) has no file
    // to name, so fall back to the entry the caller asked about.
    const where = wd.file
      ? `${shortPath(wd.file)}${wd.line ? `:${wd.line}` : ""}`
      : shortPath(entry);
    // Strip the "[CODE] " prefix and the trailing "Use: …" the message already
    // carries, because both are re-emitted below in a fixed position. A model
    // copying from a single predictable shape beats one parsing prose.
    const message = shortenPaths(
      String(/** @type {any} */ (err)?.message ?? err)
        .replace(/^\[[A-Z]{2}\d{3}\]\s*/, "")
        .replace(/\s*Use:\s*[\s\S]*$/, "")
    ).trim();

    const lines = [`${wd.code ?? "ERROR"} at ${where}`, `  ${message}`];
    if (wd.hint) lines.push(`  use: ${shortenPaths(wd.hint)}`);
    if (wd.example) lines.push(`  e.g. ${shortenPaths(wd.example)}`);

    return {
      ok: false,
      text: lines.join("\n"),
      data: {
        code: wd.code ?? null,
        file: shortPath(wd.file ?? entry),
        line: wd.line ?? null,
        message,
        hint: wd.hint ?? null,
        example: wd.example ?? null
      }
    };
  }

  // A clean compile still has things worth telling the model, and one of them is
  // load-bearing: whether the page went reactive. A brochure page that quietly
  // starts shipping the runtime is a regression the framework cares about more
  // than almost anything else, and it is invisible in the HTML.
  const skins = Object.keys(compiled.assets?.skins ?? {}).length;
  const facts = [
    compiled.assets?.runtime ? "reactive (ships the runtime)" : "static (ships zero JavaScript)",
    `${skins} skin${skins === 1 ? "" : "s"}`
  ];
  const lines = [`compiles. ${facts.join(", ")}.`];
  for (const w of compiled.warnings ?? []) lines.push(`  warning: ${w}`);

  return {
    ok: true,
    text: lines.join("\n"),
    data: {
      runtime: Boolean(compiled.assets?.runtime),
      skins,
      warnings: [...(compiled.warnings ?? [])],
      title: compiled.meta?.title ?? null,
      html: compiled.html
    }
  };
}
