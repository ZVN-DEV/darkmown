import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CATALOG_ACTION_TOKENS, directiveCatalog } from "../src/catalog.js";
import { compileFromMemory } from "../src/compiler.js";

// ---------------------------------------------------------------------------
// The action vocabulary: catalog vs COMPILER, decided by compiling.
//
// `refetch` shipped in the compiler, was documented in the README seven times,
// and was absent from `directiveCatalog().actionOps` — therefore absent from
// `llms.txt`, `llms-full.txt`, the `grammar()` tool's "this list is closed"
// enum, and the `WD311` hint. The guard that was supposed to catch that
// compared the catalog against a HARDCODED literal array in this suite: a copy
// of the answer, so it could only ever agree with itself.
//
// This file derives the compiler's real vocabulary instead. Every probe below
// goes through `compileFromMemory` and the verdict is what the compiler did:
// a `data-wd-action` attribute means accepted, a WD311 throw means rejected.
// A new op in `parseSingleAction` that nobody adds to the catalog fails here.
// ---------------------------------------------------------------------------

/** State the probes act on: a number, a flag, a list, two objects, a fetch key. */
const PREAMBLE = [
  ":state count = 0",
  ":state open = false",
  ":state items = []",
  ":state settings = {}",
  ":state patch = {}",
  ':state form = ""',
  ':fetch board from "/board.json"',
  ""
].join("\n");

/**
 * Compile one `:button` action expression.
 * @returns {{ ok: true, op: string } | { ok: false, code: string, message: string }}
 */
function compileAction(expression) {
  const source = `${PREAMBLE}:button "Go" -> ${expression}\n`;
  try {
    const { html } = compileFromMemory({ "site/pages/index.wd": source }, "site/pages/index.wd");
    const single = html.match(/data-wd-action="([^"]+)"/);
    if (single) return { ok: true, op: single[1] };
    const chained = html.match(/data-wd-actions="([^"]+)"/);
    assert.ok(chained, `":button … -> ${expression}" emitted no action attribute at all`);
    return { ok: true, op: "chain" };
  } catch (err) {
    return { ok: false, code: err?.wd?.code ?? "THROW", message: String(err?.message ?? err) };
  }
}

// ---------------------------------------------------------------------------
// Forward: every op the catalog advertises really compiles.
// ---------------------------------------------------------------------------

test("every catalog action example compiles into a real action (no WD311)", () => {
  const ops = directiveCatalog().actionOps;
  assert.ok(ops.length >= 14, `only ${ops.length} action ops — refetch is missing again?`);
  for (const op of ops) {
    const result = compileAction(op.example);
    assert.ok(
      result.ok,
      `catalog action "${op.name}" example does not compile: ${op.example} — ${result.ok ? "" : result.message}`
    );
    assert.ok(result.op.length > 0, `${op.name} compiled to an empty op`);
  }
});

test("the catalog documents refetch, the op that drifted", () => {
  const refetch = directiveCatalog().actionOps.find((a) => a.name === "refetch");
  assert.ok(refetch, "`refetch` is implemented and documented but absent from the catalog");
  assert.equal(refetch.syntax, "name refetch");
  assert.equal(compileAction(refetch.example).op, "refetch");
  // It must reach the surfaces the catalog feeds, which is the whole point.
  assert.ok(CATALOG_ACTION_TOKENS.includes("refetch"));
});

// ---------------------------------------------------------------------------
// Reverse: the compiler's vocabulary, DERIVED by probing, must be the catalog's.
// ---------------------------------------------------------------------------

/**
 * Candidate keyword tokens. Mined from the parser's own source so a NEW op
 * keyword is automatically probed, then widened with words that must be
 * rejected. Mining only picks the candidates; the compiler decides the answer.
 */
