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
export function highlightCode(code: string, lang: string): string;
/**
 * Detect whether a rendered HTML fragment contains a highlighted code block, so
 * the page-level `assets.hasCode` flag (and thus the highlight stylesheet) is set
 * only when highlighting actually happened. Matches the `hljs` marker stamped by
 * {@link highlightCode}; a page with only plain/unknown-language code never trips it.
 * @param {string} html Rendered body HTML.
 * @returns {boolean}
 */
export function htmlHasHighlight(html: string): boolean;
export const HLJS_MARKER: "hljs";
export const HIGHLIGHT_CSS: "/* Darkmown syntax highlighting \u2014 highlight.js classes mapped to $code-* skin\n   tokens. Dark mode is automatic: the tokens swap under tokens dark / :theme,\n   so this stylesheet ships zero JavaScript. */\n.hljs {\n  color: var(--code-fg, #e9efe7);\n  background: var(--code-bg, #1b2420);\n}\n.hljs-comment,\n.hljs-quote {\n  color: var(--code-comment, #7d8a82);\n  font-style: italic;\n}\n.hljs-keyword,\n.hljs-selector-tag,\n.hljs-literal,\n.hljs-section,\n.hljs-doctag,\n.hljs-name {\n  color: var(--code-keyword, #d39bda);\n}\n.hljs-string,\n.hljs-regexp,\n.hljs-meta .hljs-string,\n.hljs-attr,\n.hljs-selector-attr,\n.hljs-selector-pseudo,\n.hljs-addition {\n  color: var(--code-string, #8fd28a);\n}\n.hljs-title,\n.hljs-title.function_,\n.hljs-built_in,\n.hljs-class .hljs-title,\n.hljs-selector-class,\n.hljs-selector-id {\n  color: var(--code-function, #82c0e9);\n}\n.hljs-number,\n.hljs-symbol,\n.hljs-bullet,\n.hljs-link,\n.hljs-meta {\n  color: var(--code-number, #e3a76f);\n}\n.hljs-variable,\n.hljs-template-variable,\n.hljs-type,\n.hljs-attribute,\n.hljs-params,\n.hljs-tag,\n.hljs-deletion,\n.hljs-punctuation,\n.hljs-operator {\n  color: var(--code-punctuation, #b9c4be);\n}\n.hljs-emphasis {\n  font-style: italic;\n}\n.hljs-strong {\n  font-weight: 600;\n}\n";
