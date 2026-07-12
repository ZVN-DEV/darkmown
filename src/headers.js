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
 *   - Inline `<script type="application/json" data-wd-state>` (state seed) —
 *     a non-executable data block, which `script-src` does not govern, so it
 *     needs no source at all.
 *   - Inline `<script type="speculationrules">` (prerender, `transitions: true`)
 *     — the one inline script `script-src` does gate. Its body is a single
 *     build-time constant, so a `'sha256-…'` hash source authorizes exactly it
 *     (plus the `'inline-speculation-rules'` keyword for browsers that check
 *     that instead of the hash) and `'unsafe-inline'` is dropped entirely. A
 *     raw `<script>` an author writes into `html: true` markdown is therefore
 *     blocked by the shipped CSP — use a colocated `.js` file (same-origin,
 *     covered by `'self'`) or widen `script-src` deliberately.
 *   - The reactive runtime WALKS a compile-time-validated expression AST (see
 *     src/compiler/expr-ast.js) rather than building a `new Function`, so reactive
 *     pages need NO `'unsafe-eval'`: their CSP is identical to the static one.
 *   - Inline `<style>` for view transitions — `style-src 'unsafe-inline'`.
 *   - `data:` favicon and remote images — `img-src 'self' data: https:`.
 *   - `:video`/`:audio` allow relative or `http(s)` sources — `media-src 'self' https:`.
 *   - `:embed` rewrites to exactly the YouTube no-cookie and Vimeo player origins,
 *     so `frame-src` pre-authorizes those two hosts (and nothing else).
 *   - A native `:form action="/api/…"` POSTs same-origin, so `form-action 'self'`
 *     authorizes it (and blocks a form exfiltrating to a third-party origin). Apps
 *     posting to a remote backend widen this alongside `connect-src`.
 *
 * Static pages (zero framework JS) and reactive pages now share the same
 * eval-free `script-src` — no page needs `'unsafe-eval'`.
 */

import { createHash } from "node:crypto";

/**
 * The exact body of the inline `<script type="speculationrules">` block that
 * `compilePage` emits for `transitions: true` pages. Kept in sync with
 * `src/compiler/page.js` by a drift-guard test that hashes the block out of a
 * real build — if the emitted rules change, that test fails before the CSP
 * silently starts blocking prerender.
 * @type {string}
 */
export const SPECULATION_RULES_JSON =
  '{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"selector_matches":".no-prefetch"}},{"not":{"selector_matches":"[rel~=nofollow]"}}]},"eagerness":"moderate"}]}';

/**
 * CSP hash source for the speculationrules block — computed from the constant
 * above at module load, never hand-maintained.
 * @type {string}
 */
export const SPECULATION_RULES_HASH = `'sha256-${createHash("sha256")
  .update(SPECULATION_RULES_JSON)
  .digest("base64")}'`;

/**
 * The `script-src` both CSP variants share: same-origin scripts, plus the two
 * grants for the inline speculationrules block (hash + keyword). No
 * `'unsafe-inline'` — the state seed is a data block and needs nothing.
 * @type {string}
 */
const SCRIPT_SRC = `script-src 'self' ${SPECULATION_RULES_HASH} 'inline-speculation-rules'`;

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
 * `img-src`/`media-src` deliberately allow any `https:` host — remote images
 * and media in markdown are legitimate everywhere. Sites that only serve their
 * own assets can tighten both to `'self'` (plus `data:` for the favicon) in
 * their deploy config; see SECURITY.md "Tightening the policy".
 * @type {string[]}
 */
const COMMON_CSP_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
  "font-src 'self'",
  CONNECT_SRC,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
];

/**
 * CSP for reactive pages. Since 2.1 the runtime WALKS a compile-time-validated
 * expression AST instead of building a `new Function`, so reactive pages no longer
 * need `'unsafe-eval'` — this policy is byte-identical to the static one. The only
 * script source is same-origin `/__wd/runtime.js` (plus the hashed speculationrules
 * block); no `'unsafe-inline'`, no `'unsafe-eval'`.
 * @type {string}
 */
export const REACTIVE_CSP = [SCRIPT_SRC, ...COMMON_CSP_DIRECTIVES].join("; ");

/**
 * CSP for static pages (zero framework JS). Identical to the reactive policy now
 * that neither variant evals — kept as a distinct export so the per-route emit and
 * the `securityHeaders()` callers stay explicit about intent. Inline `<style>`
 * (view transitions) keeps `'unsafe-inline'` on style-src only.
 * @type {string}
 */
export const STATIC_CSP = [SCRIPT_SRC, ...COMMON_CSP_DIRECTIVES].join("; ");

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
