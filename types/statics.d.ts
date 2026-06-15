/**
 * Serve a built file for a request URL out of `distRoot`, or a 404 page.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @param {http.ServerResponse} res Response to write to.
 * @returns {void}
 */
export function serve(distRoot: string, url: string, res: http.ServerResponse): void;
/**
 * Resolve a request URL to an absolute file inside `distRoot`, guarding against
 * path traversal. Returns null when the resolved path escapes the root.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} url Request URL (may include a query string).
 * @returns {string | null}
 */
export function resolvePublicFile(distRoot: string, url: string): string | null;
/**
 * Map a file path to a response content-type, defaulting to `text/html`.
 * @param {string} file File path or name.
 * @returns {string}
 */
export function contentType(file: string): string;
import http from "node:http";
