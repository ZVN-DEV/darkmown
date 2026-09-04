// ---------------------------------------------------------------------------
// Compiled-expression → compact AST.
//
// The predicate/computed compilers in `predicates.js` still do ALL the security
// validation — they map every operand through a fixed grammar to safe JS over the
// `I()`/`S()`/`C()`/`A()` readers, and reject anything outside the whitelist. This
// module takes that ALREADY-VALIDATED JS fragment and re-parses it into a compact
// serialized AST (nested arrays), so the runtime can WALK it with a tiny closed
// evaluator instead of constructing a `new Function`. That is the whole point:
// reactive pages no longer need `script-src 'unsafe-eval'`.
//
// The parsed sub-language is closed and small: the reader calls `S(k[,r])`,
// `I(p)`, `C(a,b)`, `A(name,list[,field])`; number / JSON-string / boolean / null
// / object / array literals; the operators `! - * / % + - < > <= >= == != && ||`;
// and grouping parens. Precedence and associativity match JavaScript exactly, so
// the walked AST evaluates identically to the prior `new Function` path. Anything
// unexpected is a hard parse error — never a silent fallthrough.
//
// Node shapes (array with a tag at [0]):
//   ["L", value]            literal (number | string | boolean | null | obj | arr)
//   ["S", key]              state read           → getPath(state[key])
//   ["S", key, rest]        dotted state read    → getPath(state[key], rest)
//   ["I", path]             loop-item read       → getPath(item, path)
//   ["C", a, b]             contains(a, b)
//   ["A", name, list]       aggregate            → AGG(name, list)
//   ["A", name, list, fld]  aggregate w/ field   → AGG(name, list, fld)
//   ["!", a] | ["u-", a]    unary not / negate
//   [op, a, b]              binary op (op ∈ the operator set above)
// ---------------------------------------------------------------------------

import { FORMATTERS } from "./format.js";
import { getPath } from "./interpolation.js";

// Binary-operator precedence (higher binds tighter), matching JS.
/** @type {Record<string, number>} */
const PREC = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6
};

/**
 * Re-parse a validated compiled expression (JS fragment over I()/S()/C()/A())
 * into a compact AST. Throws on anything outside the closed grammar.
 * @param {string} code
 * @returns {any[]}
 */
