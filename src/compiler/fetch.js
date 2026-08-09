// ---------------------------------------------------------------------------
// `:fetch`: the lifecycle-aware data-loading directive, plus the compile-time
// URL scheme guard (`validateFetchUrl`) the form/media/embed handlers reuse.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, lineOf, wdError } from "./context.js";
import {
  escapeHtml,
  resolveStateKey,
  safeScriptJson,
  stripQuotes,
  validatePath
} from "./interpolation.js";
import { declareState } from "./state.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// A concrete, compilable :fetch line for the hint tail + the directive catalog.
export const FETCH_EXAMPLE = ':fetch todos from "/api/todos.json" when=visible';

const FETCH_USE = `Use: :fetch name from "url" [method=…] [timeout=ms] [retry=N] [when=visible] [headers=key] [body=key] [refresh=url] — e.g. ${FETCH_EXAMPLE}`;

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
export function handleFetch(line, ctx, index) {
  const head = line.match(/^:fetch\s+([A-Za-z_$][\w$]*)\s+from\s+("[^"]+"|\S+)\s*(.*)$/);
  if (!head)
    throw wdError(`Malformed :fetch in ${at(ctx, index)}: ${line}. ${FETCH_USE}`, {
      code: "WD501",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: FETCH_USE.slice("Use: ".length),
      example: FETCH_EXAMPLE
    });
  const name = head[1];
  const url = validateFetchUrl(stripQuotes(head[2]), ctx);
  /** @type {Record<string, string>} */
  const opts = {};
  for (const part of head[3].trim().split(/\s+/).filter(Boolean)) {
    const kv = part.match(/^([A-Za-z]+)=(.+)$/);
    if (!kv)
      throw wdError(`Unknown :fetch option "${part}" in ${at(ctx, index)}. ${FETCH_USE}`, {
        code: "WD502",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    const optName = kv[1];
    if (!["method", "when", "timeout", "retry", "headers", "body", "refresh"].includes(optName)) {
      throw wdError(`Unknown :fetch option "${optName}" in ${at(ctx, index)}. ${FETCH_USE}`, {
        code: "WD502",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    }
    opts[optName] = stripQuotes(kv[2]);
  }

  if (
    opts.method &&
    !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(opts.method.toUpperCase())
  ) {
    throw wdError(
      `:fetch method "${opts.method}" is not allowed in ${at(ctx, index)}. ${FETCH_USE}`,
      {
        code: "WD503",
        file: ctx.file,
        line: lineOf(ctx, index)
      }
    );
  }
  if (opts.when && !["load", "visible"].includes(opts.when)) {
    throw wdError(`:fetch when "${opts.when}" is not allowed in ${at(ctx, index)}. ${FETCH_USE}`, {
      code: "WD504",
      file: ctx.file,
      line: lineOf(ctx, index)
    });
  }
  for (const n of ["timeout", "retry"]) {
    if (opts[n] !== undefined && !/^\d+$/.test(opts[n])) {
      throw wdError(
        `:fetch ${n} must be a non-negative integer in ${at(ctx, index)}. ${FETCH_USE}`,
        { code: "WD505", file: ctx.file, line: lineOf(ctx, index) }
      );
    }
  }
  if (opts.refresh !== undefined) {
    // Layer 2: a 401 triggers a token-refresh POST to this URL, then one retry.
    // The new token is written back into the `headers=` state, so it is required.
    if (!opts.headers) {
      throw wdError(
        `:fetch refresh= needs headers= (the state key holding the token to renew) in ${at(ctx, index)}. ${FETCH_USE}`,
        { code: "WD506", file: ctx.file, line: lineOf(ctx, index) }
      );
    }
    opts.refresh = validateFetchUrl(opts.refresh, ctx, ":fetch refresh");
  }

  // Extract `{ path }` dependency keys from the URL (validated against poison
  // segments). The runtime fills them from state on each (re)fetch.
  /** @type {string[]} */
  const deps = [];
  for (const dep of url.matchAll(/\{\s*([A-Za-z_$][\w$.]*)\s*\}/g)) {
    validatePath(dep[1], ctx, FETCH_USE);
    const headKey = dep[1].split(".")[0];
    if (!deps.includes(headKey)) deps.push(headKey);
  }

  // Auto-declare the four lifecycle keys. `name` is declared via declareState
  // (collision-checked); the derived keys are seeded directly.
  const key = declareState(name, null, ctx);
  ctx.comp.fetchKeys.add(key);
  /** @type {Record<string, unknown>} */
  const seeds = { [key]: null };
  for (const [suffix, seed] of [
    ["_error", null],
    ["_loading", false],
    ["_empty", false]
  ]) {
    const k = `${key}${suffix}`;
    if (!ctx.comp.state.has(k)) ctx.comp.state.set(k, seed);
    seeds[k] = seed;
  }

  /** @param {string} n @param {string | null | false | undefined} v */
  const attr = (n, v) =>
    v != null && v !== false && v !== "" ? ` data-wd-fetch-${n}="${escapeHtml(v)}"` : "";
  const marker =
    `<span data-wd-fetch data-wd-fetch-key="${key}" data-wd-fetch-url="${escapeHtml(url)}"` +
    attr("method", opts.method && opts.method.toUpperCase()) +
    attr("when", opts.when === "visible" ? "visible" : "") +
    attr("timeout", opts.timeout) +
    attr("retry", opts.retry) +
    attr("headers", opts.headers && resolveStateKey(opts.headers, ctx)) +
    attr("body", opts.body && resolveStateKey(opts.body, ctx)) +
    attr("refresh", opts.refresh) +
    attr("deps", deps.join(",")) +
    `></span>`;
  return `<script type="application/json" data-wd-state>${safeScriptJson(seeds)}</script>${marker}`;
}

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
export function validateFetchUrl(url, ctx, what = ":fetch") {
  const value = url.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects control characters in URLs/hrefs.
  if (value !== url || value === "" || /[\u0000-\u001F\u007F]/.test(value)) {
    throw wdError(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Use a relative path (/, ./, ../), an http(s):// URL, or a { state } interpolation.`,
      { code: "WD507", file: ctx.file }
    );
  }
  if (value.startsWith("//")) {
    throw wdError(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http:// or https:// explicitly.`,
      { code: "WD508", file: ctx.file }
    );
  }
  if (value.startsWith("{")) return value; // interpolation-first; the runtime percent-encodes state values
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && !["http", "https"].includes(scheme[1].toLowerCase())) {
    throw wdError(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. The "${scheme[1]}:" scheme is not allowed; use http://, https://, or a relative path.`,
      { code: "WD509", file: ctx.file }
    );
  }
  return value;
}
