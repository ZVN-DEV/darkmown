import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP, routeCsp } from "./headers.js";

/**
 * The security headers (including the right CSP variant) for an HTML response.
 * Mirrors what production ships. Since 2.1 both variants are eval-free (the
 * reactive runtime walks a validated AST, not `new Function`), so a reactive and a
 * static route resolve to the same base CSP — the per-route selection is kept for
 * parity with the `_headers` / `vercel.json` structure the same build writes, and
 * it is what lets a route's own `:embed` hosts (recorded on its manifest entry as
 * `assets.embedHosts`) widen `frame-src` for exactly that route. Anything not
 * found in `routes.json` (an unknown route, a 404, a missing manifest) falls back
 * to the reactive CSP, exactly like the production `_headers` catch-all block.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @returns {Record<string, string>}
 */
function htmlSecurityHeaders(distRoot, url) {
  const entry = routeEntry(distRoot, routeOf(url));
  return {
    ...BASE_SECURITY_HEADERS,
    "Content-Security-Policy": entry
      ? routeCsp(Boolean(entry.assets?.runtime), entry.assets?.embedHosts ?? [])
      : REACTIVE_CSP
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
 * The route's own manifest entry from the build's `routes.json`, or null when
 * the route is absent or the manifest can't be read — in which case the caller
 * falls back to the reactive CSP, matching the production `_headers` catch-all,
 * so an unknown route is never accidentally served the stricter policy.
 * @param {string} distRoot
 * @param {string | null} route
 * @returns {{ route: string, assets?: { runtime?: boolean, embedHosts?: string[] } } | null}
 */
function routeEntry(distRoot, route) {
  if (!route) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "routes.json"), "utf8"));
    return manifest.find((/** @type {{ route: string }} */ e) => e.route === route) ?? null;
  } catch {
    /* no/unreadable manifest → reactive default (the catch-all policy) */
    return null;
  }
}

/**
 * The conditional-request headers of an incoming request, forwarded by the
 * caller. Passing this object turns on validator-based caching for the
 * response: every served file (200s and the built 404) carries `Last-Modified`
 * (the file's mtime) and a strong `ETag` (`"<size>-<mtimeMs>"`), plus a
 * `Cache-Control` by file class — `no-cache` for HTML (always revalidate, but
 * revalidations 304), `public, max-age=3600` for framework assets under
 * `/__wd/` and media/image/font files (they change only across builds, and a
 * rebuild also changes the validators), and `no-cache` for everything else. A
 * matching `If-None-Match` (which takes precedence) or `If-Modified-Since`
 * gets a bare 304: the validators again, no body, no Content-Encoding.
 * Callers that omit it (the dev server) get no validators at all.
 * @typedef {object} ConditionalRequest
 * @property {string | string[] | undefined} [ifNoneMatch]
 * @property {string | string[] | undefined} [ifModifiedSince]
 */

/**
 * Serve a built file for a request URL out of `distRoot`, or a 404 page.
 *
 * When `options.acceptEncoding` carries the request's Accept-Encoding header,
 * a compressible body (HTML, CSS, JS, JSON, SVG, …) is negotiated and sent
 * brotli- or gzip-compressed with `Content-Encoding` + `Vary: Accept-Encoding`.
 * When `options.validators` carries the request's conditional headers,
 * validator-based caching (ETag/Last-Modified/Cache-Control, 304s) is on —
 * see {@link ConditionalRequest}; the validators describe the selected
 * variant, so they compose with the encoding negotiation (`Vary` already
 * covers Accept-Encoding, and a 304 to a compressible type repeats it).
 * Callers that omit both options (the dev server) get the exact pre-2.12
 * behavior: 200 bodies stream, nothing is re-encoded, no caching headers.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @param {http.ServerResponse} res Response to write to.
 * @param {{ acceptEncoding?: string | string[], validators?: ConditionalRequest }} [options]
 * @returns {void}
 */
