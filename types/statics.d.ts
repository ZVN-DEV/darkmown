/**
 * Serve a built file for a request URL out of `distRoot`, or a 404 page.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @param {http.ServerResponse} res Response to write to.
 * @returns {void}
 */
export function serve(distRoot: string, url: string, res: http.ServerResponse): void;
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
import http from "node:http";