function candidateWords() {
  const source = fs.readFileSync(new URL("../src/compiler/actions.js", import.meta.url), "utf8");
  const mined = new Set(source.match(/\b[a-z]{2,15}\b/g) ?? []);
  // Adversarial control: plausible ops that must NOT exist. If one of these is
  // accepted, either the compiler grew an op or the probe is broken — both are
  // findings, and both fail this test.
  for (const bogus of [
    "push",
    "pop",
    "splice",
    "concat",
    "assign",
    "unset",
    "refresh",
    "reload",
    "increment",
    "insert",
    "swap",
    "sort"
  ]) {
    mined.add(bogus);
  }
  return [...mined].sort();
}

/** The shapes a keyword op can take: bare, with a number, a string, a state key. */
const SHAPES = (token) => [
  `count ${token}`,
  `count ${token} 5`,
  `items ${token} "x"`,
  `settings ${token} patch`
];

test("the compiler's KEYWORD action vocabulary is exactly the catalog's", () => {
  const candidates = candidateWords();
  const catalogWords = CATALOG_ACTION_TOKENS.filter((t) => /^[a-z]+$/.test(t)).sort();

  // The miner must still be finding things — a regex that matched nothing would
  // make the sweep below vacuously agree with the catalog.
  assert.ok(candidates.length > 100, `only ${candidates.length} candidates mined`);
  for (const token of catalogWords) {
    assert.ok(candidates.includes(token), `the candidate miner no longer finds "${token}"`);
  }

  const accepted = [];
  for (const token of candidates) {
    if (SHAPES(token).some((shape) => compileAction(shape).ok)) accepted.push(token);
  }

  assert.deepEqual(
    accepted.sort(),
    catalogWords,
    "the compiler accepts a keyword action the catalog does not name (or vice versa)"
  );
});

test("the compiler's SYMBOLIC action vocabulary is exactly the catalog's", () => {
  // Symbol runs cannot be mined the way keywords can, so the candidate set is a
  // deliberately wide adversarial sweep of JS-shaped operators a model might try.
  const candidates = [
    "++",
    "--",
    "+=",
    "-=",
    "=",
    "==",
    "===",
    "!=",
    "*=",
    "/=",
    "%=",
    "**=",
    "??=",
    "||=",
    "&&=",
    "<<=",
    ">>=",
    "|=",
    "&=",
    "^=",
    "+",
    "-",
    "~",
    "!",
    "..",
    ".="
  ];
  const catalogSymbols = CATALOG_ACTION_TOKENS.filter((t) => !/^[a-z]+$/.test(t)).sort();

  const accepted = [];
  for (const token of candidates) {
    const hit = [`count${token}`, `count ${token} 5`, `count ${token} "x"`].some(
      (shape) => compileAction(shape).ok
    );
    if (hit) accepted.push(token);
  }

  assert.deepEqual(
    accepted.sort(),
    catalogSymbols,
    "the compiler accepts a symbolic action the catalog does not name (or vice versa)"
  );
});

test("an unknown action is WD311 — the probe's rejection signal is the real one", () => {
  // Negative control for the two sweeps above: they read "does not compile" as
  // "not in the vocabulary", which is only sound if an unknown op really is a
  // WD311 and not some unrelated failure.
  const rejected = compileAction("count frobnicate");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "WD311");
  assert.match(rejected.message, /Unsupported button action/);
  // And an accepted op is accepted for the right reason.
  assert.equal(compileAction("count++").op, "inc");
});

// ---------------------------------------------------------------------------
// The generated AI surfaces carry the whole vocabulary.
// ---------------------------------------------------------------------------

test("every catalog action op reaches llms.txt and llms-full.txt", async () => {
  const { llmsFullText, llmsText } = await import("../src/catalog.js");
  const index = llmsText();
  const corpus = llmsFullText();
  for (const op of directiveCatalog().actionOps) {
    assert.ok(index.includes(op.syntax), `llms.txt omits the "${op.name}" action (${op.syntax})`);
    assert.ok(
      corpus.includes(op.syntax),
      `llms-full.txt omits the "${op.name}" action (${op.syntax})`
    );
  }
  // The exact regression: `refetch` was in neither file.
  assert.match(index, /name refetch/);
  assert.match(corpus, /name refetch/);
});
