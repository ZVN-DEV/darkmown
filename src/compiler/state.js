// ---------------------------------------------------------------------------
// State declarations: the `:state` / `:store` / `:computed` / `:theme` handlers
// plus the shared declare* helpers (declareState/declareStore/declareErrorState)
// the `:fetch` and form handlers lean on to register their auto-declared keys.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, lineOf, recordSymbol, wdError } from "./context.js";
import { astOf, evalAst } from "./expr-ast.js";
import { escapeHtml, parseStateValue, resolveStateKey, safeScriptJson } from "./interpolation.js";
import { compileComputedExpr } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Concrete, compilable one-liners for the state-family hint tails + the catalog.
export const STATE_EXAMPLE = ":state count = 0";
export const STORE_EXAMPLE = ":store cart = []";
export const COMPUTED_EXAMPLE = ":computed total = items.length * 4";
export const THEME_EXAMPLE = ":theme";
const STATE_USE = `Use: :state name = value [persist|ephemeral] — e.g. ${STATE_EXAMPLE}`;

// ---------------------------------------------------------------------------
// PERSISTENCE IS ONE VOCABULARY, NOT TWO.
//
// `persist` means "survives a reload" and `ephemeral` means "does not", on every
// keyword that has a value. The keyword picks the DEFAULT — `:state` is
// ephemeral, `:store` and `:theme` persist — and the token, when present, always
// means what it says.
//
// It did not always. Each handler used to strip only its own token, so the other
// one stayed glued to the value and `parseStateValue`'s bare-string fallback
// turned it into data: `:store count = 0 persist` seeded the STRING "0 persist",
// compiled green, and first failed later at `count++`, far from the line that
// caused it. That is the one failure mode a compile-error repair loop cannot see,
// which is why this is a vocabulary change and not a new error message: the
// author wrote something unambiguous, so the compiler honours it instead of
// asking again.
//
// Text that genuinely ends in one of these words still quotes to keep it, the
// same escape hatch `:state` has always had.
// ---------------------------------------------------------------------------
const PERSISTENCE = String.raw`(?:\s+(persist|ephemeral))?`;

// ---------------------------------------------------------------------------
// A DECLARATION NAME IS A KEY ON THE RUNTIME'S STATE OBJECT, SO IT OBEYS THE
// SAME PROTOTYPE RULE AS A PATH SEGMENT.
//
// `getPath`/`validatePath` already reject `__proto__`/`constructor`/`prototype`
// as path SEGMENTS. The declaration NAME had no such guard, so
// `:state __proto__ = {"polluted": true}` compiled clean and seeded
// `{"__proto__":{...}}`; the runtime boots with `Object.assign(state, …)`, which
// writes through `[[Set]]` and therefore fires the inherited `__proto__` setter —
// hijacking the prototype of the runtime's own state object, so every undeclared
// key then resolves through injected data. Same three names, same reason, now
// enforced at every point a key enters `comp.state`.
// ---------------------------------------------------------------------------
const RESERVED_NAMES = ["__proto__", "constructor", "prototype"];

/**
 * Reject a declaration name that would land on `Object.prototype` rather than on
 * the state object itself. Called from {@link declareState}/{@link declareStore},
 * so every declaring directive (`:state`, `:store`, `:computed`, `:theme`,
 * `:fetch`, `:form … into`, `:slider … =`) is covered at one choke point.
 * @param {string} name
 * @param {string} directive The directive that declared it, for the message.
 * @param {Ctx} ctx
 * @returns {void}
 */
function rejectReservedName(name, directive, ctx) {
  if (!RESERVED_NAMES.includes(name)) return;
  const hint = `rename the key — "${name}" is inherited from Object.prototype, not owned by the state object, so writing it corrupts every other key`;
  throw wdError(
    `${directive} name "${name}" is not allowed in ${ctx.file}. Use: ${hint} — e.g. ${STATE_EXAMPLE}`,
    { code: "WD250", file: ctx.file, hint, example: STATE_EXAMPLE }
  );
}

/**
 * Reject a seed that is a BARE NAME already declared as state.
 *
 * `:state title = Hello world` storing the literal string is a feature — a
 * headline should not need quotes. But `:state b = a`, where `a` is declared
 * state, reads as "seed b from a" and silently stores the one-character STRING
 * "a" instead: the page compiles, renders the letter a, and nothing ever points
 * at the line that caused it. That is the silent class, so the compiler asks
 * once rather than guessing. A name that is NOT declared state keeps the
 * bare-string behavior, and quoting keeps it in every case.
 *
 * Only a single bare identifier qualifies — `Hello world`, `2 apples`, and
 * `a plan` are ordinary text and never trip this.
 * @param {unknown} value The parsed seed.
 * @param {string} raw The raw right-hand side, as written.
 * @param {string} directive `:state` or `:store`, for the message.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line`.
 * @returns {void}
 */
