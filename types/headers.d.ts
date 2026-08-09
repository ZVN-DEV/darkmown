/**
 * The full security-header set for one response, including the CSP variant.
 * @param {boolean} reactive Whether the route ships the reactive runtime.
 * @returns {Record<string, string>}
 */
export function securityHeaders(reactive: boolean): Record<string, string>;
/**
 * The exact body of the inline `<script type="speculationrules">` block that
 * `compilePage` emits for `transitions: true` pages. Kept in sync with
 * `src/compiler/page.js` by a drift-guard test that hashes the block out of a
 * real build — if the emitted rules change, that test fails before the CSP
 * silently starts blocking prerender.
 * @type {string}
 */
export const SPECULATION_RULES_JSON: string;
/**
 * CSP hash source for the speculationrules block — computed from the constant
 * above at module load, never hand-maintained.
 * @type {string}
 */
export const SPECULATION_RULES_HASH: string;
/**
 * CSP for reactive pages. Since 2.1 the runtime WALKS a compile-time-validated
 * expression AST instead of building a `new Function`, so reactive pages no longer
 * need `'unsafe-eval'` — this policy is byte-identical to the static one. The only
 * script source is same-origin `/__wd/runtime.js` (plus the hashed speculationrules
 * block); no `'unsafe-inline'`, no `'unsafe-eval'`.
 * @type {string}
 */
export const REACTIVE_CSP: string;
/**
 * CSP for static pages (zero framework JS). Identical to the reactive policy now
 * that neither variant evals — kept as a distinct export so the per-route emit and
 * the `securityHeaders()` callers stay explicit about intent. Inline `<style>`
 * (view transitions) keeps `'unsafe-inline'` on style-src only.
 * @type {string}
 */
export const STATIC_CSP: string;
/**
 * Baseline security headers applied to every HTML response, independent of the
 * CSP. CSP is added per-route (static vs reactive) by the helpers below.
 * @type {Record<string, string>}
 */
export const BASE_SECURITY_HEADERS: Record<string, string>;
