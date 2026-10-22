/**
 * The CSP for one route: its base policy (`REACTIVE_CSP`/`STATIC_CSP`) with the
 * page's `:embed` frame hosts unioned into `frame-src`. The compiler records the
 * FINAL iframe src of every `:embed` (after the YouTube/Vimeo rewrite), so a
 * generic embed — a booking widget, a map — is authorized on exactly the pages
 * that carry it instead of being blocked by the shipped policy. YouTube/Vimeo
 * embeds dedupe against the base list, so a page whose embeds are all covered
 * already produces a byte-identical policy, as does a page with no embeds.
 * @param {boolean} reactive Whether the route ships the reactive runtime.
 * @param {Iterable<string>} [embedHosts] Origins (`https://app.example.com`) or
 *   `'self'` for a same-origin embed, collected at compile time.
 * @returns {string}
 */
export function routeCsp(reactive: boolean, embedHosts?: Iterable<string>): string;
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
 * Baseline security headers applied to every response, independent of the
 * CSP. CSP is added per-route (static vs reactive) by the helpers below.
 *
 * HSTS is one year WITHOUT `includeSubDomains`/`preload`: those pin every
 * sibling subdomain to HTTPS, which only the domain owner can safely decide.
 * Browsers ignore the header over plain HTTP, so local `serve` is unaffected.
 * Cloudflare custom domains send no HSTS unless the zone enables it.
 * @type {Record<string, string>}
 */
export const BASE_SECURITY_HEADERS: Record<string, string>;