export function serve(distRoot, url, res, options = {}) {
  const encoding = negotiateEncoding(options.acceptEncoding);
  const file = resolvePublicFile(distRoot, url || "/");
  const stat = file ? fs.statSync(file, { throwIfNoEntry: false }) : undefined;
  if (!file || !stat?.isFile()) {
    const notFound = path.join(distRoot, "404.html");
    const notFoundStat = fs.statSync(notFound, { throwIfNoEntry: false });
    const built = Boolean(notFoundStat?.isFile());
    const body = built
      ? fs.readFileSync(notFound)
      : "<h1>Not found</h1><p>This route is hidden or has not been created.</p>";
    // The 404 body is always text/html, always compressible. The BUILT 404 is
    // a real file, so it carries validators like any other HTML response; the
    // inline fallback has no file to validate and stays header-minimal.
    /** @type {Record<string, string>} */
    const headers = {
      "content-type": "text/html; charset=utf-8",
      ...htmlSecurityHeaders(distRoot, url)
    };
    if (options.validators && built) {
      const etag = strongEtag(/** @type {fs.Stats} */ (notFoundStat));
      headers.etag = etag;
      headers["last-modified"] = /** @type {fs.Stats} */ (notFoundStat).mtime.toUTCString();
      headers["cache-control"] = "no-cache";
      if (isFresh(options.validators, etag, /** @type {fs.Stats} */ (notFoundStat))) {
        sendNotModified(res, headers, true);
        return;
      }
    }
    sendBuffered(res, 404, headers, body, encoding);
    return;
  }
  const type = contentType(file);
  /** @type {Record<string, string>} */
  const headers = type.startsWith("text/html")
    ? { "content-type": type, ...htmlSecurityHeaders(distRoot, url) }
    : { "content-type": type };
  const compressible = isCompressibleType(type);
  if (options.validators) {
    const etag = strongEtag(stat);
    headers.etag = etag;
    headers["last-modified"] = stat.mtime.toUTCString();
    headers["cache-control"] = cacheControlFor(url || "/", type);
    // The validators describe the variant the request would select, so the
    // freshness check runs before any compression work.
    if (isFresh(options.validators, etag, stat)) {
      sendNotModified(res, headers, compressible);
      return;
    }
  }
  if (!encoding || !compressible) {
    // Identity path (or a non-compressible asset): stream, exactly as before.
    // A compressible type still varies on Accept-Encoding even when this
    // response is identity, so caches key correctly.
    if (compressible) headers.vary = appendVary(headers.vary, "Accept-Encoding");
    res.writeHead(200, headers);
    pipeFile(file, res);
    return;
  }
  let body;
  try {
    body = fs.readFileSync(file);
  } catch {
    // The file was statted servable a moment ago but cannot be read now (deleted
    // by a rebuild, permissions). Mirror pipeFile's never-crash contract.
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
    return;
  }
  sendBuffered(res, 200, headers, body, encoding);
}

/** Image and font extensions that earn the long-cache policy outside `/__wd/`. */
const LONG_CACHE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf"
]);

/**
 * The Cache-Control for a served file: `no-cache` for HTML (every load
 * revalidates, and the revalidation is a cheap 304), `public, max-age=3600`
 * for framework assets under `/__wd/` and for media/image/font files anywhere
 * (unchanged between builds, and any rebuild moves the validators), and
 * `no-cache` for everything else — a deliberately unopinionated default that
 * keeps correctness for files with no caching contract (routes.json, feeds).
 * @param {string} url Request URL (may include a query string).
 * @param {string} type The resolved content-type.
 * @returns {string}
 */
function cacheControlFor(url, type) {
  if (type.startsWith("text/html")) return "no-cache";
  const pathname = url.split("?")[0];
  if (pathname.startsWith("/__wd/")) return "public, max-age=3600";
  if (LONG_CACHE_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
    return "public, max-age=3600";
  }
  return "no-cache";
}

/**
 * A strong ETag for a served file: `"<size>-<mtimeMs>"`. Byte-exact static
 * files change exactly when size or mtime does, so no weak prefix.
 * @param {fs.Stats} stat
 * @returns {string}
 */
