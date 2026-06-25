import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP } from "./headers.js";

/**
 * Security headers for an HTML response from the local server. The relaxed
 * (reactive) CSP is a superset that satisfies both static and reactive pages,
 * so the runtime server uses it for every HTML response; the build-time
 * outputs (`vercel.json`, `dist/_headers`) tighten static routes per-path.
 * @type {Record<string, string>}
 */
const HTML_SECURITY_HEADERS = {
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": REACTIVE_CSP
};

/**
 * Serve a built file for a request URL out of `distRoot`, or a 404 page.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @param {http.ServerResponse} res Response to write to.
 * @returns {void}
 */
export function serve(distRoot, url, res) {
  const file = resolvePublicFile(distRoot, url || "/");
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8", ...HTML_SECURITY_HEADERS });
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
    ? { "content-type": type, ...HTML_SECURITY_HEADERS }
    : { "content-type": type };
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
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
