import { isIP } from "node:net";
import { escapeHtml } from "./compiler.js";

export const devClientPath = "/__wd/dev-client.js";
export const devEventsPath = "/__wd/dev-events";

/** @param {string} h */
const isLoopbackName = (h) =>
  h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);

/** `Host`/`Origin` → bare lowercase hostname (`[::1]:5173` → `::1`), or null. @param {string} value */
function hostnameOf(value) {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

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
export function refuseLocalRequest(req, { bindHost = "", allowedHosts = "" } = {}) {
  const allowed = allowedHosts
    .split(",")
    .map((h) => hostnameOf(h.trim()) ?? "")
    .filter(Boolean);
  if (allowedHosts.split(",").some((h) => h.trim() === "*")) return null;
  const bind = hostnameOf(bindHost) ?? "";
  const host = hostnameOf(String(req.headers.host ?? ""));
  if (!host || !(isLoopbackName(host) || isIP(host) || host === bind || allowed.includes(host))) {
    return `Host "${req.headers.host ?? ""}" is not allowed. Set DARKMOWN_ALLOWED_HOSTS to permit it.`;
  }
  if (!(req.url || "/").startsWith("/api/")) return null;
  if (req.headers["sec-fetch-site"] === "cross-site") return "Cross-site request to /api/ refused.";
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const from = origin === "null" ? null : hostnameOf(String(origin));
    if (
      !from ||
      !(isLoopbackName(from) || from === host || from === bind || allowed.includes(from))
    ) {
      return `Origin "${origin}" may not call /api/ on this server.`;
    }
  }
  return null;
}

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
export function createRebuildQueue(runBuild, debounceMs = 30) {
  /** @type {Set<string | null>} */
  const pending = new Set();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let running = false;
  const flush = () => {
    if (running || pending.size === 0) return;
    const changed = pending.has(null) ? [] : /** @type {string[]} */ ([...pending]);
    pending.clear();
    running = true;
    Promise.resolve()
      .then(() => runBuild(changed))
      .catch(() => {}) // runBuild reports its own failures; never wedge the queue
      .then(() => {
        running = false;
        flush(); // drain changes that arrived mid-build (already waited a build long)
      });
  };
  return {
    change(path) {
      pending.add(path);
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    close() {
      clearTimeout(timer);
    }
  };
}

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
export function injectDevClient(html, options = {}) {
  const scripts = [`<script type="module" src="${devClientPath}"></script>`];
  if (options.draft) scripts.push(`<script>${draftBannerScript()}</script>`);
  const block = scripts.join("\n");
  return html.includes("</body>")
    ? html.replace("</body>", `${block}\n</body>`)
    : `${html}\n${block}`;
}

/**
 * The inline dev-only draft banner: a fixed bar marking the page as an unpublished
 * draft, so it's unmistakable in `darkmown dev` that this content is excluded from
 * a production build. Inert (`pointer-events:none`) and high-z so it never blocks
 * the page; dev-serve-injected, so it's never in shipped output.
 * @returns {string}
 */
export function draftBannerScript() {
  return `
const banner = document.createElement("div");
banner.id = "__wd-draft-banner";
banner.textContent = "DRAFT — excluded from production build";
banner.style.cssText = [
  "position:fixed", "top:0", "left:0", "right:0", "z-index:99998",
  "background:#b4541b", "color:#fff8f0", "text-align:center",
  "font:600 12px/2.2 ui-monospace,SFMono-Regular,Menlo,monospace",
  "letter-spacing:.08em", "pointer-events:none"
].join(";");
document.addEventListener("DOMContentLoaded", () => document.body.prepend(banner));
`;
}

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
export function buildFailedPage(message) {
  return injectDevClient(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Darkmown build failed</title>
</head>
<body>
  <h1>Darkmown build failed</h1>
  <pre>${escapeHtml(message)}</pre>
  <p>This route has no built output because the last build failed. Fix the file above and this page reloads on the next successful build.</p>
</body>
</html>`
  );
}

/**
 * The dev-client browser script that opens the SSE channel for live reload.
 * @returns {string}
 */
export function devClientScript() {
  return `
const source = new EventSource("${devEventsPath}");
source.addEventListener("reload", () => location.reload());
source.addEventListener("builderror", (event) => {
  const { message } = JSON.parse(event.data);
  let overlay = document.getElementById("__wd-error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "__wd-error-overlay";
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:99999", "background:rgba(24,18,16,.96)",
      "color:#ffd9cf", "font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
      "padding:3rem 2rem", "white-space:pre-wrap", "overflow:auto"
    ].join(";");
    document.body.appendChild(overlay);
  }
  overlay.textContent = "Darkmown build failed\\n\\n" + message + "\\n\\nFix the file and this overlay clears on the next successful build.";
});
source.addEventListener("error", () => {});
`;
}
