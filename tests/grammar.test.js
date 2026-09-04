import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CATALOG_ACTION_TOKENS, directiveCatalog } from "../src/catalog.js";
import { generateGrammar } from "../src/grammar.js";

const grammar = generateGrammar();

// ---------------------------------------------------------------------------
// A real GBNF parser for the emitted grammar.
//
// The grammar exists to constrain a small model's decoding, so "is this shipped
// form representable?" is a PARSING question, and answering it with a substring
// check would be the same species of tautology the catalog guard used to be.
// This is a backtracking matcher over the GBNF subset the generator emits:
// string literals, `[...]` char classes, rule references, sequences,
// alternation, groups, and the `*` / `+` / `?` postfixes. It is left-recursion
// free by construction (the generator emits no left recursion).
// ---------------------------------------------------------------------------

/** Parse one rule's right-hand side into a node tree. */
function parseRhs(text) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const alt = () => {
    const options = [seq()];
    for (;;) {
      ws();
      if (text[i] !== "|") return options.length === 1 ? options[0] : { t: "alt", options };
      i++;
      options.push(seq());
    }
  };
  const seq = () => {
    const items = [];
    for (;;) {
      ws();
      if (i >= text.length || text[i] === "|" || text[i] === ")") break;
      items.push(postfix());
    }
    return items.length === 1 ? items[0] : { t: "seq", items };
  };
  const postfix = () => {
    let node = atom();
    for (;;) {
      const ch = text[i];
      if (ch === "*") {
        i++;
        node = { t: "rep", node, min: 0, max: Infinity };
      } else if (ch === "+") {
        i++;
        node = { t: "rep", node, min: 1, max: Infinity };
      } else if (ch === "?") {
        i++;
        node = { t: "rep", node, min: 0, max: 1 };
      } else return node;
    }
  };
  const atom = () => {
    ws();
    const ch = text[i];
    if (ch === '"') {
      i++;
      let value = "";
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          i++;
          value += text[i] === "n" ? "\n" : text[i];
        } else value += text[i];
        i++;
      }
      i++; // closing quote
      return { t: "lit", value };
    }
    if (ch === "[") {
      i++;
      const negate = text[i] === "^";
      if (negate) i++;
      /** @type {[string, string][]} */
      const ranges = [];
      while (i < text.length && text[i] !== "]") {
        let c = text[i++];
        if (c === "\\") {
          const esc = text[i++];
          c = esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
        }
        if (text[i] === "-" && text[i + 1] !== "]" && i + 1 < text.length) {
          i++;
          let hi = text[i++];
          if (hi === "\\") hi = text[i++];
          ranges.push([c, hi]);
        } else ranges.push([c, c]);
      }
      i++; // closing ]
      return { t: "cls", negate, ranges };
    }
    if (ch === "(") {
      i++;
      const inner = alt();
      ws();
      i++; // closing )
      return inner;
    }
    const m = /^[a-z][a-z0-9-]*/.exec(text.slice(i));
    if (!m) throw new Error(`unparsable GBNF at ${JSON.stringify(text.slice(i, i + 20))}`);
    i += m[0].length;
    return { t: "ref", name: m[0] };
  };
  const node = alt();
  return node;
}

/** All rules of the emitted grammar, parsed into node trees. */
function compileGrammar(text) {
  const rules = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-z][a-z0-9-]*)\s*::=\s*(.*)$/);
    if (m) rules.set(m[1], parseRhs(m[2]));
  }
  return rules;
}

const RULES = compileGrammar(grammar);

/** Every end offset reachable by matching `node` against `s` from `pos`. */
function* match(node, s, pos) {
  switch (node.t) {
    case "lit":
      if (s.startsWith(node.value, pos)) yield pos + node.value.length;
      return;
    case "cls": {
      if (pos >= s.length) return;
      const ch = s[pos];
      const inSet = node.ranges.some(([lo, hi]) => ch >= lo && ch <= hi);
      if (inSet !== node.negate) yield pos + 1;
      return;
    }
    case "ref": {
      const rule = RULES.get(node.name);
      assert.ok(rule, `grammar references undefined rule "${node.name}"`);
      yield* match(rule, s, pos);
      return;
    }
    case "alt":
      for (const option of node.options) yield* match(option, s, pos);
      return;
    case "seq": {
      function* step(k, at) {
        if (k === node.items.length) {
          yield at;
          return;
        }
        for (const next of match(node.items[k], s, at)) yield* step(k + 1, next);
      }
      yield* step(0, pos);
      return;
    }
    case "rep": {
      function* step(count, at) {
        if (count >= node.min) yield at;
        if (count >= node.max) return;
        for (const next of match(node.node, s, at)) {
          if (next === at) continue; // empty match — never loop forever
          yield* step(count + 1, next);
        }
      }
      yield* step(0, pos);
      return;
    }
    default:
      throw new Error(`unknown node ${node.t}`);
  }
}

