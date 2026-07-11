// ---------------------------------------------------------------------------
// State declarations: the `:state` / `:store` / `:computed` / `:theme` handlers
// plus the shared declare* helpers (declareState/declareStore/declareErrorState)
// the `:fetch` and form handlers lean on to register their auto-declared keys.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at } from "./context.js";
import { FORMATTERS } from "./format.js";
import { escapeHtml, getPath, parseStateValue, safeScriptJson } from "./interpolation.js";
import { compileComputedExpr } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleState(line, ctx, index) {
  const match = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+persist)?$/);
  if (!match) throw new Error(`Malformed :state in ${at(ctx, index)}: ${line}`);
  const value = parseStateValue(match[2], at(ctx, index));
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
export function declareState(name, value, ctx) {
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
      `Malformed :store in ${at(ctx, index)}: ${line}. Use: :store name = value [ephemeral]`
    );
  const value = parseStateValue(match[2], at(ctx, index));
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
export function declareStore(name, value, ctx) {
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
export function declareErrorState(key, ctx) {
  const errorKey = `${key}_error`;
  if (!ctx.comp.state.has(errorKey)) ctx.comp.state.set(errorKey, null);
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
      `Malformed :computed in ${at(ctx, index)}: ${line}. Use: :computed total = items.length * 4`
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
      `Malformed :theme in ${at(ctx, index)}: ${line}. Use: :theme  (or  :theme name = "auto")`
    );
  }
  const name = match[1] || "theme";
  const seed = match[2] != null ? parseStateValue(match[2], at(ctx, index)) : "auto";
  const storeName = declareStore(name, seed, ctx);
  return `<script type="application/json" data-wd-store="${storeName}">${safeScriptJson(seed)}</script><span data-wd-theme="${storeName}" hidden></span>`;
}
