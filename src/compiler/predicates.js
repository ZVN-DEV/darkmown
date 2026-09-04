// ---------------------------------------------------------------------------
// Predicate / expression compilers: the compile-time-validated whitelists behind
// `@loop … where`, `::: … .class when`, `:if a <op> b`, and `:computed`. Every
// operand is mapped through a fixed grammar to safe JS over the `I()`/`S()`/`C()`
// readers — no identifier survives un-mapped, so no raw user content is eval'd.
// ---------------------------------------------------------------------------

import { wdError } from "./context.js";
import { astOf, evalAst } from "./expr-ast.js";
import { getPath, lookupVar, resolveStateKey } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Predicate} Predicate
 */

// The comparison operators a `where` / `.class when` / `:if` / `:computed`
// condition may use, longest-match first so `>=` wins over `>`. The single
// source of truth: the operator regex is built from this list, and the directive
// catalog + GBNF grammar enumerate the same array (drift-guarded in tests).
export const PREDICATE_OPS = ["contains", "==", "!=", ">=", "<=", ">", "<"];

// The logical joiners between conditions (`and`/`or`), plus a leading `not` the
// `.class when` / `:if` paths accept. Catalogued alongside the operators.
export const PREDICATE_JOINERS = ["and", "or", "not"];

// `left <op> right` where <op> is one of PREDICATE_OPS. Built from the array so
// adding an operator in one place updates the parser and the catalog together.
const CONDITION_RE = new RegExp(`^(.+?)\\s+(${PREDICATE_OPS.join("|")})\\s+(.+)$`, "i");

// One ` and `/` or ` joiner, matched STICKILY at a cursor so {@link splitJoiners}
// can skip over quoted operands instead of splitting inside them.
const JOINER_RE = /\s+(and|or)\s+/iy;

/**
 * Split a predicate at its TOP-LEVEL `and`/`or` joiners, never inside a quoted
 * operand — so `where p.name contains "cats and dogs"` stays ONE condition
 * instead of being torn into `p.name contains "cats` / `dogs"`, which no operand
 * grammar can accept. Mirrors the quote-aware `splitTop` the format-pipe parser
 * uses (copied rather than imported: `splitTop` is private to `format.js`).
 *
 * Returns the same alternating shape the previous `raw.split(/\s+(and|or)\s+/i)`
 * produced — operands at even indexes, joiners at odd — so both callers keep
 * their `i % 2` walk.
 * @param {string} raw
 * @returns {string[]}
 */
function splitJoiners(raw) {
  /** @type {string[]} */
  const parts = [];
  let cur = "";
  let quote = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = "";
      i++;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      i++;
    } else {
      JOINER_RE.lastIndex = i;
      const joiner = JOINER_RE.exec(raw);
      if (joiner) {
        parts.push(cur, joiner[1]);
        cur = "";
        i += joiner[0].length;
      } else {
        cur += c;
        i++;
      }
    }
  }
  parts.push(cur);
  return parts;
}

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
  const parts = splitJoiners(raw);
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
  const m = cond.match(CONDITION_RE);
  if (!m) {
    const hint = `${itemName}.field contains state, or ${itemName}.field <op> value — e.g. ${itemName}.price < 50`;
    throw wdError(`Malformed where-condition "${cond}" in ${ctx.file}. Use: ${hint}`, {
      code: "WD220",
      file: ctx.file,
      hint,
      example: `${itemName}.price < 50`
    });
  }
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
    throw wdError(
      `Unsupported operand "${tok}" in @loop where (${ctx.file}). Use ${itemName}.field, a :state name, a number, or a "string".`,
      { code: "WD221", file: ctx.file }
    );
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw wdError(`Path "${tok}" is not allowed in @loop where (${ctx.file})`, {
      code: "WD222",
      file: ctx.file
    });
  }
  if (segs[0] === itemName)
    return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, usesState: false };
  const key = resolveStateKey(segs[0], ctx);
  if (!key) {
    throw wdError(
      `@loop where references unknown name "${segs[0]}" in ${ctx.file}. Use the loop item (${itemName}.field) or a declared :state.`,
      { code: "WD223", file: ctx.file }
    );
  }
  const rest = segs.slice(1).join(".");
  return {
    code: `S(${JSON.stringify(key)}${rest ? `, ${JSON.stringify(rest)}` : ""})`,
    usesState: true
  };
}

