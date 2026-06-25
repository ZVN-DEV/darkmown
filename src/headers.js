/**
 * Security headers Darkmown emits on every delivery surface — the local
 * `darkmown serve`/preview server (`src/statics.js`), Cloudflare Pages
 * (`dist/_headers`, written by `src/builder.js`), and Vercel (`vercel.json`).
 *
 * `statics.js` and the generated `_headers` derive from the values here, so they
 * never drift. `vercel.json` is the exception: Vercel reads it BEFORE the build
 * runs, so its CSP strings and static-route list are hand-maintained copies, not
 * build output. The `vercel-csp-routes` test cross-checks vercel.json against the
 * built route manifest so a new static route can't silently miss the strict CSP.
 *
 * The CSP is derived from what the framework's own output actually emits
 * (verify against built `dist/` HTML):
 *   - External script `/__wd/runtime.js` (same-origin) on reactive pages.
 *   - Inline `<script type="application/json" data-wd-state>` (state seed) and
 *     inline `<script type="speculationrules">` (prerender) — JSON/speculation
 *     blocks can't be nonce'd cleanly, so `script-src 'unsafe-inline'`.
 *   - The reactive runtime compiles validated expressions via `new Function`,
 *     so reactive pages additionally need `script-src 'unsafe-eval'`.
 *   - Inline `<style>` for view transitions — `style-src 'unsafe-inline'`.
 *   - `data:` favicon and remote images — `img-src 'self' data: https:`.
 *
 * Static pages (zero framework JS) still emit inline `<style>` and an inline
 * `<script type="speculationrules">`, so they keep `'unsafe-inline'`, but they
 * never call `new Function`, so their CSP drops `'unsafe-eval'`.
 */

/**
 * `connect-src` for the demo is `'self'`: the framework's own pages only
 * `:fetch` same-origin endpoints. Apps whose `:fetch` targets a remote host
 * must widen this (e.g. to `connect-src 'self' https://api.example.com` or
 * `connect-src *`) by editing their `vercel.json` / `_headers` / serve config.
 * @type {string}
 */
const CONNECT_SRC = "connect-src 'self'";

/**
 * Directives shared by both the static and reactive CSP. Order is cosmetic.
 * @type {string[]}
 */
const COMMON_CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  CONNECT_SRC,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'"
];

/**
 * Relaxed CSP for reactive pages: `new Function` needs `'unsafe-eval'`, the
 * inline state/speculationrules JSON needs `'unsafe-inline'`.
 * @type {string}
 */
export const REACTIVE_CSP = [
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  ...COMMON_CSP_DIRECTIVES
].join("; ");

/**
 * Stricter CSP for static pages: no runtime means no `new Function`, so
 * `'unsafe-eval'` is dropped. Inline `<style>`/`<script type=speculationrules>`
 * keep `'unsafe-inline'` on script/style.
 * @type {string}
 */
export const STATIC_CSP = [
  "script-src 'self' 'unsafe-inline'",
  ...COMMON_CSP_DIRECTIVES
].join("; ");

/**
 * Baseline security headers applied to every HTML response, independent of the
 * CSP. CSP is added per-route (static vs reactive) by the helpers below.
 * @type {Record<string, string>}
 */
export const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN"
};

/**
 * The full security-header set for one response, including the CSP variant.
 * @param {boolean} reactive Whether the route ships the reactive runtime.
 * @returns {Record<string, string>}
 */
export function securityHeaders(reactive) {
  return {
    ...BASE_SECURITY_HEADERS,
    "Content-Security-Policy": reactive ? REACTIVE_CSP : STATIC_CSP
  };
}
