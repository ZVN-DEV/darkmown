// ---------------------------------------------------------------------------
// Directive handlers: the `handle*` family dispatched per line by the body
// parser (state/store/fetch/computed/effect/form/input/bind/submit/textarea/
// select/checkbox/radio/button/if/include/container) plus the `:button` action
// parser and the documentation-demo directives (`:try`/`:note`/`:sprint`).
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { compileBody } from "./body.js";
import { at, createScope, LOOP_META } from "./context.js";
import { FORMATTERS } from "./format.js";
import { resolveInclude } from "./includes.js";
import {
  escapeHtml,
  getPath,
  humanizeName,
  lookupPath,
  lookupVar,
  parseScalar,
  parseStateValue,
  resolveStateKey,
  safeScriptJson,
  stripQuotes,
  validatePath
} from "./interpolation.js";
import { compileFile } from "./page.js";
import { compileComputedExpr, compileWhen, evalPredicate } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Action} Action
 */

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInclude(line, ctx, index) {
  const match = line.match(/^@include\s+(\S+)(?:\s+with\s+(.+))?$/);
  if (!match) throw new Error(`Malformed @include in ${at(ctx.file, index)}: ${line}`);
  const target = resolveInclude(match[1], ctx.file, ctx.context);
  const args = parseIncludeArgs(match[2] || "", ctx);
  const scope = createScope(ctx.scope, args);
  const child = compileFile(
    target,
    ctx.context,
    ctx.stack,
    scope,
    ctx.comp,
    ctx.sections,
    ctx.loopItem
  );
  return child.html;
}

/**
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {Record<string, unknown>}
 */
function parseIncludeArgs(raw, ctx) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const re = /([A-Za-z0-9_-]+)=("[^"]*"|'[^']*'|\{[^}]*\}|\S+)/g;
  for (const match of raw.matchAll(re)) {
    const value = match[2];
    if (value.startsWith("{")) {
      const expr = value.slice(1, -1).trim();
      const resolved = lookupPath(expr, ctx);
      if (!resolved.found) {
        throw new Error(
          `@include argument ${match[1]}={ ${expr} } in ${ctx.file} does not match any value in scope`
        );
      }
      args[match[1]] = resolved.value;
    } else {
      args[match[1]] = parseScalar(value);
    }
  }
  return args;
}