/**
 * Evaluate a compiled predicate against a row at build time by walking its AST —
 * the same closed evaluator the runtime uses, so the fold matches. No eval.
 *
 * `what` names the CONSTRUCT the body came from. Three directives share this
 * evaluator (`@loop … where`, `::: … .class when`, `:if`), and the warning used
 * to say "@loop where predicate … treating the row as excluded" for all of
 * them — pointing an author at a loop they never wrote when a `:if` folded.
 * @param {string} body
 * @param {unknown} item
 * @param {Ctx} ctx
 * @param {string} [what] Directive label, e.g. `":if"`. Defaults to `@loop where`.
 * @returns {boolean}
 */
export function evalPredicate(body, item, ctx, what = "@loop where") {
  try {
    return Boolean(evalAst(astOf(body), item, ctx.comp));
  } catch {
    // Only `@loop where` filters rows; for the others the verdict is the branch
    // (or the class), so say what actually happens rather than naming a row.
    const outcome =
      what === "@loop where" ? "treating the row as excluded" : "treating it as false";
    console.warn(
      `${what} predicate "${body}" in ${ctx.file} could not be evaluated at build time; ${outcome}. Check the condition.`
    );
    return false;
  }
}

/**
 * Compile one operand of a `::: … .class when <predicate>` expression. Like the
 * `@loop where` operand, but also folds a static-scope value (a loop-unrolled
 * item field or include arg) to its build-time literal, so a fully-static
 * predicate can be evaluated at compile time.
 *
 * RESOLUTION ORDER is the framework-wide one — reactive loop item → static scope
 * → declared state — the same order `{ }` interpolation, `:if`, and `@loop …
 * where` use. It used to try static scope FIRST here, so a reactive row item
 * whose name was also bound in an enclosing static scope folded to the OUTER
 * value at build time and hard-baked the wrong verdict, while `{ item.field }`
 * two lines away resolved to the reactive row.
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
    throw wdError(
      `Unsupported operand "${tok}" in ${what} (${ctx.file}). Use item.field, a :state name, a number, or a "string".`,
      { code: "WD224", file: ctx.file }
    );
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw wdError(`Path "${tok}" is not allowed in ${what} (${ctx.file})`, {
      code: "WD225",
      file: ctx.file
    });
  }
  if (ctx.loopItem && segs[0] === ctx.loopItem)
    return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, state: false, item: true };
  const scoped = lookupVar(ctx.scope, segs[0]);
  if (scoped.found) {
    // `JSON.stringify` returns UNDEFINED (not a string) for a value it cannot
    // represent — a function, most notably, which is what an `Object.prototype`
    // member folds to. Splicing that into the expression produced the literal
    // text `undefined`, which the AST re-parser rejects with a raw uncoded
    // Error. `null` is the honest, parseable stand-in for "no value here".
    const literal = JSON.stringify(getPath(scoped.value, segs.slice(1)) ?? null);
    return { code: literal === undefined ? "null" : literal, state: false, item: false };
  }
  const key = resolveStateKey(segs[0], ctx);
  if (!key)
    throw wdError(
      `${what} references unknown name "${segs[0]}" in ${ctx.file}. Use a loop item field, a declared :state, a number, or a "string".`,
      { code: "WD226", file: ctx.file }
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
  const parts = splitJoiners(raw);
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
    const opMatch = seg.match(CONDITION_RE);
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
  if (!usesState && !usesItem)
    return { static: true, value: evalPredicate(body, undefined, ctx, what) };
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
  // Aggregate calls — sum/avg/min/max over a list state, count of a list — are the
  // one allowed "function call". Each `name(listPath[, field])` is compiled to the
  // whitelisted `A("name", S(listKey…), "field")` helper and masked before the
  // generic function-call rejection below runs, so no arbitrary call survives.
  /** @type {string[]} */
  const aggs = [];
  expr = expr.replace(
    /\b(sum|avg|min|max|count)\s*\(\s*([A-Za-z_$][\w$.]*)\s*(?:,\s*([A-Za-z_$][\w$]*)\s*)?\)/g,
    (_whole, name, listPath, field) => {
      const segs = listPath.split(".");
      if (
        segs.some((/** @type {string} */ s) =>
          ["constructor", "prototype", "__proto__"].includes(s)
        )
      ) {
        throw wdError(`Path "${listPath}" is not allowed in :computed ${name}() (${ctx.file})`, {
          code: "WD227",
          file: ctx.file
        });
      }
      const key = resolveStateKey(segs[0], ctx);
      if (!key) {
        throw wdError(
          `:computed ${name}() references unknown state "${segs[0]}" in ${ctx.file}. Declare it with :state or :fetch first.`,
          { code: "WD228", file: ctx.file }
        );
      }
      const rest = segs.slice(1).join(".");
      const listCode = `S(${JSON.stringify(key)}${rest ? `,${JSON.stringify(rest)}` : ""})`;
      aggs.push(
        `A(${JSON.stringify(name)},${listCode}${field ? `,${JSON.stringify(field)}` : ""})`
      );
      return `__WDAGG${aggs.length - 1}__`;
    }
  );
  if (/["'\\`]/.test(expr)) {
    throw wdError(`Unsupported string syntax in :computed expression "${raw}" (${ctx.file})`, {
      code: "WD229",
      file: ctx.file
    });
  }
  if (!/^[\w$.\s+\-*/%()<>=!&|]*$/.test(expr)) {
    throw wdError(
      `Unsupported syntax in :computed expression "${raw}" (${ctx.file}). Allowed: state names, numbers, strings, + - * / % ( ), comparisons, && || !.`,
      { code: "WD230", file: ctx.file }
    );
  }
  if (/(^|[^=!<>])=(?!=)/.test(expr)) {
    throw wdError(`Assignment is not allowed in :computed expressions ("${raw}" in ${ctx.file})`, {
      code: "WD231",
      file: ctx.file
    });
  }
  // Reject function-call syntax: a `(` that directly follows an identifier, a
  // string literal, or a closing `)` (e.g. `x()`, `x.valueOf()`, `(a)(b)`). Only
  // grouping parens — where `(` follows an operator or starts the expression —
  // survive. Without this, `x.valueOf()` compiled to `S("x","valueOf")()`, a live
  // call; it is inert under the trusted-author/JSON-state model but contradicts the
  // SECURITY.md guarantee that function calls are compile errors. Runs BEFORE the
  // identifier→S() mapping so it never trips on the emitted helper calls.
  if (/[\w$)]\s*\(/.test(expr)) {
    throw wdError(
      `Function calls are not allowed in :computed expressions ("${raw}" in ${ctx.file})`,
      { code: "WD232", file: ctx.file }
    );
  }
  expr = expr.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, (ref) => {
    if (/^__WDSTR\d+__$/.test(ref) || /^__WDAGG\d+__$/.test(ref)) return ref;
    if (["true", "false", "null"].includes(ref)) return ref;
    const segs = ref.split(".");
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw wdError(`Path segment "${ref}" is not allowed in :computed expressions (${ctx.file})`, {
        code: "WD233",
        file: ctx.file
      });
    }
    const key = resolveStateKey(segs[0], ctx);
    if (!key) {
      throw wdError(
        `:computed references unknown state "${segs[0]}" in ${ctx.file}. Declare it with :state or :fetch first.`,
        { code: "WD234", file: ctx.file }
      );
    }
    const rest = segs.slice(1).join(".");
    return `S(${JSON.stringify(key)}${rest ? `,${JSON.stringify(rest)}` : ""})`;
  });
  return expr
    .replace(/__WDAGG(\d+)__/g, (_, index) => aggs[Number(index)])
    .replace(/__WDSTR(\d+)__/g, (_, index) => strings[Number(index)]);
}
