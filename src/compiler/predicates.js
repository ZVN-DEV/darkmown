// ---------------------------------------------------------------------------
// Predicate / expression compilers: the compile-time-validated whitelists behind
// `@loop … where`, `::: … .class when`, `:if a <op> b`, and `:computed`. Every
// operand is mapped through a fixed grammar to safe JS over the `I()`/`S()`/`C()`
// readers — no identifier survives un-mapped, so no raw user content is eval'd.
// ---------------------------------------------------------------------------

import { getPath, lookupVar, resolveStateKey } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Predicate} Predicate
 */

// Compile a `where` predicate to a safe JS boolean expression over I()/S()/C().
// Conditions (operand <op> operand) join with `and`/`or`; operands are loop-item
// paths, declared :state, numbers, or strings. No identifiers survive un-mapped.
/**
 * @param {string} raw
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {Predicate}
 */
export function compilePredicate(raw, itemName, ctx) {
  const parts = raw.split(/\s+(and|or)\s+/i);
  /** @type {string[]} */
  const pieces = [];
  let refsState = false;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      pieces.push(parts[i].toLowerCase() === "and" ? "&&" : "||");
      continue;
    }
    const cond = compileCondition(parts[i].trim(), itemName, ctx);
    refsState = refsState || cond.usesState;
    pieces.push(`(${cond.expr})`);
  }
  return { body: pieces.join(" "), refsState };
}

/**
 * @param {string} cond
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ expr: string, usesState: boolean }}
 */
function compileCondition(cond, itemName, ctx) {
  const m = cond.match(/^(.+?)\s+(contains|==|!=|>=|<=|>|<)\s+(.+)$/i);
  if (!m)
    throw new Error(
      `Malformed where-condition "${cond}" in ${ctx.file}. Use: ${itemName}.field contains state, or ${itemName}.field <op> value.`
    );
  const left = compileOperand(m[1].trim(), itemName, ctx);
  const right = compileOperand(m[3].trim(), itemName, ctx);
  const usesState = left.usesState || right.usesState;
  const op = m[2].toLowerCase();
  if (op === "contains") return { expr: `C(${left.code}, ${right.code})`, usesState };
  return { expr: `${left.code} ${op} ${right.code}`, usesState };
}

/**
 * @param {string} tok
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ code: string, usesState: boolean }}
 */
function compileOperand(tok, itemName, ctx) {
  if (/^"[^"]*"$/.test(tok) || /^'[^']*'$/.test(tok))
    return { code: JSON.stringify(tok.slice(1, -1)), usesState: false };
  if (/^-?\d+(?:\.\d+)?$/.test(tok)) return { code: tok, usesState: false };
  if (["true", "false", "null"].includes(tok)) return { code: tok, usesState: false };
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tok)) {
    throw new Error(
      `Unsupported operand "${tok}" in @loop where (${ctx.file}). Use ${itemName}.field, a :state name, a number, or a "string".`
    );
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw new Error(`Path "${tok}" is not allowed in @loop where (${ctx.file})`);
  }
  if (segs[0] === itemName)
    return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, usesState: false };
  const key = resolveStateKey(segs[0], ctx);
  if (!key) {
    throw new Error(
      `@loop where references unknown name "${segs[0]}" in ${ctx.file}. Use the loop item (${itemName}.field) or a declared :state.`
    );
  }
  const rest = segs.slice(1).join(".");
  return {
    code: `S(${JSON.stringify(key)}${rest ? `, ${JSON.stringify(rest)}` : ""})`,
    usesState: true
  };
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
const containsHelper = (a, b) =>
  String(a ?? "")
    .toLowerCase()
    .includes(String(b ?? "").toLowerCase());

/**
 * Evaluate a compiled predicate against a row at build time.
 * @param {string} body
 * @param {unknown} item
 * @param {Ctx} ctx
 * @returns {boolean}
 */
export function evalPredicate(body, item, ctx) {
  try {
    /** @param {string} [p] */
    const I = (p) => getPath(item, p ? p.split(".") : []);
    /** @param {string} k @param {string} [r] */
    const S = (k, r) => getPath(ctx.comp.state.get(k), r ? r.split(".") : []);
    return Boolean(new Function("I", "S", "C", `return (${body});`)(I, S, containsHelper));
  } catch {
    console.warn(
      `@loop where predicate "${body}" in ${ctx.file} could not be evaluated at build time; treating the row as excluded. Check the condition.`
    );
    return false;
  }
}

/**
 * Compile one operand of a `::: … .class when <predicate>` expression. Like the
 * `@loop where` operand, but also folds a static-scope value (a loop-unrolled
 * item field or include arg) to its build-time literal, so a fully-static
 * predicate can be evaluated at compile time. Mirrors `:if`'s scope→item→state
 * resolution order.
 * @param {string} tok
 * @param {Ctx} ctx
 * @param {string} what Directive label for error messages.
 * @returns {{ code: string, state: boolean, item: boolean }}
 */
function compileWhenOperand(tok, ctx, what) {
  if (/^"[^"]*"$/.test(tok) || /^'[^']*'$/.test(tok))
    return { code: JSON.stringify(tok.slice(1, -1)), state: false, item: false };
  if (/^-?\d+(?:\.\d+)?$/.test(tok)) return { code: tok, state: false, item: false };
  if (["true", "false", "null"].includes(tok)) return { code: tok, state: false, item: false };
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tok)) {
    throw new Error(
      `Unsupported operand "${tok}" in ${what} (${ctx.file}). Use item.field, a :state name, a number, or a "string".`
    );
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw new Error(`Path "${tok}" is not allowed in ${what} (${ctx.file})`);
  }
  const scoped = lookupVar(ctx.scope, segs[0]);
  if (scoped.found)
    return {
      code: JSON.stringify(getPath(scoped.value, segs.slice(1)) ?? null),
      state: false,
      item: false
    };
  if (ctx.loopItem && segs[0] === ctx.loopItem)
    return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, state: false, item: true };
  const key = resolveStateKey(segs[0], ctx);
  if (!key)
    throw new Error(
      `${what} references unknown name "${segs[0]}" in ${ctx.file}. Use a loop item field, a declared :state, a number, or a "string".`
    );
  const rest = segs.slice(1).join(".");
  return {
    code: `S(${JSON.stringify(key)}${rest ? `, ${JSON.stringify(rest)}` : ""})`,
    state: true,
    item: false
  };
}

