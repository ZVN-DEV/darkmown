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
export function serve(distRoot: string, url: string, res: http.ServerResponse, options?: {
    acceptEncoding?: string | string[];
    validators?: ConditionalRequest;
}): void;
/**
 * Pick the response encoding from an Accept-Encoding header value: brotli when
 * accepted, else gzip, else null (identity). Honors q-values, including an
 * explicit `q=0` refusal, and the `*` wildcard (an explicit entry beats it).
 * @param {string | string[] | undefined} header
 * @returns {"br" | "gzip" | null}
 */
export function negotiateEncoding(header: string | string[] | undefined): "br" | "gzip" | null;
/**
 * Whether a content-type is worth compressing: any text/* type plus JSON,
 * JavaScript, XML, and SVG. Binary media, fonts, and already-compressed
 * formats are excluded — re-encoding them wastes CPU for no bytes saved.
 * @param {string} type A Content-Type value (parameters allowed).
 * @returns {boolean}
 */
export function isCompressibleType(type: string): boolean;
/**
 * Append a token to a Vary header value without clobbering or duplicating
 * existing tokens (case-insensitive).
 * @param {string | undefined} existing
 * @param {string} value
 * @returns {string}
 */
export function appendVary(existing: string | undefined, value: string): string;
/**
 * @param {string | Buffer} body
 * @param {"br" | "gzip"} encoding
 * @returns {Buffer}
 */
export function compressBody(body: string | Buffer, encoding: "br" | "gzip"): Buffer;
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
export function isServableFile(file: string): boolean;
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
export function pipeFile(file: string, res: http.ServerResponse): void;
/**
 * Resolve a request URL to an absolute file inside `distRoot`, guarding against
 * path traversal. Returns null when the resolved path escapes the root.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @returns {string | null}
 */
export function resolvePublicFile(distRoot: string, url: string): string | null;
/**
 * Map a file path to a response content-type by extension, defaulting to
 * `application/octet-stream` for unknown types.
 * @param {string} file File path or name.
 * @returns {string}
 */
export function contentType(file: string): string;
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
 */
export type ConditionalRequest = {
    ifNoneMatch?: string | string[] | undefined;
    ifModifiedSince?: string | string[] | undefined;
};
import http from "node:http";