/**
 * @param {string} header
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleContainer(header, bodyLines, ctx, index) {
  let rest = header.trim();
  let tag = "section";
  /** @type {string[]} Static classes baked into class="". */
  const extraClass = [];
  /** @type {[string, string][]} Reactive loop-item class bindings (data-wd-each-class). */
  const eachClasses = [];
  /** @type {[string, string][]} Global state-driven class bindings (data-wd-class). */
  const stateClasses = [];
  let id = "";
  // Leading tag/name token (anything not starting with . or #). "section" keeps
  // the <section> tag; any other name becomes a <div> and also a class.
  const lead = rest.match(/^([^\s.#]\S*)/);
  let nameToken = "section";
  if (lead) {
    nameToken = lead[1];
    rest = rest.slice(lead[0].length).trim();
  }
  if (nameToken !== "section") {
    tag = "div";
    extraClass.push(nameToken);
  }
  while (rest.length) {
    if (rest.startsWith("#")) {
      const m = rest.match(/^#(\S+)/);
      id = m ? m[1] : "";
      rest = rest.slice((m ? m[0] : rest).length).trim();
      continue;
    }
    const cm = rest.match(/^\.([A-Za-z_][\w-]*)/);
    if (!cm)
      throw new Error(
        `Unexpected token "${rest.split(/\s+/)[0]}" in container "::: ${header}" in ${at(ctx.file, index)}`
      );
    const cls = cm[1];
    rest = rest.slice(cm[0].length).trim();
    // Optional `when <predicate>` makes the class reactive. The predicate runs to
    // the next ` .`/` #` token or the end of the header.
    const whenMatch = rest.match(/^when\s+(.+?)(?=\s+[.#]|$)/);
    if (whenMatch) {
      rest = rest.slice(whenMatch[0].length).trim();
      const compiled = compileWhen(whenMatch[1].trim(), ctx);
      if (compiled.static) {
        if (compiled.value) extraClass.push(cls);
      } else if (compiled.item) eachClasses.push([cls, compiled.body]);
      else stateClasses.push([cls, compiled.body]);
    } else {
      extraClass.push(cls);
    }
  }
  const explicitId = Boolean(id);
  if (!id) id = `wd-s${++ctx.comp.sectionCounter}`;

  ctx.sections.push(id);
  let inner;
  try {
    inner = compileBody(bodyLines, ctx);
  } finally {
    ctx.sections.pop();
  }
  const idAttr = explicitId ? ` id="${escapeHtml(id)}"` : "";
  const classAttr = extraClass.length ? ` class="${escapeHtml(extraClass.join(" "))}"` : "";
  let classBind = "";
  if (eachClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-each-class="${escapeHtml(JSON.stringify(eachClasses))}"`;
  }
  if (stateClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-class="${escapeHtml(JSON.stringify(stateClasses))}"`;
  }
  return `<${tag}${idAttr}${classAttr}${classBind}>\n${inner}\n</${tag}>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleState(line, ctx, index) {
  const match = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+persist)?$/);
  if (!match) throw new Error(`Malformed :state in ${at(ctx.file, index)}: ${line}`);
  const value = parseStateValue(match[2], at(ctx.file, index));
  const key = declareState(match[1], value, ctx);
  const persistAttr = match[3] ? ` data-wd-persist="${key}"` : "";
  return `<script type="application/json" data-wd-state${persistAttr}>${safeScriptJson({ [key]: value })}</script>`;
}

/**
 * Register a state key in the current section scope, enabling the runtime.
 * @param {string} name
 * @param {unknown} value
 * @param {Ctx} ctx
 * @returns {string} The fully-qualified state key.
 */
function declareState(name, value, ctx) {
  if (ctx.loopItem)
    throw new Error(`State cannot be declared inside a reactive @loop body (${ctx.file})`);
  if (ctx.comp.stores.has(name))
    throw new Error(
      `State "${name}" collides with a :store of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one.`
    );
  const key = ctx.sections.length ? `${ctx.sections.at(-1)}:${name}` : name;
  if (ctx.comp.state.has(key))
    throw new Error(`State "${name}" is declared twice in the same scope (${ctx.file})`);
  ctx.comp.state.set(key, value);
  ctx.comp.assets.runtime = true;
  return key;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleStore(line, ctx, index) {
  const match = line.match(/^:store\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+ephemeral)?$/);
  if (!match)
    throw new Error(
      `Malformed :store in ${at(ctx.file, index)}: ${line}. Use: :store name = value [ephemeral]`
    );
  const value = parseStateValue(match[2], at(ctx.file, index));
  const name = declareStore(match[1], value, ctx);
  const ephemeral = match[3] ? " data-wd-store-ephemeral" : "";
  return `<script type="application/json" data-wd-store="${name}"${ephemeral}>${safeScriptJson(value)}</script>`;
}

/**
 * Register a page-global store. The bare name is added to `comp.state` so every
 * resolver (interpolation, :if, @loop, :computed, actions) sees it, and tracked
 * in `comp.stores` for collision checks. Never section-scoped.
 * @param {string} name
 * @param {unknown} value
 * @param {Ctx} ctx
 * @returns {string} The store name (also its bare state key).
 */
function declareStore(name, value, ctx) {
  if (ctx.comp.stores.has(name))
    throw new Error(`Store "${name}" is declared twice in ${ctx.file}. Use: :store name = value`);
  if (ctx.comp.state.has(name))
    throw new Error(
      `Store "${name}" collides with a :state of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one.`
    );
  ctx.comp.stores.add(name);
  ctx.comp.state.set(name, value);
  ctx.comp.assets.runtime = true;
  return name;
}

/**
 * Seed a `<name>_error` state key (null) if absent. Shared by :fetch and the
 * round-trip :form so error fallbacks have a key to bind.
 * @param {string} key
 * @param {Ctx} ctx
 * @returns {void}
 */
function declareErrorState(key, ctx) {
  const errorKey = `${key}_error`;
  if (!ctx.comp.state.has(errorKey)) ctx.comp.state.set(errorKey, null);
}

const FETCH_USE =
  'Use: :fetch name from "url" [method=…] [timeout=ms] [retry=N] [when=visible] [headers=key] [body=key] [refresh=url]';

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
  if (!head) throw new Error(`Malformed :fetch in ${at(ctx.file, index)}: ${line}. ${FETCH_USE}`);
  const name = head[1];
  const url = validateFetchUrl(stripQuotes(head[2]), ctx);
  /** @type {Record<string, string>} */
  const opts = {};
  for (const part of head[3].trim().split(/\s+/).filter(Boolean)) {
    const kv = part.match(/^([A-Za-z]+)=(.+)$/);
    if (!kv)
      throw new Error(`Unknown :fetch option "${part}" in ${at(ctx.file, index)}. ${FETCH_USE}`);
    const optName = kv[1];
    if (!["method", "when", "timeout", "retry", "headers", "body", "refresh"].includes(optName)) {
      throw new Error(`Unknown :fetch option "${optName}" in ${at(ctx.file, index)}. ${FETCH_USE}`);
    }
    opts[optName] = stripQuotes(kv[2]);
  }

  if (
    opts.method &&
    !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(opts.method.toUpperCase())
  ) {
    throw new Error(
      `:fetch method "${opts.method}" is not allowed in ${at(ctx.file, index)}. ${FETCH_USE}`
    );
  }
  if (opts.when && !["load", "visible"].includes(opts.when)) {
    throw new Error(
      `:fetch when "${opts.when}" is not allowed in ${at(ctx.file, index)}. ${FETCH_USE}`
    );
  }
  for (const n of ["timeout", "retry"]) {
    if (opts[n] !== undefined && !/^\d+$/.test(opts[n])) {
      throw new Error(
        `:fetch ${n} must be a non-negative integer in ${at(ctx.file, index)}. ${FETCH_USE}`
      );
    }
  }
  if (opts.refresh !== undefined) {
    // Layer 2: a 401 triggers a token-refresh POST to this URL, then one retry.
    // The new token is written back into the `headers=` state, so it is required.
    if (!opts.headers) {
      throw new Error(
        `:fetch refresh= needs headers= (the state key holding the token to renew) in ${at(ctx.file, index)}. ${FETCH_USE}`
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
function validateFetchUrl(url, ctx, what = ":fetch") {
  const value = url.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects control characters in URLs/hrefs.
  if (value !== url || value === "" || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Use a relative path (/, ./, ../), an http(s):// URL, or a { state } interpolation.`
    );
  }
  if (value.startsWith("//")) {
    throw new Error(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http:// or https:// explicitly.`
    );
  }
  if (value.startsWith("{")) return value; // interpolation-first; the runtime percent-encodes state values
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && !["http", "https"].includes(scheme[1].toLowerCase())) {
    throw new Error(
      `Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. The "${scheme[1]}:" scheme is not allowed; use http://, https://, or a relative path.`
    );
  }
  return value;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleComputed(line, ctx, index) {
  const match = line.match(/^:computed\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (!match)
    throw new Error(
      `Malformed :computed in ${at(ctx.file, index)}: ${line}. Use: :computed total = items.length * 4`
    );
  const expr = compileComputedExpr(match[2].trim(), ctx);
  /** @type {unknown} */
  let initial;
  try {
    /** @param {string} key @param {string} [path] */
    const read = (key, path) => getPath(ctx.comp.state.get(key), path ? path.split(".") : []);
    // Build-time mirror of the runtime's AGG helper, so a `:computed total = sum(...)`
    // has the same initial value the runtime will recompute to.
    const agg = (
      /** @type {string} */ name,
      /** @type {any} */ list,
      /** @type {string} */ field
    ) => (FORMATTERS[name] ? FORMATTERS[name](list, field == null ? [] : [field]) : undefined);
    initial = new Function("S", "A", `return (${expr});`)(read, agg);
  } catch {
    console.warn(
      `:computed "${match[2].trim()}" in ${ctx.file} could not be evaluated at build time; falling back to null. Check the expression.`
    );
    initial = null;
  }
  const key = declareState(match[1], initial ?? null, ctx);
  return `<span data-wd-computed data-wd-computed-key="${key}" data-wd-computed-expr="${escapeHtml(expr)}"></span><script type="application/json" data-wd-state>${safeScriptJson({ [key]: initial ?? null })}</script>`;
}

/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleForm(line, bodyLines, ctx, index) {
  const rest = line.slice(":form".length).trim();
  const rawAction = rest.match(/action="([^"]+)"/)?.[1];
  const method = rest.match(/method="([^"]+)"/)?.[1] || "post";
  const into = rest.match(/(?:^|\s)into\s+([A-Za-z_$][\w$]*)/)?.[1];
  const leftover = rest
    .replace(/action="[^"]+"/, "")
    .replace(/method="[^"]+"/, "")
    .replace(/(?:^|\s)into\s+[A-Za-z_$][\w$]*/, "")
    .trim();
  if ((!rawAction && !into) || leftover) {
    throw new Error(
      `Malformed :form in ${at(ctx.file, index)}: ${line}. Use ':form into name' (client state), ':form action="/url"' (native post), or both (fetch round-trip into state).`
    );
  }
  const action = rawAction ? validateFetchUrl(rawAction, ctx, ":form action") : undefined;
  const inner = compileBody(bodyLines, ctx).trim();
  if (!into) {
    return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}">${inner}</form>`;
  }
  const key = declareState(into, null, ctx);
  declareErrorState(key, ctx);
  const actionAttrs = action
    ? ` action="${escapeHtml(action)}" method="${escapeHtml(method)}"`
    : "";
  return `<script type="application/json" data-wd-state>${safeScriptJson({ [key]: null })}</script><form data-wd-form="${key}"${actionAttrs}>${inner}</form>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInput(line, ctx, index) {
  const match = line.match(/^:input\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :input in ${at(ctx.file, index)}: ${line}`);
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let type = "text";
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw new Error(`Unknown :input flag "${token[3]}" in ${at(ctx.file, index)}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") {
      type = value;
      continue;
    }
    if (
      ![
        "placeholder",
        "value",
        "min",
        "max",
        "step",
        "pattern",
        "autocomplete",
        "aria-label",
        "aria-describedby"
      ].includes(token[1])
    ) {
      throw new Error(`Unknown :input attribute "${token[1]}" in ${at(ctx.file, index)}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name: if the author supplied neither aria-label nor aria-describedby,
  // derive a non-visual aria-label from the placeholder, else from the field name.
  // Never overrides an author-supplied aria attribute (zero layout impact).
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<input type="${escapeHtml(type)}" ${attrs.join(" ")}>`;
}

// :bind <state> [placeholder="…"] [type=…] — a live two-way input bound to a
// declared :state. Updates state on every keystroke; reflects state back when
// not focused. The state must be declared first (with :state).
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleBind(line, ctx, index) {
  const match = line.match(/^:bind\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
  if (!match)
    throw new Error(
      `Malformed :bind in ${at(ctx.file, index)}: ${line}. Use: :bind query placeholder="Search"`
    );
  const key = resolveStateKey(match[1], ctx);
  if (!key) {
    throw new Error(
      `:bind ${match[1]} in ${ctx.file} has no matching state. Declare it first: :state ${match[1]} = ""`
    );
  }
  ctx.comp.assets.runtime = true;
  let type = "text";
  let placeholder;
  let hasAria = false;
  const attrs = [];
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus"].includes(token[3]))
        throw new Error(`Unknown :bind flag "${token[3]}" in ${at(ctx.file, index)}`);
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") {
      type = value;
      continue;
    }
    if (!["placeholder", "autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :bind attribute "${token[1]}" in ${at(ctx.file, index)}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name (see handleInput): default a non-visual aria-label from the
  // placeholder, else a humanized version of the bound state key. The author's own
  // aria-label/aria-describedby always wins.
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  const initial = ctx.comp.state.get(key);
  const valueAttr =
    initial === undefined || initial === null ? "" : ` value="${escapeHtml(String(initial))}"`;
  return `<input type="${escapeHtml(type)}" data-wd-bind-input="${key}"${valueAttr} ${attrs.join(" ")}>`;
}

/**
 * `:slider name [= value] [min=N] [max=N] [step=N] [aria-label="…"] [persist]` — a
 * range input two-way bound to a NUMBER :state. With `= value` it declares the state
 * inline (seeding it numeric) and may `persist`; without `=` it binds to an already-
 * declared :state. Pure compile-time: it reuses the runtime's input binding (range
 * values coerce to Number), so it ships NO behavior module.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSlider(line, ctx, index) {
  const head = line.match(/^:slider\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
  if (!head)
    throw new Error(
      `Malformed :slider in ${at(ctx.file, index)}: ${line}. Use: :slider volume = 50 min=0 max=100 step=1`
    );
  const name = head[1];
  let rest = head[2].trim();

  /** @type {string | undefined} */
  let initialRaw;
  if (rest.startsWith("=")) {
    const valueMatch = rest.match(/^=\s*(\S+)\s*(.*)$/);
    if (!valueMatch)
      throw new Error(
        `Malformed :slider initial value in ${at(ctx.file, index)}: ${line}. Use: :slider ${name} = 50`
      );
    initialRaw = valueMatch[1];
    rest = valueMatch[2].trim();
  }

  let min = "0";
  let max = "100";
  let step = "1";
  /** @type {string | undefined} */
  let ariaLabel;
  let persist = false;
  for (const token of rest.matchAll(/([A-Za-z-]+)=("[^"]*"|\S+)|(\bpersist\b)/g)) {
    if (token[3]) {
      persist = true;
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "min") min = value;
    else if (token[1] === "max") max = value;
    else if (token[1] === "step") step = value;
    else if (token[1] === "aria-label") ariaLabel = value;
    else throw new Error(`Unknown :slider attribute "${token[1]}" in ${at(ctx.file, index)}`);
  }
  for (const [label, raw] of [
    ["min", min],
    ["max", max],
    ["step", step]
  ]) {
    if (!/^-?\d+(?:\.\d+)?$/.test(raw))
      throw new Error(`:slider ${label} must be a number in ${at(ctx.file, index)}: ${raw}`);
  }

  ctx.comp.assets.runtime = true;
  /** @type {string} */
  let key;
  let seed = "";
  if (initialRaw !== undefined) {
    const value = parseStateValue(initialRaw, at(ctx.file, index));
    if (typeof value !== "number")
      throw new Error(
        `:slider ${name} initial value must be a number in ${at(ctx.file, index)}: ${initialRaw}`
      );
    key = declareState(name, value, ctx);
    const persistAttr = persist ? ` data-wd-persist="${key}"` : "";
    seed = `<script type="application/json" data-wd-state${persistAttr}>${safeScriptJson({ [key]: value })}</script>`;
  } else {
    if (persist)
      throw new Error(
        `:slider persist only applies when declaring state inline (:slider ${name} = 0 … persist) in ${at(ctx.file, index)}`
      );
    const resolved = resolveStateKey(name, ctx);
    if (!resolved)
      throw new Error(
        `:slider ${name} in ${ctx.file} has no matching state. Declare it: :slider ${name} = 0 min=0 max=100`
      );
    key = resolved;
  }

  const initial = ctx.comp.state.get(key);
  const valueAttr =
    initial === undefined || initial === null ? "" : ` value="${escapeHtml(String(initial))}"`;
  const ariaAttr = ` aria-label="${escapeHtml(ariaLabel || humanizeName(name))}"`;
  return `${seed}<input type="range" data-wd-bind-input="${key}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}"${valueAttr}${ariaAttr}>`;
}

/**
 * `:carousel [autoplay=N]` … `:endcarousel` — a horizontally scroll-snapping
 * carousel. Contract: each DIRECT child element of the track is one slide, so put
 * each slide in its own block (e.g. a `::: slide` container) and give that block
 * the slide sizing in your skin — loose prose lines would each count as a slide.
 * Registers the `carousel` behavior (prev/next, dot nav, optional autoplay, mouse
 * drag); native CSS scroll-snap + the page skin handle layout and touch swipe.
 * `autoplay` is suppressed under `prefers-reduced-motion`. No runtime required.
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleCarousel(line, bodyLines, ctx, index) {
  const match = line.match(/^:carousel\s*(.*)$/);
  const rest = (match?.[1] || "").trim();
  let autoplayAttr = "";
  if (rest) {
    const auto = rest.match(/^autoplay=(\d+)$/);
    if (!auto)
      throw new Error(
        `Malformed :carousel in ${at(ctx.file, index)}: ${line}. Use: :carousel [autoplay=3000] … :endcarousel`
      );
    autoplayAttr = ` data-wd-carousel-autoplay="${auto[1]}"`;
  }
  ctx.comp.assets.behaviors.add("carousel");
  const inner = compileBody(bodyLines, ctx);
  return `<div class="wd-carousel" data-wd-carousel${autoplayAttr}>\n<div class="wd-carousel-track" data-wd-carousel-track>\n${inner}\n</div>\n</div>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSubmit(line, ctx, index) {
  const match = line.match(/^:submit\s+"([^"]+)"\s*$/);
  if (!match)
    throw new Error(`Malformed :submit in ${at(ctx.file, index)}: ${line}. Use: :submit "Label"`);
  return `<button type="submit">${escapeHtml(match[1])}</button>`;
}

/**
 * `:textarea name [placeholder="…"] [rows=N] [required]` → a `<textarea>`. Like
 * `:input`, it derives a non-visual aria-label from the placeholder (else the
 * humanized name) when the author supplies none. Captured by the runtime's
 * FormData exactly like `:input` — no runtime change needed.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleTextarea(line, ctx, index) {
  const match = line.match(/^:textarea\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match)
    throw new Error(
      `Malformed :textarea in ${at(ctx.file, index)}: ${line}. Use: :textarea name [placeholder="…"] [rows=N] [required]`
    );
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw new Error(`Unknown :textarea flag "${token[3]}" in ${at(ctx.file, index)}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (
      ![
        "placeholder",
        "rows",
        "cols",
        "minlength",
        "maxlength",
        "autocomplete",
        "aria-label",
        "aria-describedby"
      ].includes(token[1])
    ) {
      throw new Error(`Unknown :textarea attribute "${token[1]}" in ${at(ctx.file, index)}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<textarea ${attrs.join(" ")}></textarea>`;
}

/**
 * `:select name [required]` followed by `- Label` list lines → a `<select>` with
 * one `<option>` per label (value === label). Derives an aria-label from the
 * humanized name when none is given. Captured by FormData like the other fields.
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSelect(line, optionLines, ctx, index) {
  const match = line.match(/^:select\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match)
    throw new Error(
      `Malformed :select in ${at(ctx.file, index)}: ${line}. Use: :select name [required] then "- Label" lines`
    );
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw new Error(`Unknown :select flag "${token[3]}" in ${at(ctx.file, index)}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (!["autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :select attribute "${token[1]}" in ${at(ctx.file, index)}`);
    }
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(humanizeName(match[1]))}"`);
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw new Error(
      `:select "${match[1]}" in ${at(ctx.file, index)} has no options. Add "- Label" lines beneath it.`
    );
  }
  const opts = options
    .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
    .join("");
  return `<select ${attrs.join(" ")}>${opts}</select>`;
}

/**
 * `:checkbox name [required]` / `:radio name [required]` followed by `- Label`
 * lines → a labelled group of `<input type=checkbox|radio>`, each sharing `name`
 * with value === label and wrapped in its own `<label>`. The group is a
 * `role="group"` / `role="radiogroup"` container with an aria-label (explicit or
 * humanized from the name). Checkbox groups are marked `data-wd-multi="name"` so
 * the runtime captures every checked value as an array (`FormData.getAll`); radio
 * groups capture a single value like `:input`. Flags: `required` (radio → the
 * group; not emitted on checkboxes, where "at least one" has no native HTML form),
 * `disabled` (whole group), `autofocus` (first control).
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {"checkbox" | "radio"} kind
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleChoiceGroup(line, optionLines, ctx, kind, index) {
  const directive = `:${kind}`;
  const match = line.match(
    kind === "checkbox"
      ? /^:checkbox\s+([A-Za-z_][\w-]*)\s*(.*)$/
      : /^:radio\s+([A-Za-z_][\w-]*)\s*(.*)$/
  );
  if (!match)
    throw new Error(
      `Malformed ${directive} in ${at(ctx.file, index)}: ${line}. Use: ${directive} name [required] then "- Label" lines`
    );
  const name = match[1];
  const flags = [];
  let ariaLabel = null;
  let ariaDescribedby = null;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw new Error(`Unknown ${directive} flag "${token[3]}" in ${at(ctx.file, index)}`);
      }
      flags.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "aria-label") ariaLabel = value;
    else if (token[1] === "aria-describedby") ariaDescribedby = value;
    else throw new Error(`Unknown ${directive} attribute "${token[1]}" in ${at(ctx.file, index)}`);
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw new Error(
      `${directive} "${name}" in ${at(ctx.file, index)} has no options. Add "- Label" lines beneath it.`
    );
  }
  const isCheckbox = kind === "checkbox";
  const groupAttrs = [
    `class="wd-${isCheckbox ? "checkboxes" : "radios"}"`,
    `role="${isCheckbox ? "group" : "radiogroup"}"`
  ];
  if (isCheckbox) groupAttrs.push(`data-wd-multi="${escapeHtml(name)}"`);
  groupAttrs.push(`aria-label="${escapeHtml(ariaLabel || humanizeName(name))}"`);
  if (ariaDescribedby) groupAttrs.push(`aria-describedby="${escapeHtml(ariaDescribedby)}"`);
  const disabled = flags.includes("disabled");
  const required = flags.includes("required");
  const autofocus = flags.includes("autofocus");
  const controls = options
    .map((opt, idx) => {
      const a = [`type="${kind}"`, `name="${escapeHtml(name)}"`, `value="${escapeHtml(opt)}"`];
      if (disabled) a.push("disabled");
      if (required && !isCheckbox) a.push("required");
      if (autofocus && idx === 0) a.push("autofocus");
      return `<label><input ${a.join(" ")}> ${escapeHtml(opt)}</label>`;
    })
    .join("");
  return `<div ${groupAttrs.join(" ")}>${controls}</div>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleButton(line, ctx, index) {
  const match = line.match(/^:button\s+"([^"]+)"\s*->\s*(.+)$/);
  if (!match) throw new Error(`Malformed :button in ${at(ctx.file, index)}: ${line}`);
  ctx.comp.assets.runtime = true;
  const action = parseAction(match[2], ctx);
  if (Array.isArray(action)) {
    return `<button type="button" data-wd-actions="${escapeHtml(JSON.stringify(action))}">${escapeHtml(match[1])}</button>`;
  }
  const valueAttr =
    action.value === undefined
      ? ""
      : ` data-wd-value="${escapeHtml(JSON.stringify(action.value))}"`;
  return `<button type="button" data-wd-action="${action.op}" data-wd-target="${action.target}"${valueAttr}>${escapeHtml(match[1])}</button>`;
}

const EFFECT_USE =
  "Use: :effect watchedState -> action[; action…] (actions use the :button vocabulary).";

/**
 * Parse `:effect <watched> -> <actions>` into a zero-output marker the runtime
 * watches: when `<watched>` state changes, it runs `<actions>` (the same `:button`
 * action vocabulary, `;`-chained). For arbitrary side effects beyond `:computed`
 * (derive state) and fetch deps (auto-refetch).
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEffect(line, ctx, index) {
  const match = line.match(/^:effect\s+([A-Za-z_$][\w$.]*)\s*->\s*(.+)$/);
  if (!match)
    throw new Error(`Malformed :effect in ${at(ctx.file, index)}: ${line}. ${EFFECT_USE}`);
  const segs = validatePath(match[1], ctx, EFFECT_USE);
  const key = resolveStateKey(segs[0], ctx);
  if (!key)
    throw new Error(
      `:effect watches unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`
    );
  ctx.comp.assets.runtime = true;
  const watch = [key, ...segs.slice(1)].join(".");
  const action = parseAction(match[2], ctx);
  const actions = Array.isArray(action) ? action : [action];
  return `<script type="application/json" data-wd-effect>${safeScriptJson({ watch, actions })}</script>`;
}

const EVERY_USE =
  "Use: :every <duration> -> action[; action…] — duration like 5s, 500ms, or 2m (actions use the :button vocabulary).";

/**
 * Parse a duration token into milliseconds: `<int>[ms|s|m]`, defaulting to ms.
 * @param {string} raw
 * @returns {number | null}
 */
function parseDuration(raw) {
  const match = raw.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === "s" ? n * 1000 : match[2] === "m" ? n * 60000 : n;
}

/**
 * Parse `:every <duration> -> <actions>` into a marker the runtime drives on a
 * timer: every `<duration>` it runs `<actions>` (the same `:button` vocabulary,
 * `;`-chained), and the interval auto-pauses while the tab is hidden. The one time
 * primitive — behind live polling (`:every 5s -> board refetch`), clocks and
 * countdowns (`:every 1s -> seconds++`), and slideshow autoplay (`:every 4s -> slide++`).
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEvery(line, ctx, index) {
  const match = line.match(/^:every\s+(\S+)\s*->\s*(.+)$/);
  if (!match) throw new Error(`Malformed :every in ${at(ctx.file, index)}: ${line}. ${EVERY_USE}`);
  const ms = parseDuration(match[1]);
  if (ms == null || ms <= 0) {
    throw new Error(
      `:every duration "${match[1]}" is not valid in ${at(ctx.file, index)}. ${EVERY_USE}`
    );
  }
  ctx.comp.assets.runtime = true;
  const action = parseAction(match[2], ctx);
  const actions = Array.isArray(action) ? action : [action];
  return `<script type="application/json" data-wd-every>${safeScriptJson({ ms, actions })}</script>`;
}

/**
 * `:theme [name] [= "auto"]` declares a durable `:store` (default name `theme`,
 * seed `"auto"`) and reflects its value onto `<html data-theme>`. This layers a
 * manual light/dark switch over the OS preference: `"auto"` follows the skin's
 * `tokens dark` media query, while `"light"`/`"dark"` force the matching
 * `:root[data-theme]` scope. Wire a switch with ordinary store actions —
 * `:button "Dark" -> theme = "dark"`. Durable, so the choice survives reloads.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleTheme(line, ctx, index) {
  const match = line.match(/^:theme(?:\s+([A-Za-z_$][\w$]*))?(?:\s*=\s*(.+))?$/);
  if (!match) {
    throw new Error(
      `Malformed :theme in ${at(ctx.file, index)}: ${line}. Use: :theme  (or  :theme name = "auto")`
    );
  }
  const name = match[1] || "theme";
  const seed = match[2] != null ? parseStateValue(match[2], at(ctx.file, index)) : "auto";
  const storeName = declareStore(name, seed, ctx);
  return `<script type="application/json" data-wd-store="${storeName}">${safeScriptJson(seed)}</script><span data-wd-theme="${storeName}" hidden></span>`;
}

// ---------------------------------------------------------------------------
// Media — :video / :audio / :embed. Compile-time only (zero runtime): hardened
// HTML5 media and privacy-friendly, lazy iframe embeds. The extension stays the
// feature gate; these emit no `data-wd-*`, so a media-only page ships zero JS.
// ---------------------------------------------------------------------------

/** @type {Record<"video" | "audio", { flags: string[], attrs: string[] }>} */
const MEDIA_SPEC = {
  video: {
    flags: ["controls", "autoplay", "loop", "muted", "playsinline"],
    attrs: ["poster", "width", "height", "preload"]
  },
  audio: { flags: ["controls", "autoplay", "loop", "muted"], attrs: ["preload"] }
};

/**
 * `:video /clip.mp4 [poster=…] [width=…] [height=…] [preload=…] [controls] [autoplay]
 * [loop] [muted] [playsinline]` and `:audio /track.mp3 [preload=…] [controls] …` →
 * a hardened `<video>`/`<audio>`. Defaults: `preload="metadata"`, and `controls`
 * unless the clip is an `autoplay` background (autoplay also implies `muted`, which
 * browsers require). Author flags/attrs always win. URLs use the `:fetch` scheme
 * guard (relative or http(s)).
 * @param {string} line
 * @param {"video" | "audio"} kind
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleMedia(line, kind, ctx, index) {
  const match = line.match(new RegExp(`^:${kind}\\s+(\\S+)\\s*(.*)$`));
  if (!match) {
    throw new Error(
      `Malformed :${kind} in ${at(ctx.file, index)}: ${line}. Use: :${kind} /clip [controls] [autoplay] [loop] [muted]`
    );
  }
  const src = validateFetchUrl(stripQuotes(match[1]), ctx, `:${kind}`);
  const spec = MEDIA_SPEC[kind];
  /** @type {Set<string>} */
  const flags = new Set();
  /** @type {Map<string, string>} */
  const attrs = new Map();
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!spec.flags.includes(token[3]))
        throw new Error(`Unknown :${kind} flag "${token[3]}" in ${at(ctx.file, index)}`);
      flags.add(token[3]);
    } else {
      if (!spec.attrs.includes(token[1]))
        throw new Error(`Unknown :${kind} attribute "${token[1]}" in ${at(ctx.file, index)}`);
      attrs.set(token[1], stripQuotes(token[2]));
    }
  }
  // Sensible defaults; author input always wins.
  if (flags.has("autoplay")) flags.add("muted"); // browsers block unmuted autoplay
  if (kind === "audio" || !flags.has("autoplay")) flags.add("controls");
  const parts = [`src="${escapeHtml(src)}"`];
  if (attrs.has("poster"))
    parts.push(
      `poster="${escapeHtml(validateFetchUrl(/** @type {string} */ (attrs.get("poster")), ctx, `:${kind} poster`))}"`
    );
  for (const name of ["width", "height"]) {
    if (attrs.has(name))
      parts.push(`${name}="${escapeHtml(/** @type {string} */ (attrs.get(name)))}"`);
  }
  parts.push(`preload="${escapeHtml(attrs.get("preload") || "metadata")}"`);
  for (const flag of spec.flags) if (flags.has(flag)) parts.push(flag);
  return `<${kind} ${parts.join(" ")}></${kind}>`;
}

