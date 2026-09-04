// ---------------------------------------------------------------------------
// Frontmatter: split a raw file into `meta` + `body`, parse inline scalar/array
// values, and warn when a file looks like it forgot the opening `---`.
// ---------------------------------------------------------------------------

import { normalizeNewlines, wdError } from "./context.js";
import { stripQuotes } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").FrontmatterValue} FrontmatterValue
 * @typedef {import("./context.js").Compilation} Compilation
 */

/**
 * Split a raw file into its frontmatter `meta` and `body`. `bodyLine` is the
 * 0-based file line index the body starts on (the number of lines the
 * frontmatter block consumed) so compile errors can report true file lines.
 *
 * `quotedKeys` names the fields the author wrote with quotes. Quotes are syntax,
 * not content, so `meta` never carries them — but "the author quoted it" is the
 * only signal that `sku: "007"` is the TEXT 007 and not the number 7, and the
 * typed-collection coercion needs it. Additive: existing destructuring of
 * `{ meta, body, bodyLine }` is unaffected.
 * @param {string} raw Full file contents.
 * @param {string} [file] Source path, used only for error messages.
 * @returns {{ meta: Meta, body: string, bodyLine: number, quotedKeys: Set<string> }}
 */
export function parseFrontmatter(raw, file) {
  // A file authored on Windows (or checked out with git's autocrlf) arrives
  // CRLF-terminated, and every delimiter/line test below is LF-shaped — so
  // without this the opening `---\r\n` never matches and the whole frontmatter
  // block is silently treated as body text. Normalizing here rather than only
  // in the reader keeps the direct callers (builder.js reads route frontmatter
  // straight off disk for feeds) on the same footing. Idempotent on LF input.
  raw = normalizeNewlines(raw);
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw, bodyLine: 0, quotedKeys: new Set() };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    const where = file ? ` in ${file}` : "";
    throw wdError(
      `Unterminated frontmatter${where}: opening "---" has no closing "---". Use: --- on its own line to open and another --- to close, then the page body.`,
      { code: "WD001", file }
    );
  }
  const front = raw.slice(4, end).trim();
  let bodyStart = end + 4;
  if (raw[bodyStart] === "\n") bodyStart++;
  const body = raw.slice(bodyStart);
  const bodyLine = raw.slice(0, bodyStart).split("\n").length - 1;
  /** @type {Meta} */
  const meta = {};
  /** @type {Set<string>} */
  const quotedKeys = new Set();
  for (const line of front.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const parsed = parseFrontmatterValue(match[2]);
    meta[match[1]] = parsed.value;
    if (parsed.quoted) quotedKeys.add(match[1]);
  }
  return { meta, body, bodyLine, quotedKeys };
}

/**
 * Warn (non-fatal) when a file looks like it MEANT to open frontmatter but forgot
 * the leading `---`: the first content line is a `key: value` pair and a bare
 * `---` fence appears within the opening lines. Conservative — a normal markdown
 * body whose first line happens to contain a colon (with no early `---`) is left
 * alone, since `---` is also a valid horizontal rule.
 * @param {string} raw
 * @param {string} file
 * @param {Compilation} comp
 * @returns {void}
 */
export function warnLikelyFrontmatter(raw, file, comp) {
  if (raw.startsWith("---\n")) return; // a real opener: parseFrontmatter handled it
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++; // skip leading blanks
  if (i >= lines.length || !/^[A-Za-z][\w-]*:\s*\S/.test(lines[i])) return;
  // Only warn when the run of lines up to a bare `---` is ALL `key: value` pairs:
  // a forgotten opener, not prose that merely contains a colon and a later rule.
  for (let j = i; j < lines.length && j < i + 12; j++) {
    const t = lines[j].trim();
    if (t === "---") {
      comp.warnings.push(
        `${file}: this looks like frontmatter missing its opening "---". Use: a "---" line before the fields (and another "---" to close) — otherwise the block renders as page text.`
      );
      return;
    }
    if (t && !/^[A-Za-z][\w-]*:\s*\S/.test(t)) return; // hit prose → not frontmatter
  }
}

// Frontmatter values are scalars, except an inline flow array `[a, b, c]`.
// Block sequences (`- item` on following lines) are intentionally out of scope —
// the parser stays single-pass and line-based.
/**
 * Parse one frontmatter value, reporting whether the author QUOTED it.
 *
 * The inline-array branch tracks `quoted` per item already (an item is a string
 * either way, so the flag only guards whitespace trimming); the scalar branch
 * did not, and downstream that made `sku: "007"` indistinguishable from
 * `sku: 007`. Both are `"007"` here, but only the first is text the author
 * pinned, so only the second is a candidate for numeric coercion.
 * @param {string} raw
 * @returns {{ value: FrontmatterValue, quoted: boolean }}
 */
function parseFrontmatterValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]"))
    return { value: parseInlineArray(value), quoted: false };
  const quote = value[0];
  const quoted = value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote);
  return { value: stripQuotes(value), quoted };
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseInlineArray(raw) {
  const inner = raw.slice(1, -1);
  if (inner.trim() === "") return [];
  /** @type {string[]} */
  const items = [];
  let buf = "";
  let quote = null;
  let quoted = false;
  const push = () => {
    items.push(quoted ? buf : buf.trim());
    buf = "";
    quoted = false;
  };
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else buf += char;
    } else if ((char === '"' || char === "'") && buf.trim() === "") {
      quote = char;
      quoted = true;
      buf = ""; // drop any whitespace between the comma and the opening quote
    } else if (char === ",") {
      push();
    } else {
      buf += char;
    }
  }
  push();
  return items;
}