/**
 * Compile a `::: … .class when <predicate>`. Allows `:if`-style bare truthy
 * paths and `where`-style `left <op> right` conditions joined by `and`/`or`.
 * Folds to a static verdict when every operand is build-known, else returns a
 * runtime body over I()/S()/C() plus whether it reads the reactive loop item
 * (which decides data-wd-each-class vs the global data-wd-class).
 * @param {string} raw
 * @param {Ctx} ctx
 * @param {string} [what] Directive label for error messages.
 * @returns {{ static: true, value: boolean } | { static: false, body: string, item: boolean }}
 */
export function compileWhen(raw, ctx, what = '"::: … when"') {
  const parts = raw.split(/\s+(and|or)\s+/i);
  /** @type {string[]} */
  const pieces = [];
  let usesState = false;
  let usesItem = false;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      pieces.push(parts[i].toLowerCase() === "and" ? "&&" : "||");
      continue;
    }
    let seg = parts[i].trim();
    // Optional leading `not` negates the whole sub-condition.
    let negate = false;
    if (/^not\s+/i.test(seg)) {
      negate = true;
      seg = seg.replace(/^not\s+/i, "").trim();
    }
    const opMatch = seg.match(/^(.+?)\s+(contains|==|!=|>=|<=|>|<)\s+(.+)$/i);
    let expr;
    if (opMatch) {
      const left = compileWhenOperand(opMatch[1].trim(), ctx, what);
      const right = compileWhenOperand(opMatch[3].trim(), ctx, what);
      usesState = usesState || left.state || right.state;
      usesItem = usesItem || left.item || right.item;
      const op = opMatch[2].toLowerCase();
      expr =
        op === "contains" ? `C(${left.code}, ${right.code})` : `${left.code} ${op} ${right.code}`;
    } else {
      const only = compileWhenOperand(seg, ctx, what);
      usesState = usesState || only.state;
      usesItem = usesItem || only.item;
      expr = only.code;
    }
    pieces.push(negate ? `(!(${expr}))` : `(${expr})`);
  }
  const body = pieces.join(" ");
  if (!usesState && !usesItem) return { static: true, value: evalPredicate(body, undefined, ctx) };
  return { static: false, body, item: usesItem };
}

/**
 * Compile a `:computed` expression into safe JS over the `S(key, path)` reader.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {string}
 */
export function compileComputedExpr(raw, ctx) {
  /** @type {string[]} */
  const strings = [];
  let expr = raw.replace(/"[^"\\]*"|'[^'\\]*'/g, (literal) => {
    // JSON.stringify fully escapes embedded ", \, etc. so the re-inserted literal
    // (line below) is an inert JS string and cannot terminate early to smuggle in
    // live code. Mirrors the SAFE @loop where path (compileOperand).
    strings.push(JSON.stringify(literal.slice(1, -1)));
    return `__WDSTR${strings.length - 1}__`;
  });
  if (/["'\\`]/.test(expr)) {
    throw new Error(`Unsupported string syntax in :computed expression "${raw}" (${ctx.file})`);
  }
  if (!/^[\w$.\s+\-*/%()<>=!&|]*$/.test(expr)) {
    throw new Error(
      `Unsupported syntax in :computed expression "${raw}" (${ctx.file}). Allowed: state names, numbers, strings, + - * / % ( ), comparisons, && || !.`
    );
  }
  if (/(^|[^=!<>])=(?!=)/.test(expr)) {
    throw new Error(`Assignment is not allowed in :computed expressions ("${raw}" in ${ctx.file})`);
  }
  // Reject function-call syntax: a `(` that directly follows an identifier, a
  // string literal, or a closing `)` (e.g. `x()`, `x.valueOf()`, `(a)(b)`). Only
  // grouping parens — where `(` follows an operator or starts the expression —
  // survive. Without this, `x.valueOf()` compiled to `S("x","valueOf")()`, a live
  // call; it is inert under the trusted-author/JSON-state model but contradicts the
  // SECURITY.md guarantee that function calls are compile errors. Runs BEFORE the
  // identifier→S() mapping so it never trips on the emitted helper calls.
  if (/[\w$)]\s*\(/.test(expr)) {
    throw new Error(
      `Function calls are not allowed in :computed expressions ("${raw}" in ${ctx.file})`
    );
  }
  expr = expr.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, (ref) => {
    if (/^__WDSTR\d+__$/.test(ref)) return ref;
    if (["true", "false", "null"].includes(ref)) return ref;
    const segs = ref.split(".");
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(
        `Path segment "${ref}" is not allowed in :computed expressions (${ctx.file})`
      );
    }
    const key = resolveStateKey(segs[0], ctx);
    if (!key) {
      throw new Error(
        `:computed references unknown state "${segs[0]}" in ${ctx.file}. Declare it with :state or :fetch first.`
      );
    }
    const rest = segs.slice(1).join(".");
    return `S(${JSON.stringify(key)}${rest ? `,${JSON.stringify(rest)}` : ""})`;
  });
  return expr.replace(/__WDSTR(\d+)__/g, (_, index) => strings[Number(index)]);
}