/**
 * `:embed <url> [title="…"]` → a lazy, privacy-friendly responsive iframe. A
 * YouTube or Vimeo URL is rewritten to its no-cookie / player embed; any other
 * http(s) URL becomes a generic 16:9 iframe. Inline styles keep the wrapper
 * self-contained (no framework CSS), so an embed-only page stays zero-JS/zero-CSS.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEmbed(line, ctx, index) {
  const match = line.match(/^:embed\s+(\S+)\s*(.*)$/);
  if (!match) {
    throw new Error(
      `Malformed :embed in ${at(ctx.file, index)}: ${line}. Use: :embed https://youtu.be/ID [title="…"]`
    );
  }
  const raw = stripQuotes(match[1]);
  let title = "";
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[1] !== "title")
      throw new Error(`Unknown :embed attribute "${token[1]}" in ${at(ctx.file, index)}`);
    title = stripQuotes(token[2]);
  }
  const { url, label } = resolveEmbed(raw, ctx);
  const iframe =
    `<iframe src="${escapeHtml(url)}" title="${escapeHtml(title || label)}" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
    `allowfullscreen style="width:100%;height:100%;border:0"></iframe>`;
  return `<div class="wd-embed" style="aspect-ratio:16/9">${iframe}</div>`;
}

/**
 * Map a watch/share URL to its embeddable form. YouTube → no-cookie embed, Vimeo →
 * player; anything else is validated as a generic http(s) iframe source.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {{ url: string, label: string }}
 */
