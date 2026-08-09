/**
 * Parse a keyword-arg `:fetch` directive into a lifecycle-aware marker.
 * Auto-declares four state keys (value/error/loading/empty), seeds them, and
 * emits `data-wd-fetch-*` attributes (url/method/when/timeout/retry/headers/
 * body/deps) consumed by the runtime's `startFetch`.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleFetch(line: string, ctx: Ctx, index: number): string;
/**
 * Validate a `:fetch` (or `refresh=`) URL's scheme at compile time. Mirrors the
 * `:try` href guard: relative paths (`/`, `./`, `../`, bare), an `http(s)://`
 * URL, or a leading `{ state }` interpolation are allowed; a protocol-relative
 * `//host` or any non-http(s) scheme (`file:`, `data:`, `javascript:`, …) is
 * rejected. Interpolated values are percent-encoded by the runtime, so a scheme
 * cannot be injected through state at request time.
 * @param {string} url
 * @param {Ctx} ctx
 * @param {string} [what] Option name for the error message.
 * @returns {string}
 */
export function validateFetchUrl(url: string, ctx: Ctx, what?: string): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 */
export const FETCH_EXAMPLE: ":fetch todos from \"/api/todos.json\" when=visible";
export type Ctx = import("./context.js").Ctx;
