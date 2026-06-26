// ---------------------------------------------------------------------------
// Frontmatter: split a raw file into `meta` + `body`, parse inline scalar/array
// values, and warn when a file looks like it forgot the opening `---`.
// ---------------------------------------------------------------------------

import { stripQuotes } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").FrontmatterValue} FrontmatterValue
 * @typedef {import("./context.js").Compilation} Compilation
 */

/**
 * Split a raw file into its frontmatter `meta` and `body`.
 * @param {string} raw Full file contents.
 * @param {string} [file] Source path, used only for error messages.
 * @returns {{ meta: Meta, body: string }}
 */
export function parseFrontmatter(raw, file) {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    const where = file ? ` in ${file}` : "";
    throw new Error(
      `Unterminated frontmatter${where}: opening "---" has no closing "---". Use: --- on its own line to open and another --- to close, then the page body.`
    );
  }
  const front = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  /** @type {Meta} */
  const meta = {};
  for (const line of front.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = parseFrontmatterValue(match[2]);
  }
  return { meta, body };
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
 * @param {string} raw
 * @returns {FrontmatterValue}
 */
function parseFrontmatterValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) return parseInlineArray(value);
  return stripQuotes(value);
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