function resolveEmbed(raw, ctx) {
  const youtube = raw.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/
  );
  if (youtube)
    return { url: `https://www.youtube-nocookie.com/embed/${youtube[1]}`, label: "YouTube video" };
  const vimeo = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { url: `https://player.vimeo.com/video/${vimeo[1]}`, label: "Vimeo video" };
  return { url: validateFetchUrl(raw, ctx, ":embed"), label: "Embedded content" };
}

/**
 * @param {string} line
 * @param {string[]} truthyLines
 * @param {string[]} falsyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleIf(line, truthyLines, falsyLines, ctx, index) {
  const condition = line.replace(/^:if\s+/, "").trim();
  // Fast path: a bare truthy dotted path (`:if open`, `:if item.done`). Keeps the
  // existing markup/behavior identical. Anything with operators (`>`, `==`, `and`,
  // `not`, …) falls through to the predicate path below.
  const match = condition.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
  if (match) {
    const segs = match[1].split(".");
    const head = segs[0];

    // Per-row meta vars in :if — only valid inside a loop.
    if (LOOP_META[head]) {
      if (!ctx.loopMeta)
        throw new Error(
          `":if ${match[1]}" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Use it inside a loop body.`
        );
      if (ctx.loopItem) {
        const truthy = compileBody(truthyLines, ctx).trim();
        const falsy = compileBody(falsyLines, ctx).trim();
        return `<span data-wd-each-if data-wd-meta="${LOOP_META[head]}"><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
      }
      // static: the meta boolean is in scope — fall through to the static branch below.
    }

    const staticValue = lookupVar(ctx.scope, head);
    if (staticValue.found) {
      const active = Boolean(getPath(staticValue.value, segs.slice(1)));
      return compileBody(active ? truthyLines : falsyLines, ctx);
    }

    if (ctx.loopItem && head === ctx.loopItem) {
      const truthy = compileBody(truthyLines, ctx).trim();
      const falsy = compileBody(falsyLines, ctx).trim();
      const rest = segs.slice(1).join(".");
      const pathAttr = ` data-wd-path="${escapeHtml(rest)}"`;
      return `<span data-wd-each-if${pathAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
    }

    const key = resolveStateKey(head, ctx);
    if (!key) {
      throw new Error(
        `:if ${match[1]} in ${ctx.file} does not match a :state or in-scope value. Declare it first.`
      );
    }
    ctx.comp.assets.runtime = true;
    const truthy = compileBody(truthyLines, ctx).trim();
    const falsy = compileBody(falsyLines, ctx).trim();
    const restPath = segs.slice(1).join(".");
    const pathAttr = restPath ? ` data-wd-path="${escapeHtml(restPath)}"` : "";
    const initialTruthy = Boolean(getPath(ctx.comp.state.get(key), segs.slice(1)));
    const active = initialTruthy ? truthy : falsy;
    return `<div data-wd-if="${key}"${pathAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
  }

  // Predicate path: a comparison / logical condition. Compiles through the same
  // whitelist as `@loop … where` / `.class when` (with `not`), so it folds at
  // build when static, drives a per-row each-if when it reads the loop item, and
  // a global if-region (evaluated each render) when it reads state. No raw eval.
  if (!condition)
    throw new Error(
      `Malformed :if in ${at(ctx.file, index)}: ${line}. Use ":if name" or ":if a <op> b [and|or|not …]".`
    );
  const compiled = compileWhen(condition, ctx, '":if"');
  if (compiled.static) return compileBody(compiled.value ? truthyLines : falsyLines, ctx);
  ctx.comp.assets.runtime = true;
  const truthy = compileBody(truthyLines, ctx).trim();
  const falsy = compileBody(falsyLines, ctx).trim();
  const exprAttr = ` data-wd-if-expr="${escapeHtml(compiled.body)}"`;
  if (compiled.item) {
    return `<span data-wd-each-if${exprAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
  }
  const initialTruthy = evalPredicate(compiled.body, undefined, ctx);
  const active = initialTruthy ? truthy : falsy;
  return `<div data-wd-if=""${exprAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
}

/**
 * Render the documentation-demo directives (`:try`, `:note`, `:sprint`).
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
export function renderDemoDirective(line, ctx) {
  const tryMatch = line.match(/^:try\s+"([^"]+)"\s+href="([^"]+)"$/);
  if (tryMatch) {
    const href = validateDemoHref(tryMatch[2], ctx);
    return `<a class="try-card" href="${escapeHtml(href)}"><span>Try</span>${escapeHtml(tryMatch[1])}</a>`;
  }
  const note = line.match(/^:note\s+"([^"]+)"$/);
  if (note) return `<aside class="note">${escapeHtml(note[1])}</aside>`;
  const sprint = line.match(/^:sprint\s+min=(\d+)\s+max=(\d+)\s+roles="([^"]+)"$/);
  if (sprint) {
    const roles = sprint[3]
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    return `<section class="sprint-board" data-min="${sprint[1]}" data-max="${sprint[2]}">${roles.map((role) => `<article><strong>${escapeHtml(role)}</strong><span>active lane</span></article>`).join("")}</section>`;
  }
  return "";
}

/**
 * Validate demo-card links without adding arbitrary URL passthrough.
 * @param {string} href
 * @param {Ctx} ctx
 * @returns {string}
 */
