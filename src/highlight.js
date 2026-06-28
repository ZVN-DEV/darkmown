// ---------------------------------------------------------------------------
// Build-time syntax highlighting: the markdown-it `highlight` callback (wired
// onto both markdown-it instances in `src/compiler/markdown.js`) plus the
// framework stylesheet that maps highlight.js token classes onto `$code-*` skin
// tokens. Highlighting is HTML + CSS only — no runtime, no client JS. The
// stylesheet is emitted (and linked) ONLY on pages that contain a highlighted
// code block, mirroring the pay-for-what-you-use behavior modules.
//
// Closed-whitelist philosophy: the highlighter is highlight.js and is NOT
// configurable. A fenced block whose language is unknown or absent is left for
// markdown-it to render as plain escaped `<code>` (graceful degradation); inline
// `` `code` `` is never highlighted.
// ---------------------------------------------------------------------------

import hljs from "highlight.js";

// Stamped onto highlighted output so the compiler can detect (in the rendered
// HTML) that a block was highlighted and flag `assets.hasCode` for this page —
// the markdown-it `highlight` callback has no access to the compilation object.
// Guarantees a marker even for a token-less snippet that produced no `hljs-*`
// spans, so detection never misses.
export const HLJS_MARKER = "hljs";

/**
 * markdown-it `highlight` callback. Returns highlight.js's escaped token HTML for
 * a known language (wrapped so the `hljs` marker is always present), or `""` to
 * defer to markdown-it's own escaping for an unknown/absent language — the
 * graceful-degradation path that renders a plain `<code>` with no highlighting.
 *
 * markdown-it does NOT escape a non-empty return value (it is trusted HTML), so
 * we must return already-escaped content — `hljs.highlight` escapes its output.
 * @param {string} code The fenced block's raw source.
 * @param {string} lang The info string (language) after the opening fence, if any.
 * @returns {string} Highlighted, escaped HTML, or `""` to defer to markdown-it.
 */
export function highlightCode(code, lang) {
  // No language, or a language highlight.js doesn't know → plain escaped code.
  if (!lang || !hljs.getLanguage(lang)) return "";
  // `ignoreIllegals` keeps a snippet that doesn't fully parse from throwing — it
  // still highlights best-effort instead of degrading the whole build.
  const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true });
  return `<span class="${HLJS_MARKER}">${value}</span>`;
}

/**
 * Detect whether a rendered HTML fragment contains a highlighted code block, so
 * the page-level `assets.hasCode` flag (and thus the highlight stylesheet) is set
 * only when highlighting actually happened. Matches the `hljs` marker stamped by
 * {@link highlightCode}; a page with only plain/unknown-language code never trips it.
 * @param {string} html Rendered body HTML.
 * @returns {boolean}
 */
export function htmlHasHighlight(html) {
  return html.includes(`class="${HLJS_MARKER}"`);
}

// The framework highlight stylesheet. Maps highlight.js token classes onto
// `$code-*` skin tokens via CSS custom properties, so code blocks dark-mode for
// free through the existing `tokens dark` / `:theme` system with ZERO JS — the
// same `--code-*` variables flip under the OS dark preference or a manual theme
// toggle. The `var(..., fallback)` second argument keeps highlighting legible
// even on a project whose skin omits the `$code-*` tokens entirely.
//
// Emitted to `/__wd/highlight.css` and linked only on pages that use it.
export const HIGHLIGHT_CSS = `/* Darkmown syntax highlighting — highlight.js classes mapped to $code-* skin
   tokens. Dark mode is automatic: the tokens swap under tokens dark / :theme,
   so this stylesheet ships zero JavaScript. */
.hljs {
  color: var(--code-fg, #e9efe7);
  background: var(--code-bg, #1b2420);
}
.hljs-comment,
.hljs-quote {
  color: var(--code-comment, #7d8a82);
  font-style: italic;
}
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-section,
.hljs-doctag,
.hljs-name {
  color: var(--code-keyword, #d39bda);
}
.hljs-string,
.hljs-regexp,
.hljs-meta .hljs-string,
.hljs-attr,
.hljs-selector-attr,
.hljs-selector-pseudo,
.hljs-addition {
  color: var(--code-string, #8fd28a);
}
.hljs-title,
.hljs-title.function_,
.hljs-built_in,
.hljs-class .hljs-title,
.hljs-selector-class,
.hljs-selector-id {
  color: var(--code-function, #82c0e9);
}
.hljs-number,
.hljs-symbol,
.hljs-bullet,
.hljs-link,
.hljs-meta {
  color: var(--code-number, #e3a76f);
}
.hljs-variable,
.hljs-template-variable,
.hljs-type,
.hljs-attribute,
.hljs-params,
.hljs-tag,
.hljs-deletion,
.hljs-punctuation,
.hljs-operator {
  color: var(--code-punctuation, #b9c4be);
}
.hljs-emphasis {
  font-style: italic;
}
.hljs-strong {
  font-weight: 600;
}
`;
