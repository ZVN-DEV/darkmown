/**
 * The local dev/preview servers bind to loopback, but loopback alone does not
 * keep a website you are visiting out. Two attacks reach it from a browser:
 *
 * - DNS rebinding: `evil.example` re-resolves to 127.0.0.1, after which the
 *   page can READ every response (drafts, the dep map, the SSE stream, and
 *   `api/*` handlers, which run with the full `process.env`). The browser still
 *   sends `Host: evil.example`, so only hostnames that cannot be rebound pass:
 *   `localhost`/`*.localhost`, IP literals (a rebinding needs a domain), the
 *   bind address, and the `DARKMOWN_ALLOWED_HOSTS` list (a tunnel's domain).
 * - Cross-site requests: any page can fire a simple POST at
 *   `http://127.0.0.1:5173/api/x` without reading the reply, so the handler's
 *   side effects run. `/api/*` therefore also refuses `Sec-Fetch-Site:
 *   cross-site` and an `Origin` that is not loopback, the request's own host,
 *   or allow-listed.
 *
 * `DARKMOWN_ALLOWED_HOSTS=*` turns the guard off.
 * @param {{ url?: string, headers: Record<string, string | string[] | undefined> }} req
 * @param {{ bindHost?: string, allowedHosts?: string }} [options]
 * @returns {string | null} why the request is refused, or null to serve it
 */
export function refuseLocalRequest(req: {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
}, { bindHost, allowedHosts }?: {
    bindHost?: string;
    allowedHosts?: string;
}): string | null;
/**
 * Serialize the dev server's rebuilds: at most ONE child build runs at a time.
 * Every build read-modify-writes the dependency map (`dist/.wd-dev-deps.json`),
 * so overlapping children could persist a stale map missing deps a concurrent
 * build just recorded — after which the affected routes silently stop
 * rebuilding. Changes debounce into a batch; changes arriving MID-build
 * accumulate into the next batch (duplicate paths coalesce via the Set, and a
 * `null` — a `src/` change or an unattributable event, forcing a full rebuild —
 * swallows the whole batch into one full build).
 * @param {(changed: string[]) => Promise<void> | void} runBuild Runs one child
 *   build over the changed `site/` paths (`[]` = full rebuild). Build failures
 *   are its own concern (report + resolve); a rejection still frees the queue.
 * @param {number} [debounceMs] Debounce window for batching change events.
 * @returns {{ change: (path: string | null) => void, close: () => void }}
 */
export function createRebuildQueue(runBuild: (changed: string[]) => Promise<void> | void, debounceMs?: number): {
    change: (path: string | null) => void;
    close: () => void;
};
/**
 * Inject the dev-client `<script>` before `</body>` (or append it if absent),
 * plus — for a `draft: true` page — an inline draft-banner script. Both are
 * injected at dev-SERVE time only, so neither ever touches the shipped HTML on
 * disk (a production build excludes drafts entirely; a `build --drafts` staging
 * build emits clean HTML with no banner).
 * @param {string} html Page HTML to augment.
 * @param {{ draft?: boolean }} [options] `draft: true` adds the visible banner.
 * @returns {string}
 */
export function injectDevClient(html: string, options?: {
    draft?: boolean;
}): string;
/**
 * The inline dev-only draft banner: a fixed bar marking the page as an unpublished
 * draft, so it's unmistakable in `darkmown dev` that this content is excluded from
 * a production build. Inert (`pointer-events:none`) and high-z so it never blocks
 * the page; dev-serve-injected, so it's never in shipped output.
 * @returns {string}
 */
export function draftBannerScript(): string;
/**
 * The page the dev server serves for a route with no dist output while the last
 * build is FAILED — the honest alternative to the production 404 copy, which
 * would claim the route "is hidden or has not been created" when the real cause
 * is a compile error. The message renders inline (works without JS) and the
 * injected dev client replays the `builderror` overlay on connect, then reloads
 * the real page on the next successful build.
 * @param {string} message The recorded build failure.
 * @returns {string}
 */
export function buildFailedPage(message: string): string;
/**
 * The dev-client browser script that opens the SSE channel for live reload.
 * @returns {string}
 */
export function devClientScript(): string;
export const devClientPath: "/__wd/dev-client.js";
export const devEventsPath: "/__wd/dev-events";