/** Does the grammar's `root` rule accept the WHOLE line? */
function parses(line) {
  for (const end of match({ t: "ref", name: "root" }, line, 0))
    if (end === line.length) return true;
  return false;
}

/** Strip GBNF string literals and char classes so only rule references remain. */
function stripTerminals(text) {
  return text
    .replace(/"(?:\\.|[^"])*"/g, " ") // "…" string literals (incl. \" )
    .replace(/\[(?:\\.|[^\]])*\]/g, " "); // […] char classes (incl. \] )
}

function rules(text) {
  /** @type {Map<string, string>} */
  const defined = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-z][a-z0-9-]*)\s*::=\s*(.*)$/);
    if (m) defined.set(m[1], m[2]);
  }
  return defined;
}

// ---------------------------------------------------------------------------
// Well-formedness: balanced, every referenced rule defined, root reachable.
// ---------------------------------------------------------------------------

test("grammar has a root rule and every referenced rule is defined", () => {
  const defined = rules(grammar);
  assert.ok(defined.has("root"), "grammar has no root rule");
  const names = new Set(defined.keys());
  for (const [name, rhs] of defined) {
    for (const ref of stripTerminals(rhs).match(/[a-z][a-z0-9-]*/g) ?? []) {
      assert.ok(names.has(ref), `rule "${name}" references undefined rule "${ref}"`);
    }
  }
});

test("grammar parentheses and quotes are balanced", () => {
  const stripped = stripTerminals(grammar);
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    assert.ok(depth >= 0, "unbalanced ) in grammar");
  }
  assert.equal(depth, 0, "unbalanced ( in grammar");
  // Quotes: every string literal is fully matched by the strip regex, so no bare
  // double-quote can survive into the stripped text.
  assert.ok(!stripped.includes('"'), "an unterminated string literal remains");
});

test("every rule is reachable from root", () => {
  const defined = rules(grammar);
  const seen = new Set();
  const stack = ["root"];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const ref of stripTerminals(defined.get(name) ?? "").match(/[a-z][a-z0-9-]*/g) ?? []) {
      stack.push(ref);
    }
  }
  for (const name of defined.keys()) {
    assert.ok(seen.has(name), `rule "${name}" is unreachable from root (dead rule)`);
  }
});

// ---------------------------------------------------------------------------
// Coverage against the catalog: the constrained vocabulary is all present.
// ---------------------------------------------------------------------------

test("every catalog directive keyword is a literal in the grammar", () => {
  for (const d of directiveCatalog().directives) {
    assert.ok(grammar.includes(`"${d.name}"`), `grammar missing directive keyword ${d.name}`);
  }
});

test("every predicate operator and format pipe is a literal in the grammar", () => {
  const cat = directiveCatalog();
  for (const op of cat.predicateOps) {
    assert.ok(grammar.includes(`"${op.name}"`), `grammar missing operator ${op.name}`);
  }
  for (const p of cat.formatPipes) {
    assert.ok(grammar.includes(`"${p.name}"`), `grammar missing pipe ${p.name}`);
  }
});

test("every action-op token is a literal in the grammar", () => {
  for (const token of CATALOG_ACTION_TOKENS) {
    assert.ok(grammar.includes(`"${token}"`), `grammar missing action token ${token}`);
  }
});

// ---------------------------------------------------------------------------
// The committed grammar file is in sync with the generator.
// ---------------------------------------------------------------------------

test("grammar/wd-directives.gbnf is checked in and up to date", () => {
  const file = new URL("../grammar/wd-directives.gbnf", import.meta.url);
  assert.ok(fs.existsSync(file), "grammar/wd-directives.gbnf is not committed");
  assert.equal(fs.readFileSync(file, "utf8"), `${grammar}\n`, "run: node scripts/gen-grammar.mjs");
});

