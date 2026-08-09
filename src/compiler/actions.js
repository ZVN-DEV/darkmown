// ---------------------------------------------------------------------------
// Actions: the `:button` action-expression parser (the validated `{ op, target,
// value }` vocabulary) and its consumers — `:button` itself plus the two
// action-driven markers `:effect` (run on state change) and `:every` (run on a
// timer).
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

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Action} Action
 */

// A concrete, compilable :button line for the malformed hint + directive catalog.
export const BUTTON_EXAMPLE = ':button "Add one" -> count++';
const BUTTON_USE = `Use: :button "Label" -> action — e.g. ${BUTTON_EXAMPLE}`;

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleButton(line, ctx, index) {
  const match = line.match(/^:button\s+"([^"]+)"\s*->\s*(.+)$/);
  if (!match)
    throw wdError(`Malformed :button in ${at(ctx, index)}: ${line}. ${BUTTON_USE}`, {
      code: "WD301",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: BUTTON_USE.slice("Use: ".length),
      example: BUTTON_EXAMPLE
    });
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

// Concrete, compilable examples for the effect / every hint tails + catalog.
// (Effects run the :button action vocabulary — mutations, not expressions; use
// :computed for derived values. `searches++` is the canonical watch-and-act.)
export const EFFECT_EXAMPLE = ":effect query -> searches++";
const EFFECT_USE = `Use: :effect watchedState -> action[; action…] (actions use the :button vocabulary) — e.g. ${EFFECT_EXAMPLE}`;

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
    throw wdError(`Malformed :effect in ${at(ctx, index)}: ${line}. ${EFFECT_USE}`, {
      code: "WD302",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: EFFECT_USE.slice("Use: ".length),
      example: EFFECT_EXAMPLE
    });
  const segs = validatePath(match[1], ctx, EFFECT_USE);
  const key = resolveStateKey(segs[0], ctx);
  if (!key)
    throw wdError(
      `:effect watches unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`,
      { code: "WD303", file: ctx.file }
    );
  ctx.comp.assets.runtime = true;
  const watch = [key, ...segs.slice(1)].join(".");
  const action = parseAction(match[2], ctx);
  const actions = Array.isArray(action) ? action : [action];
  return `<script type="application/json" data-wd-effect>${safeScriptJson({ watch, actions })}</script>`;
}

export const EVERY_EXAMPLE = ":every 5s -> seconds++";
const EVERY_USE = `Use: :every <duration> -> action[; action…] — duration like 5s, 500ms, or 2m (actions use the :button vocabulary) — e.g. ${EVERY_EXAMPLE}`;

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
  if (!match)
    throw wdError(`Malformed :every in ${at(ctx, index)}: ${line}. ${EVERY_USE}`, {
      code: "WD304",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: EVERY_USE.slice("Use: ".length),
      example: EVERY_EXAMPLE
    });
  const ms = parseDuration(match[1]);
  if (ms == null || ms <= 0) {
    throw wdError(`:every duration "${match[1]}" is not valid in ${at(ctx, index)}. ${EVERY_USE}`, {
      code: "WD305",
      file: ctx.file,
      line: lineOf(ctx, index)
    });
  }
  ctx.comp.assets.runtime = true;
  const action = parseAction(match[2], ctx);
  const actions = Array.isArray(action) ? action : [action];
  return `<script type="application/json" data-wd-every>${safeScriptJson({ ms, actions })}</script>`;
}

// One concrete action expression, appended so a model copies `count++` rather
// than the schematic `name++`. The action vocabulary the directive catalog draws
// from lives here (the parser branches below), mirrored compactly in ACTION_USE.
export const ACTION_EXAMPLE = "count++";
export const ACTION_USE = `Use: name++, name--, n += k, n -= k, name = v, flag toggle, list append/prepend v, list toggle v, list remove v, x clear, obj merge other, obj delete key, name reset — chain with ";" — e.g. ${ACTION_EXAMPLE}`;

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
      throw wdError(
        `Button action targets unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`,
        { code: "WD306", file: ctx.file }
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
        throw wdError(
          `Button action "${raw}" needs ${add[1]} to be a :state list (declare it "${add[1]} = []") in ${ctx.file}.`,
          { code: "WD307", file: ctx.file }
        );
      }
      return { op: "append-row", target };
    }
    const target = resolveTarget(add[1]);
    const value = parseActionLiteral(rhs, ctx);
    if (Array.isArray(ctx.comp.state.get(target))) return { op: "append", target, value };
    if (typeof value === "number") return { op: "add", target, value };
    throw wdError(
      `Unsupported button action "${raw}" in ${ctx.file}. += with non-number values requires a list state target — declare it "${add[1]} = []".`,
      { code: "WD308", file: ctx.file }
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
        throw wdError(
          `Button action "${raw}" can't delete a row of a nested (item-relative) loop in ${ctx.file}. Per-row "remove" needs a top-level :state/:store list; carry the row into one (cart += ${ctx.loopItem}) and remove it there.`,
          { code: "WD309", file: ctx.file }
        );
      }
      if (resolveStateKey(remove[1], ctx) !== ctx.loopKey) {
        throw wdError(
          `Button action "${raw}" must target the :state list being looped (@loop ${remove[1]} into ${ctx.loopItem}) in ${ctx.file}.`,
          { code: "WD310", file: ctx.file }
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
  throw wdError(`Unsupported button action "${raw}" in ${ctx.file}. ${ACTION_USE}`, {
    code: "WD311",
    file: ctx.file,
    hint: ACTION_USE.slice("Use: ".length),
    example: ACTION_EXAMPLE
  });
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
      throw wdError(
        `Button action merge targets unknown state "${value}" in ${ctx.file}. Declare it first with :state ${value} = ...`,
        { code: "WD312", file: ctx.file }
      );
    return key;
  }
  const parsed = parseActionLiteral(value, ctx);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  throw wdError(
    `Unsupported merge operand "${raw}" in ${ctx.file}. Use: obj merge other (a state key or an inline {…} object) — e.g. settings merge patch`,
    {
      code: "WD313",
      file: ctx.file,
      hint: "obj merge other (a state key or an inline {…} object) — e.g. settings merge patch",
      example: "settings merge patch"
    }
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
      throw wdError(
        `Unsupported action literal "${raw}" in ${ctx.file}. Use: a quoted string, number, boolean, null, or valid JSON.`,
        { code: "WD314", file: ctx.file }
      );
    }
  }
  throw wdError(
    `Unsupported action literal "${raw}" in ${ctx.file}. Use: a quoted string, number, boolean, null, or valid JSON.`,
    { code: "WD314", file: ctx.file }
  );
}