export function astOf(code) {
  let i = 0;
  const n = code.length;
  const ws = () => {
    while (i < n && /\s/.test(code[i])) i++;
  };
  /** Peek a binary operator at the cursor without consuming; null if none. */
  const peekOp = () => {
    ws();
    const two = code.slice(i, i + 2);
    if (
      two === "&&" ||
      two === "||" ||
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">="
    )
      return two;
    const one = code[i];
    if (
      one === "<" ||
      one === ">" ||
      one === "+" ||
      one === "-" ||
      one === "*" ||
      one === "/" ||
      one === "%"
    )
      return one;
    return null;
  };
  /** @param {number} minPrec @returns {any[]} */
  const parseExpr = (minPrec) => {
    /** @type {any[]} */
    let left = parseUnary();
    for (;;) {
      const op = peekOp();
      if (op === null) break;
      const prec = PREC[op];
      if (prec < minPrec) break;
      i += op.length;
      const right = parseExpr(prec + 1);
      left = [op, left, right];
    }
    return left;
  };
  /** @returns {any[]} */
  const parseUnary = () => {
    ws();
    if (code[i] === "!" && code[i + 1] !== "=") {
      i++;
      return ["!", parseUnary()];
    }
    if (code[i] === "-") {
      i++;
      return ["u-", parseUnary()];
    }
    return parsePrimary();
  };
  /** @returns {any[]} */
  const parsePrimary = () => {
    ws();
    const c = code[i];
    if (c === "(") {
      i++;
      /** @type {any[]} */
      const e = parseExpr(1);
      ws();
      if (code[i] !== ")") throw new Error(`expr-ast: expected ) at ${i} in ${code}`);
      i++;
      return e;
    }
    if (c === '"') return ["L", readString()];
    if (c === "{" || c === "[") return ["L", readJson()];
    if (c === "." || (c >= "0" && c <= "9")) return ["L", readNumber()];
    if (/[A-Za-z_$]/.test(c)) return readIdent();
    throw new Error(`expr-ast: unexpected "${c ?? "<end>"}" at ${i} in ${code}`);
  };
  const readString = () => {
    let j = i + 1;
    while (j < n) {
      if (code[j] === "\\") j += 2;
      else if (code[j] === '"') break;
      else j++;
    }
    const lit = code.slice(i, j + 1);
    i = j + 1;
    return JSON.parse(lit);
  };
  const readJson = () => {
    let depth = 0;
    let j = i;
    for (; j < n; j++) {
      const ch = code[j];
      if (ch === '"') {
        j++;
        while (j < n && code[j] !== '"') j += code[j] === "\\" ? 2 : 1;
      } else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    const lit = code.slice(i, j);
    i = j;
    return JSON.parse(lit);
  };
  const readNumber = () => {
    let j = i;
    while (j < n && /[0-9.]/.test(code[j])) j++;
    // Exponent notation. The compilers fold a build-known operand with
    // `JSON.stringify`, and JS prints a number outside 1e-7…1e21 in exponent
    // form (`1e+21`, `1e-7`), so the fragment this module re-parses can carry
    // one even though no author ever typed it. The exponent is only consumed
    // when `e`/`E` is actually followed by digits (with an optional sign), so a
    // bare trailing `e` still falls through to the closed grammar's hard error.
    if (code[j] === "e" || code[j] === "E") {
      let k = j + 1;
      if (code[k] === "+" || code[k] === "-") k++;
      if (k < n && code[k] >= "0" && code[k] <= "9") {
        while (k < n && code[k] >= "0" && code[k] <= "9") k++;
        j = k;
      }
    }
    const num = Number(code.slice(i, j));
    i = j;
    return num;
  };
  /** @returns {any[]} */
  const readIdent = () => {
    let j = i;
    while (j < n && /[\w$]/.test(code[j])) j++;
    const word = code.slice(i, j);
    i = j;
    if (word === "true") return ["L", true];
    if (word === "false") return ["L", false];
    if (word === "null") return ["L", null];
    if (code[i] !== "(") throw new Error(`expr-ast: unexpected identifier "${word}" in ${code}`);
    const args = parseArgs();
    if (word === "S") return args.length > 1 ? ["S", args[0][1], args[1][1]] : ["S", args[0][1]];
    if (word === "I") return ["I", args[0][1]];
    if (word === "C") return ["C", args[0], args[1]];
    if (word === "A")
      return args.length > 2 ? ["A", args[0][1], args[1], args[2][1]] : ["A", args[0][1], args[1]];
    throw new Error(`expr-ast: unknown call "${word}" in ${code}`);
  };
  /** @returns {any[][]} */
  const parseArgs = () => {
    i++; // consume "("
    /** @type {any[][]} */
    const args = [];
    ws();
    if (code[i] !== ")") {
      args.push(parseExpr(1));
      ws();
      while (code[i] === ",") {
        i++;
        args.push(parseExpr(1));
        ws();
      }
    }
    ws();
    if (code[i] !== ")") throw new Error(`expr-ast: expected ) closing call in ${code}`);
    i++;
    return args;
  };

  const ast = parseExpr(1);
  ws();
  if (i !== n) throw new Error(`expr-ast: trailing input at ${i} in ${code}`);
  return ast;
}

/**
 * `JSON.stringify(astOf(code))` — the attribute payload the runtime reads.
 * @param {string} code
 * @returns {string}
 */
export const serializeExpr = (code) => JSON.stringify(astOf(code));

/** @param {unknown} a @param {unknown} b @returns {boolean} */
const contains = (a, b) =>
  String(a ?? "")
    .toLowerCase()
    .includes(String(b ?? "").toLowerCase());

/**
 * Build-time mirror of the runtime AST walker — same operators, so a `:computed`
 * or `where`/`when` predicate folds to the SAME value the runtime will recompute.
 * `state` reads come from the compilation's declared-state map. No eval.
 * @param {any[]} node
 * @param {unknown} item Loop row for I(); undefined otherwise.
 * @param {{ state: Map<string, unknown> }} comp
 * @returns {any}
 */
export function evalAst(node, item, comp) {
  /** @param {any[]} n @returns {any} */
  const ev = (n) => {
    const t = n[0];
    switch (t) {
      case "L":
        return n[1];
      case "S":
        return getPath(comp.state.get(n[1]), n[2] ? n[2].split(".") : []);
      case "I":
        return getPath(item, n[1] ? n[1].split(".") : []);
      case "C":
        return contains(ev(n[1]), ev(n[2]));
      case "A": {
        const f = FORMATTERS[n[1]];
        return f ? f(ev(n[2]), n[3] == null ? [] : [n[3]]) : undefined;
      }
      case "!":
        return !ev(n[1]);
      case "u-":
        return -ev(n[1]);
      case "&&":
        return ev(n[1]) && ev(n[2]);
      case "||":
        return ev(n[1]) || ev(n[2]);
      case "==":
        // biome-ignore lint/suspicious/noDoubleEquals: loose equality preserves prior `new Function` semantics exactly.
        return ev(n[1]) == ev(n[2]);
      case "!=":
        // biome-ignore lint/suspicious/noDoubleEquals: loose inequality preserves prior `new Function` semantics exactly.
        return ev(n[1]) != ev(n[2]);
      case "<":
        return ev(n[1]) < ev(n[2]);
      case ">":
        return ev(n[1]) > ev(n[2]);
      case "<=":
        return ev(n[1]) <= ev(n[2]);
      case ">=":
        return ev(n[1]) >= ev(n[2]);
      case "+":
        return ev(n[1]) + ev(n[2]);
      case "-":
        return ev(n[1]) - ev(n[2]);
      case "*":
        return ev(n[1]) * ev(n[2]);
      case "/":
        return ev(n[1]) / ev(n[2]);
      case "%":
        return ev(n[1]) % ev(n[2]);
    }
    throw new Error(`expr-ast: unknown op "${t}"`);
  };
  return ev(node);
}