// ---------------------------------------------------------------------------
// The grammar must represent every SHIPPED form, not a narrower dialect.
//
// Each case below compiles in the real compiler but was unreachable under
// grammar-constrained decoding before this pass: `limit <stateKey>`, the
// reactive `sort by { key } { dir }`, the `not` predicate prefix, and every
// block closer (root was `directive | binding`, so a model could open an
// `@loop` and then be unable to emit `@endloop`).
// ---------------------------------------------------------------------------

const SHIPPED = [
  // Baseline forms the old grammar already accepted — if these regress, the
  // widening broke something.
  ["@loop /products.json into p", "loop over a JSON file"],
  ["@loop products into p where p.price < 50", "where clause"],
  ["@loop rows into r sort by r.price asc", "literal sort key + direction"],
  ["@loop rows into r reverse", "reverse"],
  ["@loop rows into r offset 2 limit 5", "literal offset + limit"],
  ["@loop rows into r paginate 10", "paginate"],
  ["@loop rows into r sortable", "sortable"],
  [':button "Add one" -> count++', "button action"],
  ["{ p.price | money }", "format pipe binding"],

  // K3: state-keyed offset / limit (loops.js accepts `\\d+|[A-Za-z_$][\\w$]*`).
  ["@loop rows into r limit pageSize", "limit <state key>"],
  ["@loop rows into r offset skip", "offset <state key>"],
  ["@loop rows into r offset skip limit pageSize", "both, state-keyed"],

  // K3: reactive sort (parseSortClause accepts `{ state }` for key AND dir).
  ["@loop rows into r sort by { sortKey }", "sort by { state }"],
  ["@loop rows into r sort by { sortKey } { sortDir }", "sort by { state } { state }"],
  ["@loop rows into r sort by r.price { sortDir }", "literal key, state direction"],

  // K3: `not` is a predicate joiner in the catalog and a condition prefix in
  // predicates.js; `joiner ::= "and" | "or"` could not express it at all.
  ['@loop rows into r where not r.tags contains "sale"', "leading not in where"],
  ["@loop rows into r where r.stock > 0 and not r.hidden == true", "not after a joiner"],
  [":if a == 1 and not b == 2", ":if with not"],

  // K3: block closers and mid-block markers.
  ["@endloop", "loop closer"],
  ["@empty", "loop empty marker"],
  [":endif", "if closer"],
  [":endform", "form closer"],
  [":endcarousel", "carousel closer"],
  [":::", "container closer"],
  [":else", "else"],
  [":else if x == 1", ":else if with a condition"],
  [":else if flag", ":else if with a bare path"],

  // K2: `refetch` reached the grammar only because the rule was hand-written;
  // it is now derived from the catalog, so this proves the derivation.
  [':button "Refresh" -> board refetch', "refetch action"],
  [':button "Save" -> settings merge patch; open toggle', "chained actions"]
];

test("the grammar parses every shipped directive form", () => {
  for (const [line, what] of SHIPPED) {
    assert.ok(parses(line), `grammar cannot represent ${what}: ${line}`);
  }
});

test("the grammar parser is not vacuous — it rejects non-Darkmown lines", () => {
  // Negative control. If any of these parse, `parses()` accepts everything and
  // the positive assertions above prove nothing.
  const REJECTED = [
    "cart.filter(x => x.price)", // the JS muscle-memory failure the grammar exists to delete
    "@loop rows into r sort by", // sort by with no key
    "@loop rows into r limit -1", // negative count
    "@loop rows into r limit", // limit with no count
    ":endloop", // not a real closer (@endloop is)
    ":else iff x == 1", // typo'd else-if
    "@loop rows into r where", // where with no condition
    "{ p.price | bogus }", // unknown format pipe
    ":state count = 0 extra" // trailing junk after a generic directive… see below
  ];
  const accepted = REJECTED.filter(parses);
  // `:state … restofline` is deliberately free-form, so that last line IS legal.
  assert.deepEqual(accepted, [":state count = 0 extra"], "grammar accepts a non-Darkmown line");
});

test("the parsed grammar covers every emitted rule (the matcher is not skipping rules)", () => {
  // If parseRhs silently dropped a rule, every `parses()` assertion would be
  // measuring a smaller grammar than the one that ships.
  const emitted = grammar
    .split("\n")
    .map((l) => l.match(/^([a-z][a-z0-9-]*)\s*::=/))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.deepEqual([...RULES.keys()].sort(), [...emitted].sort());
  assert.ok(RULES.size >= 30, `only ${RULES.size} rules parsed — the GBNF parser is broken`);
});