function rejectStateSeed(value, raw, directive, ctx, index) {
  // Test the RAW right-hand side, not the parsed value: quoting is the escape
  // hatch, and `"count"` parses to the same string a bare `count` does.
  const bare = raw.trim();
  if (typeof value !== "string" || !/^[A-Za-z_$][\w$]*$/.test(bare)) return;
  const key = resolveStateKey(bare, ctx);
  if (!key) return;
  const hint = `:computed name = ${bare} to derive it (or quote it — "${bare}" — to keep the literal text)`;
  throw wdError(
    `${directive} seed "${bare}" in ${at(ctx, index)} names the declared state "${key}", but a seed is stored verbatim, so this would hold the text "${bare}" and never track it. Use: ${hint} — e.g. ${COMPUTED_EXAMPLE}`,
    {
      code: "WD251",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: COMPUTED_EXAMPLE
    }
  );
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleState(line, ctx, index) {
  const match = line.match(
    new RegExp(String.raw`^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)${PERSISTENCE}$`)
  );
  if (!match)
    throw wdError(`Malformed :state in ${at(ctx, index)}: ${line}. ${STATE_USE}`, {
      code: "WD201",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: STATE_USE.slice("Use: ".length),
      example: STATE_EXAMPLE
    });
  const value = parseStateValue(match[2], at(ctx, index));
  rejectStateSeed(value, match[2], ":state", ctx, index);
  const key = declareState(match[1], value, ctx);
  recordSymbol(ctx, index, { kind: "state", name: key, detail: `${key} = ${match[2].trim()}` });
  const persistAttr = match[3] === "persist" ? ` data-wd-persist="${escapeHtml(key)}"` : "";
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
  rejectReservedName(name, ":state", ctx);
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
  const match = line.match(
    new RegExp(String.raw`^:store\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)${PERSISTENCE}$`)
  );
  if (!match)
    throw wdError(
      `Malformed :store in ${at(ctx, index)}: ${line}. Use: :store name = value [persist|ephemeral] — e.g. ${STORE_EXAMPLE}`,
      {
        code: "WD205",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: `:store name = value [persist|ephemeral] — e.g. ${STORE_EXAMPLE}`,
        example: STORE_EXAMPLE
      }
    );
  const value = parseStateValue(match[2], at(ctx, index));
  rejectStateSeed(value, match[2], ":store", ctx, index);
  const name = declareStore(match[1], value, ctx);
  recordSymbol(ctx, index, { kind: "store", name, detail: `${name} = ${match[2].trim()}` });
  const ephemeral = match[3] === "ephemeral" ? " data-wd-store-ephemeral" : "";
  return `<script type="application/json" data-wd-store="${escapeHtml(name)}"${ephemeral}>${safeScriptJson(value)}</script>`;
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
  rejectReservedName(name, ":store", ctx);
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
  const raw = match[2].trim();
  // A trailing bare `persist`/`ephemeral` used to be swallowed into the
  // expression and surface as WD234 "references unknown state \"persist\"",
  // which names something the author never wrote and points the fix the wrong
  // way: a repair loop reading it will declare a state called `persist`, which
  // compiles and is nonsense. `resolveStateKey` is the same lookup the
  // expression walker does, so a page that really does declare state by that
  // name still compiles as an ordinary reference.
  const stray = raw.match(/\s+(persist|ephemeral)$/);
  if (stray && !resolveStateKey(stray[1], ctx)) {
    const hint = `:computed values are derived, not stored, so they cannot ${stray[1] === "persist" ? "persist" : "be ephemeral"}. Persist the state they derive from instead — e.g. :state count = 0 persist`;
    throw wdError(`Persistence token on :computed in ${at(ctx, index)}: ${line}. ${hint}`, {
      code: "WD211",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: COMPUTED_EXAMPLE
    });
  }
  const expr = compileComputedExpr(raw, ctx);
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
  recordSymbol(ctx, index, { kind: "computed", name: key, detail: `${key} = ${match[2].trim()}` });
  return `<span data-wd-computed data-wd-computed-key="${escapeHtml(key)}" data-wd-computed-expr="${escapeHtml(JSON.stringify(ast))}"></span><script type="application/json" data-wd-state>${safeScriptJson({ [key]: initial ?? null })}</script>`;
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
  const match = line.match(
    new RegExp(String.raw`^:theme(?:\s+([A-Za-z_$][\w$]*))?(?:\s*=\s*(.+?))?${PERSISTENCE}$`)
  );
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
  recordSymbol(ctx, index, {
    kind: "theme",
    name: storeName,
    detail: `${storeName} = ${JSON.stringify(seed)}`
  });
  const ephemeral = match[3] === "ephemeral" ? " data-wd-store-ephemeral" : "";
  return `<script type="application/json" data-wd-store="${escapeHtml(storeName)}"${ephemeral}>${safeScriptJson(seed)}</script><span data-wd-theme="${escapeHtml(storeName)}" hidden></span>`;
}