function validateDemoHref(href, ctx) {
  const value = href.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects control characters in URLs/hrefs.
  if (value !== href || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`
    );
  }
  if (value.startsWith("//")) {
    throw new Error(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http: or https: explicitly.`
    );
  }
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("#")
  ) {
    return value;
  }
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && ["http", "https", "mailto"].includes(scheme[1].toLowerCase())) {
    return value;
  }
  throw new Error(
    `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const ACTION_USE =
  'Use: name++, name--, n += k, n -= k, name = v, flag toggle, list append/prepend v, list toggle v, list remove v, x clear, obj merge other, obj delete key, name reset — chain with ";".';

/**
 * Parse a `:button` action expression into a validated `{ op, target, value }`,
 * or — when `;`-separated — an ordered array of them applied in sequence.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {Action | Action[]}
 */
function parseAction(raw, ctx) {
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts.map((part) => parseSingleAction(part, raw, ctx));
  return parseSingleAction(raw.trim(), raw, ctx);
}

/**
 * Parse one (non-`;`) action expression into a validated `{ op, target, value }`.
 * Targets may be dotted paths (`cart.count`); a bare name is a 1-segment path.
 * @param {string} expression
 * @param {string} raw The full original action source (for error context).
 * @param {Ctx} ctx
 * @returns {Action}
 */
function parseSingleAction(expression, raw, ctx) {
  const PATH = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";
  /** @param {string} name @returns {string} */
  const resolveTarget = (name) => {
    const segs = validatePath(name, ctx, ACTION_USE);
    const key = resolveStateKey(segs[0], ctx);
    if (!key) {
      throw new Error(
        `Button action targets unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`
      );
    }
    return [key, ...segs.slice(1)].join(".");
  };

  const increment = expression.match(new RegExp(`^(${PATH})\\+\\+$`));
  if (increment) return { op: "inc", target: resolveTarget(increment[1]) };
  const decrement = expression.match(new RegExp(`^(${PATH})--$`));
  if (decrement) return { op: "dec", target: resolveTarget(decrement[1]) };
  const sub = expression.match(new RegExp(`^(${PATH})\\s*-=\\s*(.+)$`));
  if (sub)
    return { op: "sub", target: resolveTarget(sub[1]), value: parseActionLiteral(sub[2], ctx) };
  // Per-row: carry the current loop item into another list — `cart += product`.
  // Only inside a reactive @loop; the runtime resolves the row from the DOM.
  const add = expression.match(new RegExp(`^(${PATH})\\s*\\+=\\s*(.+)$`));
  if (add) {
    const rhs = add[2].trim();
    if (ctx.loopItem && rhs === ctx.loopItem) {
      const target = resolveTarget(add[1]);
      if (!Array.isArray(ctx.comp.state.get(target))) {
        throw new Error(
          `Button action "${raw}" needs ${add[1]} to be a :state list (declare it "${add[1]} = []") in ${ctx.file}.`
        );
      }
      return { op: "append-row", target };
    }
    const target = resolveTarget(add[1]);
    const value = parseActionLiteral(rhs, ctx);
    if (Array.isArray(ctx.comp.state.get(target))) return { op: "append", target, value };
    if (typeof value === "number") return { op: "add", target, value };
    throw new Error(
      `Unsupported button action "${raw}" in ${ctx.file}. += with non-number values requires a list state target — declare it "${add[1]} = []".`
    );
  }
  // `flag toggle` (no operand) → boolean flip; `list toggle v` → member-toggle.
  const toggle = expression.match(new RegExp(`^(${PATH})\\s+toggle(?:\\s+(.+))?$`));
  if (toggle) {
    const target = resolveTarget(toggle[1]);
    if (toggle[2] === undefined) return { op: "toggle", target };
    return { op: "member-toggle", target, value: parseActionLiteral(toggle[2], ctx) };
  }
  const prepend = expression.match(new RegExp(`^(${PATH})\\s+(?:append|prepend)\\s+(.+)$`));
  if (prepend) {
    const op = expression.includes(" prepend ") ? "prepend" : "append";
    return { op, target: resolveTarget(prepend[1]), value: parseActionLiteral(prepend[2], ctx) };
  }
  // Per-row: remove the current row from the list being looped — `todos remove todo`.
  // Disambiguation: operand IS the loop item name → `remove` (current row);
  // otherwise the operand is a value → `remove-value`.
  const remove = expression.match(new RegExp(`^(${PATH})\\s+remove\\s+(.+)$`));
  if (remove) {
    const operand = remove[2].trim();
    if (ctx.loopItem && operand === ctx.loopItem) {
      // A nested (item-relative) loop has a loop item but no top-level state key —
      // its source is a path off the outer row, which the runtime's row-remove
      // can't target. Fail loud with the honest workaround.
      if (!ctx.loopKey) {
        throw new Error(
          `Button action "${raw}" can't delete a row of a nested (item-relative) loop in ${ctx.file}. Per-row "remove" needs a top-level :state/:store list; carry the row into one (cart += ${ctx.loopItem}) and remove it there.`
        );
      }
      if (resolveStateKey(remove[1], ctx) !== ctx.loopKey) {
        throw new Error(
          `Button action "${raw}" must target the :state list being looped (@loop ${remove[1]} into ${ctx.loopItem}) in ${ctx.file}.`
        );
      }
      return { op: "remove", target: ctx.loopKey };
    }
    return {
      op: "remove-value",
      target: resolveTarget(remove[1]),
      value: parseActionLiteral(operand, ctx)
    };
  }
  const clear = expression.match(new RegExp(`^(${PATH})\\s+clear$`));
  if (clear) return { op: "clear", target: resolveTarget(clear[1]) };
  const merge = expression.match(new RegExp(`^(${PATH})\\s+merge\\s+(.+)$`));
  if (merge)
    return {
      op: "merge",
      target: resolveTarget(merge[1]),
      value: parseMergeOperand(merge[2], ctx)
    };
  const del = expression.match(new RegExp(`^(${PATH})\\s+delete\\s+(.+)$`));
  if (del)
    return { op: "delete", target: resolveTarget(del[1]), value: parseActionLiteral(del[2], ctx) };
  const reset = expression.match(new RegExp(`^(${PATH})\\s+reset$`));
  if (reset) return { op: "reset", target: resolveTarget(reset[1]) };
  // `name refetch` re-invokes the matching :fetch node. The target is the fetch
  // key (bare name); the runtime finds the [data-wd-fetch-key] node and re-runs.
  const refetch = expression.match(new RegExp(`^(${PATH})\\s+refetch$`));
  if (refetch) return { op: "refetch", target: resolveTarget(refetch[1]) };
  const assign = expression.match(new RegExp(`^(${PATH})\\s*=\\s*(.+)$`));
  if (assign)
    return {
      op: "set",
      target: resolveTarget(assign[1]),
      value: parseActionLiteral(assign[2], ctx)
    };
  throw new Error(`Unsupported button action "${raw}" in ${ctx.file}. ${ACTION_USE}`);
}

/**
 * `merge` operand: either an inline JSON object literal, or a state/store key
 * name (emitted as a string the runtime resolves via getPath).
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {unknown}
 */
function parseMergeOperand(raw, ctx) {
  const value = raw.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(value)) {
    const key = resolveStateKey(value, ctx);
    if (!key)
      throw new Error(
        `Button action merge targets unknown state "${value}" in ${ctx.file}. Declare it first with :state ${value} = ...`
      );
    return key;
  }
  const parsed = parseActionLiteral(value, ctx);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  throw new Error(
    `Unsupported merge operand "${raw}" in ${ctx.file}. Use: obj merge other (a state key or an inline {…} object).`
  );
}

/**
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {unknown}
 */
function parseActionLiteral(raw, ctx) {
  const value = raw.trim();
  if (/^["'].*["']$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^[[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(
        `Unsupported action literal "${raw}" in ${ctx.file}. Use: a quoted string, number, boolean, null, or valid JSON.`
      );
    }
  }
  throw new Error(
    `Unsupported action literal "${raw}" in ${ctx.file}. Use: a quoted string, number, boolean, null, or valid JSON.`
  );
}
