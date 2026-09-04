import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP, STATIC_CSP } from "./headers.js";

/**
 * The security headers (including the right CSP variant) for an HTML response.
 * Mirrors what production ships. Since 2.1 both variants are eval-free (the
 * reactive runtime walks a validated AST, not `new Function`), so a reactive and a
 * static route resolve to the same CSP — the per-route selection is kept for parity
 * with the `_headers` / `vercel.json` structure the same build writes. Anything not
 * found in `routes.json` (an unknown route, a 404, a missing manifest) falls back
 * to the reactive CSP, exactly like the production `_headers` catch-all block.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @returns {Record<string, string>}
 */
function htmlSecurityHeaders(distRoot, url) {
  return {
    ...BASE_SECURITY_HEADERS,
    "Content-Security-Policy": routeIsReactive(distRoot, routeOf(url)) ? REACTIVE_CSP : STATIC_CSP
  };
}

/**
 * Normalize a request URL to its clean, trailing-slashed route path so it can be
 * matched against `routes.json` (`/docs` / `/docs/` / `/docs/index.html` all →
 * `/docs/`). Returns null for an unparseable URL.
 * @param {string} url
 * @returns {string | null}
 */
function routeOf(url) {
  let pathname;
  try {
    pathname = decodeURIComponent((url || "/").split("?")[0]);
  } catch {
    return null;
  }
  if (pathname.endsWith("/index.html")) pathname = pathname.slice(0, -"index.html".length);
  if (!pathname.endsWith("/")) pathname += "/";
  return pathname;
}

/**
 * Whether the route ships the reactive runtime, per the build's `routes.json`.
 * Defaults to `true` (reactive) when the route is absent or the manifest can't be
 * read — matching the production `_headers` catch-all, so an unknown route is
 * never accidentally served the stricter policy.
 * @param {string} distRoot
 * @param {string | null} route
 * @returns {boolean}
 */
function routeIsReactive(distRoot, route) {
  if (!route) return true;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "routes.json"), "utf8"));
    const entry = manifest.find((/** @type {{ route: string }} */ e) => e.route === route);
    if (entry) return Boolean(entry.assets?.runtime);
  } catch {
    /* no/unreadable manifest → reactive default (the catch-all policy) */
  }
  return true;
}

/**
 * Serve a built file for a request URL out of `distRoot`, or a 404 page.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @param {http.ServerResponse} res Response to write to.
 * @returns {void}
 */
export function serve(distRoot, url, res) {
  const file = resolvePublicFile(distRoot, url || "/");
  if (!file || !isServableFile(file)) {
    res.writeHead(404, {
      "content-type": "text/html; charset=utf-8",
      ...htmlSecurityHeaders(distRoot, url)
    });
    const notFound = path.join(distRoot, "404.html");
    if (fs.existsSync(notFound)) {
      res.end(fs.readFileSync(notFound));
      return;
    }
    res.end("<h1>Not found</h1><p>This route is hidden or has not been created.</p>");
    return;
  }
  const type = contentType(file);
  const headers = type.startsWith("text/html")
    ? { "content-type": type, ...htmlSecurityHeaders(distRoot, url) }
    : { "content-type": type };
  res.writeHead(200, headers);
  pipeFile(file, res);
}

/**
 * Whether a resolved path is something we can actually stream back: a regular
 * file. A DIRECTORY is the case that matters — `fs.existsSync` says yes to one,
 * and handing it to a read stream is an `EISDIR` on an unhandled `error` event,
 * which takes the whole server process down. Treating it as a miss answers 404
 * instead. Anything unstattable (absent, or a parent the process cannot read)
 * is a miss too.
 * @param {string} file Absolute path inside the build output.
 * @returns {boolean}
 */
export function isServableFile(file) {
  return Boolean(fs.statSync(file, { throwIfNoEntry: false })?.isFile());
}

/**
 * Stream a built file to the response with an `error` handler attached.
 *
 * `fs.createReadStream(file).pipe(res)` has none, so ANY read failure — a file
 * deleted by a rebuild between the stat and the open, a permission error, a
 * path that turned out not to be a regular file — is an unhandled `error` event
 * and an immediate process exit. Here it answers instead: a 500 when the
 * response has not started, and a clean end when it has (the status is already
 * on the wire by then, so the truncated body is all we can signal with).
 * @param {string} file Absolute path to the file to stream.
 * @param {http.ServerResponse} res Response to write to.
 * @returns {void}
 */
export function pipeFile(file, res) {
  const stream = fs.createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
  });
  stream.pipe(res);
}

/**
 * Resolve a request URL to an absolute file inside `distRoot`, guarding against
 * path traversal. Returns null when the resolved path escapes the root.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @returns {string | null}
 */
export function resolvePublicFile(distRoot, url) {
  let cleanUrl;
  try {
    cleanUrl = decodeURIComponent(url.split("?")[0]);
  } catch {
    return null;
  }
  const base = cleanUrl.startsWith("/__wd/")
    ? cleanUrl
    : path.join(cleanUrl, path.extname(cleanUrl) ? "" : "index.html");
  const requested = path.resolve(distRoot, `.${base}`);
  const root = path.resolve(distRoot);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) return null;
  // `path.extname` reports an extension for any dotted LAST SEGMENT, so a clean
  // route like `/v1.2/`, `/node.js/` or `/2024.01/` looked like a file request
  // and skipped the `index.html` join above — resolving to the DIRECTORY. Fix it
  // where the answer is knowable (on disk) rather than by guessing from the
  // string: a directory serves its `index.html`, exactly like every other route.
  if (fs.statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
    return path.join(requested, "index.html");
  }
  return requested;
}

/**
 * Map a file extension to a response content-type. Unknown types fall back to
 * `application/octet-stream` so the browser never mis-sniffs an asset as HTML.
 * @type {Record<string, string>}
 */
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml"
};

/**
 * Map a file path to a response content-type by extension, defaulting to
 * `application/octet-stream` for unknown types.
 * @param {string} file File path or name.
 * @returns {string}
 */
export function contentType(file) {
  return contentTypes[path.extname(file).toLowerCase()] || "application/octet-stream";
}
