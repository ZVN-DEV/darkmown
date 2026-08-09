// ---------------------------------------------------------------------------
// State declarations: the `:state` / `:store` / `:computed` / `:theme` handlers
// plus the shared declare* helpers (declareState/declareStore/declareErrorState)
// the `:fetch` and form handlers lean on to register their auto-declared keys.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, lineOf, wdError } from "./context.js";
import { astOf, evalAst } from "./expr-ast.js";
import { escapeHtml, parseStateValue, safeScriptJson } from "./interpolation.js";
import { compileComputedExpr } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Concrete, compilable one-liners for the state-family hint tails + the catalog.
export const STATE_EXAMPLE = ":state count = 0";
export const STORE_EXAMPLE = ":store cart = []";
export const COMPUTED_EXAMPLE = ":computed total = items.length * 4";
export const THEME_EXAMPLE = ":theme";
const STATE_USE = `Use: :state name = value [persist] — e.g. ${STATE_EXAMPLE}`;

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleState(line, ctx, index) {
  const match = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+persist)?$/);
  if (!match)
    throw wdError(`Malformed :state in ${at(ctx, index)}: ${line}. ${STATE_USE}`, {
      code: "WD201",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: STATE_USE.slice("Use: ".length),
      example: STATE_EXAMPLE
    });
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
    throw wdError(`State cannot be declared inside a reactive @loop body (${ctx.file})`, {
      code: "WD202",
      file: ctx.file
    });
  if (ctx.comp.stores.has(name))
    throw wdError(
      `State "${name}" collides with a :store of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one — e.g. ${STORE_EXAMPLE}`,
      {
        code: "WD203",
        file: ctx.file,
        hint: `:store name = value for the global, or rename one — e.g. ${STORE_EXAMPLE}`,
        example: STORE_EXAMPLE
      }
    );
  const key = ctx.sections.length ? `${ctx.sections.at(-1)}:${name}` : name;
  if (ctx.comp.state.has(key))
    throw wdError(`State "${name}" is declared twice in the same scope (${ctx.file})`, {
      code: "WD204",
      file: ctx.file
    });
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
    throw wdError(
      `Malformed :store in ${at(ctx, index)}: ${line}. Use: :store name = value [ephemeral] — e.g. ${STORE_EXAMPLE}`,
      {
        code: "WD205",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: `:store name = value [ephemeral] — e.g. ${STORE_EXAMPLE}`,
        example: STORE_EXAMPLE
      }
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
    throw wdError(
      `Store "${name}" is declared twice in ${ctx.file}. Use: :store name = value — e.g. ${STORE_EXAMPLE}`,
      {
        code: "WD206",
        file: ctx.file,
        hint: `:store name = value — e.g. ${STORE_EXAMPLE}`,
        example: STORE_EXAMPLE
      }
    );
  if (ctx.comp.state.has(name))
    throw wdError(
      `Store "${name}" collides with a :state of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one — e.g. ${STORE_EXAMPLE}`,
      {
        code: "WD207",
        file: ctx.file,
        hint: `:store name = value for the global, or rename one — e.g. ${STORE_EXAMPLE}`,
        example: STORE_EXAMPLE
      }
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
    throw wdError(`Malformed :computed in ${at(ctx, index)}: ${line}. Use: ${COMPUTED_EXAMPLE}`, {
      code: "WD208",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: COMPUTED_EXAMPLE,
      example: COMPUTED_EXAMPLE
    });
  const expr = compileComputedExpr(match[2].trim(), ctx);
  // Parse the validated expression to the compact AST the runtime walks. A parse
  // failure means the RHS is syntactically malformed (e.g. `|| <`) — a compile
  // error, not a silently-broken binding.
  /** @type {any[]} */
  let ast;
  try {
    ast = astOf(expr);
  } catch {
    throw wdError(
      `Malformed :computed expression in ${at(ctx, index)}: ${line}. Use: ${COMPUTED_EXAMPLE}`,
      {
        code: "WD209",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: COMPUTED_EXAMPLE,
        example: COMPUTED_EXAMPLE
      }
    );
  }
  // Build-time mirror of the runtime: walk the AST (no eval) so `:computed total =
  // sum(...)` seeds the value the runtime recomputes. The walker is total over a
  // validated AST — state that isn't known at build time resolves to undefined and
  // folds to null, never throws — so parse-failure above is the only error path.
  const initial = evalAst(ast, undefined, ctx.comp);
  const key = declareState(match[1], initial ?? null, ctx);
  return `<span data-wd-computed data-wd-computed-key="${key}" data-wd-computed-expr="${escapeHtml(JSON.stringify(ast))}"></span><script type="application/json" data-wd-state>${safeScriptJson({ [key]: initial ?? null })}</script>`;
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
    throw wdError(
      `Malformed :theme in ${at(ctx, index)}: ${line}. Use: :theme  (or  :theme name = "auto") — e.g. ${THEME_EXAMPLE}`,
      {
        code: "WD210",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: `:theme  (or  :theme name = "auto") — e.g. ${THEME_EXAMPLE}`,
        example: THEME_EXAMPLE
      }
    );
  }
  const name = match[1] || "theme";
  const seed = match[2] != null ? parseStateValue(match[2], at(ctx, index)) : "auto";
  const storeName = declareStore(name, seed, ctx);
  return `<script type="application/json" data-wd-store="${storeName}">${safeScriptJson(seed)}</script><span data-wd-theme="${storeName}" hidden></span>`;
}