function strongEtag(stat) {
  return `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
}

/**
 * Whether the request's conditional headers match the file's current
 * validators. `If-None-Match` wins when present (RFC 7232 precedence: an
 * `If-Modified-Since` riding alongside is ignored), and uses weak comparison
 * semantics — a `*` matches anything, otherwise the client token must be the
 * ETag itself (browsers echo back exactly what they received).
 * `If-Modified-Since` compares at second precision, the granularity the
 * Last-Modified header itself carries.
 * @param {ConditionalRequest} request
 * @param {string} etag The file's current ETag.
 * @param {fs.Stats} stat
 * @returns {boolean}
 */
function isFresh(request, etag, stat) {
  const inm = headerValue(request.ifNoneMatch);
  if (inm !== undefined) {
    return inm
      .split(",")
      .some((candidate) => candidate.trim() === "*" || candidate.trim() === etag);
  }
  const ims = headerValue(request.ifModifiedSince);
  if (ims !== undefined) {
    const time = Date.parse(ims);
    if (Number.isNaN(time)) return false;
    return Math.floor(stat.mtimeMs / 1000) <= Math.floor(time / 1000);
  }
  return false;
}

/**
 * Join a possibly-arrayed header value into one string, or undefined.
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function headerValue(value) {
  return Array.isArray(value) ? value.join(",") : value;
}

/**
 * Answer 304: the validators and Cache-Control again (so the cached entry's
 * freshness state is refreshed), `Vary: Accept-Encoding` for compressible
 * types (the 304 revalidates one variant of several), and no body or body
 * headers — no Content-Type, no Content-Encoding.
 * @param {http.ServerResponse} res
 * @param {Record<string, string>} headers The 200 response's headers.
 * @param {boolean} compressible
 * @returns {void}
 */
function sendNotModified(res, headers, compressible) {
  /** @type {Record<string, string>} */
  const out = {
    etag: /** @type {string} */ (headers.etag),
    "last-modified": /** @type {string} */ (headers["last-modified"]),
    "cache-control": /** @type {string} */ (headers["cache-control"])
  };
  if (compressible) out.vary = "Accept-Encoding";
  res.writeHead(304, out);
  res.end();
}

/**
 * Write a buffered response body for a COMPRESSIBLE content-type, compressing
 * when an encoding was negotiated. Always appends `Vary: Accept-Encoding` so
 * the identity and compressed variants never poison a shared cache.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} headers Must include a compressible `content-type`.
 * @param {string | Buffer} body
 * @param {"br" | "gzip" | null} encoding
 * @returns {void}
 */
function sendBuffered(res, status, headers, body, encoding) {
  headers.vary = appendVary(headers.vary, "Accept-Encoding");
  if (encoding) {
    headers["content-encoding"] = encoding;
    body = compressBody(body, encoding);
  }
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * Pick the response encoding from an Accept-Encoding header value: brotli when
 * accepted, else gzip, else null (identity). Honors q-values, including an
 * explicit `q=0` refusal, and the `*` wildcard (an explicit entry beats it).
 * @param {string | string[] | undefined} header
 * @returns {"br" | "gzip" | null}
 */
export function negotiateEncoding(header) {
  if (!header) return null;
  /** @type {Map<string, number>} */
  const accepted = new Map();
  for (const part of String(header).split(",")) {
    const [token, ...params] = part.split(";");
    const name = token.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=").map((piece) => piece.trim());
      if (key === "q") q = Number.parseFloat(value) || 0;
    }
    accepted.set(name, q);
  }
  const br = accepted.get("br") ?? accepted.get("*") ?? 0;
  const gzip = accepted.get("gzip") ?? accepted.get("*") ?? 0;
  if (br > 0 && br >= gzip) return "br";
  if (gzip > 0) return "gzip";
  return null;
}

/**
 * Whether a content-type is worth compressing: any text/* type plus JSON,
 * JavaScript, XML, and SVG. Binary media, fonts, and already-compressed
 * formats are excluded — re-encoding them wastes CPU for no bytes saved.
 * @param {string} type A Content-Type value (parameters allowed).
 * @returns {boolean}
 */
export function isCompressibleType(type) {
  return /^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/.test(type);
}

/**
 * Append a token to a Vary header value without clobbering or duplicating
 * existing tokens (case-insensitive).
 * @param {string | undefined} existing
 * @param {string} value
 * @returns {string}
 */
export function appendVary(existing, value) {
  if (!existing) return value;
  const tokens = existing.split(",").map((token) => token.trim().toLowerCase());
  if (tokens.includes(value.toLowerCase())) return existing;
  return `${existing}, ${value}`;
}

/**
 * @param {string | Buffer} body
 * @param {"br" | "gzip"} encoding
 * @returns {Buffer}
 */
export function compressBody(body, encoding) {
  return encoding === "br" ? zlib.brotliCompressSync(body) : zlib.gzipSync(body);
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
  // A decoded NUL (%00) is a valid string here but every fs call on the
  // resulting path throws ERR_INVALID_ARG_VALUE out of the request handler,
  // killing the server. It can never name a built file, so it is a miss.
  if (cleanUrl.includes("\0")) return null;
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
  ".md": "text/markdown; charset=utf-8",
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
