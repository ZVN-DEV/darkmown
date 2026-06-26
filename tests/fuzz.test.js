// Seeded, deterministic, zero-dependency fuzz / property tests.
//
// Strategy
// --------
// We do NOT assert exact compiler output. Instead we generate thousands of
// randomized `.wd` documents and `:computed` / `@loop where` expressions from a
// SEEDED PRNG (mulberry32 — reproducible, never Math.random) and assert
// INVARIANTS that must hold for *every* input:
//
//   1. Directive-body fuzz: compilePage / compileDocument either return a
//      well-formed HTML string OR throw a real Error whose message names the
//      file path. They must never: throw a non-Error, emit literal `undefined`
//      or `[object Object]`, return a non-string, or hang.
//
//   2. Expression-whitelist fuzz: every generated `:computed` / `where`
//      expression must either compile to a *safe* artifact (only S()/I()/C()
//      helper calls survive — no raw dangerous tokens) OR be rejected with an
//      actionable compile-time Error. Crucially, no expression containing a
//      dangerous token (backtick, `process`, `constructor`, `__proto__`,
//      assignment, etc.) may be silently accepted such that the raw token
//      reaches `new Function`.
//
// On any failure we print the seed and the minimal-ish reproducing input so the
// lead can triage. If the fuzzer finds a genuine compiler bug, this test fails
// loudly with a repro — we do NOT patch src/ (owned by another agent).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument, compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32. Deterministic & reproducible. The base seed is
// fixed so CI is stable; override via WD_FUZZ_SEED to reproduce a reported
// failure or to widen exploration locally.
// ---------------------------------------------------------------------------

const BASE_SEED = Number(process.env.WD_FUZZ_SEED) || 0x9e3779b9;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    float: next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p
  };
}

// ---------------------------------------------------------------------------
// Generators for directive-body fuzzing.
// ---------------------------------------------------------------------------

const UNICODE_BITS = ["é", "你", "🙂", "​", "\t", "  ", "—", "ß", "क", "\\", "<x>", "&amp;"];
const IDENTS = [
  "count",
  "items",
  "user",
  "cart",
  "x",
  "_y",
  "name",
  "total",
  "undeclared",
  "meta",
  "tag",
  "n"
];
// Interpolating an object-valued path as a bare leaf — e.g. `{ meta }` — now throws
// an actionable compile error (fixed in the interpolation resolver) instead of
// emitting the literal "[object Object]". Arrays render as a ", "-joined list. The
// fuzzer interpolates object-bound names freely: the invariant (string result OR a
// path-tagged Error, never "[object Object]") holds either way.
const SCALAR_LEAF_IDENTS = ["count", "x", "_y", "name", "total", "undeclared", "tag", "n"];
const OBJECT_IDENTS = ["items", "cart", "user", "meta"]; // generator may bind these to arrays/objects
const SCALAR_VALUES = ["0", "1", "42", "-3", "3.14", '"hi"', "true", "false", "null", "abc", ""];
const ARRAY_VALUES = ["[1, 2, 3]", "[]", '["a", "b"]'];

function randLine(rng) {
  const kind = rng.int(28);
  const id = rng.pick(IDENTS);
  const num = rng.int(8);
  switch (kind) {
    // Scalar names get scalar values; object/list names get arrays. This keeps the
    // strict "[object Object]" invariant honest for bare `{ scalar }` interpolation
    // (see SCALAR_LEAF_IDENTS note) while still exercising array-valued :state.
    case 0:
      return rng.bool(0.7)
        ? `:state ${rng.pick(SCALAR_LEAF_IDENTS)} = ${rng.pick(SCALAR_VALUES)}`
        : `:state ${rng.pick(OBJECT_IDENTS)} = ${rng.pick(ARRAY_VALUES)}`;
    case 1:
      return `:state ${maybeBroken(rng, id)}`; // possibly malformed
    case 2:
      return `@loop ${id} into ${rng.pick(IDENTS)}`;
    case 3:
      return `@endloop`;
    case 4:
      return `@loop ${id} into ${rng.pick(IDENTS)} where ${randWhere(rng)}`;
    case 5:
      return `- { ${rng.pick(IDENTS)} }`;
    case 6:
      return `{ ${rng.pick(OBJECT_IDENTS)}.${rng.pick(IDENTS)} }`;
    case 7:
      return `:if ${id}`;
    case 8:
      return `:else`;
    case 9:
      return `:endif`;
    case 10:
      return `:computed ${id} = ${randExpr(rng)}`;
    case 11:
      return `:button ${rng.pick(['"Go" -> ' + id + " += 1", '"X"', "", '"Y" -> badAction()'])}`;
    case 12:
      return `@include ${rng.pick(["/nav.wd", "../../etc/passwd", "/missing.wd", "/loop.wd", ""])}`;
    case 13:
      return `::: ${rng.pick(["card", "note", "", "  "])}`;
    case 14:
      return `:::`;
    case 15:
      return "```" + (rng.bool() ? "js" : "");
    case 16:
      return rng.pick(["# Heading", "- bullet", "> quote", "| a | b |", "plain prose", "**bold**"]);
    case 17:
      return `:fetch ${id} from ${rng.pick(['"/data.json"', "/data.json", ""])}`;
    case 18:
      return `:input ${id} ${rng.pick(["", "type=email", "required", "bogusflag", 'placeholder="x"'])}`;
    case 19:
      return `:bind ${rng.pick([id, ""])}`;
    case 20:
      return `:form ${rng.pick(["into " + id, 'action="/x"', "", "garbage"])}`;
    case 21:
      return `:submit ${rng.pick(['"Send"', ""])}`;
    case 22:
      return rng.pick(["@repeat x", ":for x", ":endfor"]); // removed/deprecated → should throw
    case 23:
      return rng.pick(UNICODE_BITS).repeat(1 + num);
    case 24:
      return `{ ${rng.pick(["meta.title", "x.constructor", "a.__proto__.b", "deep.nested.path"])} }`;
    case 25:
      return `:computed ${id} = ${randDangerExpr(rng)}`;
    case 26:
      return "---"; // stray frontmatter fence inside body
    case 27:
      return rng.pick(["", "   ", "\t\t"]);
    default:
      return "";
  }
}

function maybeBroken(rng, id) {
  return rng.pick([`${id}`, `${id} =`, `= ${id}`, `${id} == 5`, `${id}!@#`, ""]);
}

function randDoc(rng) {
  const n = 1 + rng.int(14);
  const lines = [];
  // Sometimes prefix frontmatter (well-formed or broken).
  if (rng.bool(0.3)) {
    if (rng.bool(0.7)) {
      lines.push(
        "---",
        `title: ${rng.pick(["Hi", '"Quoted"', "[a, b]", ""])}`,
        `html: ${rng.pick(["false", "true", "x"])}`,
        "---"
      );
    } else {
      lines.push("---", "title: never closed"); // unterminated frontmatter → should throw with path
    }
  }
  for (let i = 0; i < n; i++) lines.push(randLine(rng));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Generators for expression-whitelist fuzzing.
// ---------------------------------------------------------------------------

const SAFE_TOKENS = [
  "count",
  "items",
  "x",
  "1",
  "42",
  "3.14",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  "<",
  ">",
  "==",
  "!=",
  "&&",
  "||",
  "true",
  "false",
  "null"
];
const DANGER_TOKENS = [
  "`",
  "process",
  "constructor",
  "__proto__",
  "prototype",
  "=",
  "alert(1)",
  "this",
  "global",
  "require",
  "import",
  "x.constructor",
  "a=b",
  "${x}",
  "() => 1",
  "function",
  "[].map"
];

function randExpr(rng) {
  const n = 1 + rng.int(7);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(rng.pick(SAFE_TOKENS));
  return parts.join(rng.bool() ? " " : "");
}

function randDangerExpr(rng) {
  const n = 1 + rng.int(6);
  const parts = [];
  let hasDanger = false;
  for (let i = 0; i < n; i++) {
    if (rng.bool(0.5)) {
      parts.push(rng.pick(DANGER_TOKENS));
      hasDanger = true;
    } else parts.push(rng.pick(SAFE_TOKENS));
  }
  if (!hasDanger) parts.push(rng.pick(DANGER_TOKENS));
  return parts.join(" ");
}

function randWhere(rng) {
  const left = rng.pick(["item.name", "item.qty", "x", "item.constructor", "item.tags"]);
  const op = rng.pick(["==", "!=", ">", "<", ">=", "<=", "contains", "@@"]);
  const right = rng.pick(['"a"', "5", "count", "true", "`x`", "process", ""]);
  const join = rng.bool(0.7) ? "" : ` ${rng.pick(["and", "or"])} item.q > 1`;
  return `${left} ${op} ${right}${join}`;
}

// ---------------------------------------------------------------------------
// String-literal injection fuzzing.
//
// The A1 breakout used NONE of the screened danger tokens (no `process`,
// `constructor`, backtick, `=>`, or `${}`). It hid live code INSIDE a string
// literal by exploiting a naive re-wrap that stripped quotes and re-added them
// unescaped: a single-quoted `'"+(7*7)+"'` re-emitted as `""+(7*7)+""`, turning
// the arithmetic live. So we generate string literals whose INNER text is packed
// with breakout characters (quotes, backslashes, arithmetic, parens, identifier
// runs) and assert the compiled expression, when executed, has NO side effects
// and that every literal round-trips as an inert string.
// ---------------------------------------------------------------------------

// Inner-text fragments designed to break OUT of a re-wrapped string literal: a
// closing quote of the opposite kind, then live JS, then a re-opening quote.
const BREAKOUT_INNER = [
  '"+(7*7)+"', // double-quote breakout from a single-quoted literal
  "'+(7*7)+'", // single-quote breakout from a double-quoted literal
  '"+globalThis+"', // global reference
  "'+globalThis+'",
  '"+process+"', // node global
  '"];S=1;["', // bracket/semicolon statement injection
  '"+S("x")+"', // nested helper call
  '\\"+9+\\"', // backslash-escaped quote payload
  "a\\b", // bare backslash
  "(1+2)*3", // pure arithmetic, no quotes
  "x==y", // comparison-looking text
  "++--**//%%", // operator soup
  "()()()" // parens soup
];

// Inner-text fragments that contain a backslash. The source-level literal matcher
// (`'[^'\\]*'|"[^"\\]*"`) deliberately refuses to consume a `\`, so these survive
// into the validated expression and trip the `["'\\\`]` guard — i.e. they MUST be
// rejected at compile time. Including them keeps the reject path live (anti-vacuity).
const REJECTABLE_INNER = [
  "\\", // bare backslash
  "a\\b", // backslash mid-text
  '\\"+9+\\"', // backslash-escaped quote breakout attempt
  "end\\" // trailing backslash
];

// Build a `:computed` RHS that compares a declared scalar against a generated
// string literal whose inner text is a breakout fragment. We alternate the outer
// quote style so both single- and double-quoted re-wrap paths are exercised. Most
// of the time we emit a WELL-FORMED literal (escaping must neutralize it); ~25% of
// the time we emit a backslash-bearing literal that MUST be rejected.
function randInjectionExpr(rng) {
  const lhs = rng.pick(["x", "count"]);
  const op = rng.pick(["==", "!="]);

  if (rng.bool(0.25)) {
    // Rejectable: a backslash inside the literal that the matcher won't consume.
    const inner = rng.pick(REJECTABLE_INNER);
    const quote = rng.bool() ? "'" : '"';
    return `${lhs} ${op} ${quote}${inner}${quote}`;
  }

  // Well-formed: choose an outer quote that does NOT appear in `inner` (and never
  // a backslash) so the literal closes cleanly at the source level; the DANGER is
  // purely whether the inner text survives ESCAPED through the compiler.
  const inner = rng.pick(BREAKOUT_INNER).replace(/\\/g, "");
  const canSingle = !inner.includes("'");
  const canDouble = !inner.includes('"');
  let literal;
  if (canSingle && (rng.bool() || !canDouble)) literal = `'${inner}'`;
  else if (canDouble) literal = `"${inner}"`;
  else literal = `'${inner.replace(/['"]/g, "")}'`; // last-resort clean literal
  return `${lhs} ${op} ${literal}`;
}

// Execute a compiled `:computed` expr exactly as runtime.js does — `new Function`
// with `S` as the only injected name — but inside a hard sandbox: a Proxy that
// traps EVERY property access on the global and throws. `S` returns a fixed
// scalar. If any breakout reached live code (a global read, a call, arithmetic on
// a smuggled operand), the proxy trips or the literal fails to round-trip.
function runTrapped(expr) {
  const trap = new Proxy(
    {},
    {
      // `has` decides which free identifiers `with` captures. We let ONLY the
      // legitimate reader `S` (and the unscopables probe) fall through to the real
      // function parameter; every OTHER free identifier (a leaked `globalThis`,
      // `process`, `this`, etc.) is captured by the trap so its `get` throws.
      has(_t, prop) {
        if (prop === "S" || prop === Symbol.unscopables) return false;
        return true;
      },
      get(_t, prop) {
        // The `with` machinery reads `Symbol.unscopables` while resolving; that
        // probe is internal and must not count as a breakout.
        if (prop === Symbol.unscopables) return undefined;
        throw new Error(`sandbox breakout: accessed global property "${String(prop)}"`);
      }
    }
  );
  // Wrap the body in `with(__trap__)` so any free identifier other than `S`
  // resolves to the trap and throws instead of reaching the real global.
  const fn = new Function("S", "__trap__", `with (__trap__) { return (${expr}); }`);
  const read = () => "SENTINEL";
  return fn(read, trap);
}

// ---------------------------------------------------------------------------
// Invariant helpers.
// ---------------------------------------------------------------------------

const DANGEROUS_ARTIFACT =
  /\b(process|constructor|prototype|__proto__|require|global|globalThis)\b|`|=>|\$\{/;

// `requireNonEmpty` is true only for the full compilePage HTML shell (always
// wrapped in <!doctype html>…). compileDocument returns only the body, which is
// legitimately empty for a whitespace-only / comment-only page — so we don't
// require length there, only that it's a clean string.
function assertSafeHtml(html, repro, requireNonEmpty) {
  assert.equal(typeof html, "string", repro("output was not a string"));
  assert.ok(!html.includes("undefined"), repro("output contained literal 'undefined'"));
  assert.ok(!html.includes("[object Object]"), repro("output contained '[object Object]'"));
  if (requireNonEmpty) assert.ok(html.length > 0, repro("HTML shell output was empty"));
}

// Every compiler error must reference the offending file (CLAUDE.md invariant
// "Compile errors include file path + corrective suggestion"). The two `:button`
// action errors that previously omitted it are fixed in src/compiler.js, so this
// is now enforced with no exceptions.
function assertErrorNamesFile(err, file, repro) {
  assert.ok(err instanceof Error, repro(`threw a non-Error: ${String(err)}`));
  assert.ok(
    typeof err.message === "string" && err.message.length > 0,
    repro("Error had no message")
  );
  // Include-cycle / traversal errors use basenames. Accept either the full path or
  // the basename so the invariant stays meaningful without being brittle.
  const base = path.basename(file);
  assert.ok(
    err.message.includes(file) || err.message.includes(base),
    repro(`Error message did not reference the file path. Message: ${err.message}`)
  );
}

// ---------------------------------------------------------------------------
// Test 1: directive-body fuzz against the real public API.
// ---------------------------------------------------------------------------

test("fuzz: compilePage/compileDocument never crash and never emit undefined", () =>
  withExpectedCompilerWarnings(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-"));
    // A couple of include targets so @include sometimes resolves and sometimes cycles.
    fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
    fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "site/_/nav.wd"), "<nav>nav</nav>");
    fs.writeFileSync(path.join(root, "site/_/loop.wd"), "@include /loop.wd");
    const context = createPaths(root);
    const pageFile = path.join(root, "site/pages/index.wd");

    const CASES = 2500;
    let compiled = 0;
    let rejected = 0;

    for (let i = 0; i < CASES; i++) {
      const seed = (BASE_SEED + i) >>> 0;
      const rng = makeRng(seed);
      const body = randDoc(rng);
      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (directive-body) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\n` +
        `--- input .wd ---\n${body}\n--- end input ---\n`;

      fs.writeFileSync(pageFile, body);
      // Alternate between the two public entry points to cover both shells.
      const useShell = i % 2 === 0;
      try {
        const result = useShell
          ? compilePage(pageFile, context)
          : compileDocument(pageFile, context);
        assertSafeHtml(result.html, repro, useShell);
        compiled++;
      } catch (err) {
        assertErrorNamesFile(err, pageFile, repro);
        rejected++;
      }
    }

    // Sanity: the corpus is mixed, so we expect BOTH some compiles and some
    // rejections. If everything compiled or everything threw, the generator is
    // degenerate and the test would be vacuous.
    assert.ok(compiled > 0, `expected some inputs to compile (got ${compiled})`);
    assert.ok(rejected > 0, `expected some malformed inputs to be rejected (got ${rejected})`);
  }));

// ---------------------------------------------------------------------------
// Test 2: expression-whitelist fuzz — dangerous tokens never reach new Function.
// ---------------------------------------------------------------------------

test("fuzz: :computed / where reject dangerous expressions; safe ones emit only helper calls", () =>
  withExpectedCompilerWarnings(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-expr-"));
    fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
    const context = createPaths(root);
    const pageFile = path.join(root, "site/pages/index.wd");

    const CASES = 2500;
    let safeAccepted = 0;
    let dangerRejected = 0;
    // biome-ignore lint/correctness/noUnusedVariables: kept for symmetry with safe/rejected — documents the danger-but-neutralized outcome bucket.
    let dangerAccepted = 0; // neutralized & safe — allowed, but tracked

    for (let i = 0; i < CASES; i++) {
      const seed = ((BASE_SEED ^ 0x55555555) + i) >>> 0;
      const rng = makeRng(seed);

      const danger = rng.bool(0.6);
      const expr = danger ? randDangerExpr(rng) : randExpr(rng);
      // Declare referenced state so the only rejections are *grammar/safety*
      // rejections, not "unknown state" noise — though either is acceptable.
      const doc = [
        ":state count = 0",
        ":state items = [1, 2, 3]",
        ":state x = 1",
        `:computed result = ${expr}`
      ].join("\n");

      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (expression-whitelist) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\n` +
        `expr: ${expr}\n` +
        `--- input .wd ---\n${doc}\n--- end input ---\n`;

      fs.writeFileSync(pageFile, doc);

      try {
        const result = compileDocument(pageFile, context);
        // Accepted. Pull out the compiled computed expression artifact and ensure
        // NO raw dangerous token survived into what reaches new Function.
        const artifact = extractComputedExprs(result.html).join(" || ");
        assert.ok(
          !DANGEROUS_ARTIFACT.test(artifact),
          repro(
            `a dangerous token survived into the compiled artifact that feeds new Function:\n  artifact: ${artifact}`
          )
        );
        if (danger) dangerAccepted++;
        else safeAccepted++;
      } catch (err) {
        assert.ok(err instanceof Error, repro(`rejection was a non-Error: ${String(err)}`));
        assert.ok(err.message.length > 0, repro("rejection Error had empty message"));
        if (danger) dangerRejected++;
      }
    }

    // Most danger cases must be actively rejected (not merely neutralized), and at
    // least some safe expressions must compile. Both prove the whitelist is live.
    assert.ok(
      dangerRejected > 0,
      `expected dangerous expressions to be rejected (got ${dangerRejected})`
    );
    assert.ok(safeAccepted > 0, `expected some safe expressions to compile (got ${safeAccepted})`);
  }));

// ---------------------------------------------------------------------------
// Test 2b: string-literal injection fuzz — the A1 breakout class.
//
// Generates `:computed` expressions whose string literals carry breakout payloads
// (quotes + arithmetic + globals + statement separators) that use NONE of the
// screened danger tokens. For every ACCEPTED expression, the compiled artifact is
// executed in a trapped sandbox: it must either evaluate to a pure
// boolean/string/number with no global access, OR be rejected at compile time.
// Any side effect (a global read, a smuggled call, folded arithmetic from a broken
// literal) fails the test with a seed-tagged repro.
// ---------------------------------------------------------------------------

test("fuzz: :computed string literals cannot smuggle live code past escaping (A1 class)", () =>
  withExpectedCompilerWarnings(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-inj-"));
    fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
    const context = createPaths(root);
    const pageFile = path.join(root, "site/pages/index.wd");

    const CASES = 2500;
    let accepted = 0;
    let rejected = 0;

    for (let i = 0; i < CASES; i++) {
      const seed = ((BASE_SEED ^ 0x33333333) + i) >>> 0;
      const rng = makeRng(seed);
      const expr = randInjectionExpr(rng);
      const doc = [":state count = 0", ":state x = 1", `:computed result = ${expr}`].join("\n");

      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (string-literal injection) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\n` +
        `expr: ${expr}\n` +
        `--- input .wd ---\n${doc}\n--- end input ---\n`;

      fs.writeFileSync(pageFile, doc);

      let artifact;
      try {
        const result = compileDocument(pageFile, context);
        [artifact] = extractComputedExprs(result.html);
        assert.ok(
          typeof artifact === "string" && artifact.length > 0,
          repro("accepted but emitted no computed expr")
        );
      } catch (err) {
        // A compile-time rejection is a fully acceptable (safe) outcome.
        assert.ok(err instanceof Error, repro(`rejection was a non-Error: ${String(err)}`));
        assert.ok(err.message.length > 0, repro("rejection Error had empty message"));
        rejected++;
        continue;
      }

      // NOTE: we deliberately do NOT apply the `DANGEROUS_ARTIFACT` raw-token regex
      // here. The whole A1 class is that danger-LOOKING text (`globalThis`, `+`,
      // `(7*7)`) may legitimately appear INSIDE an escaped string literal and is
      // inert there — e.g. `S("count") == "'+globalThis+'"`. A purely textual screen
      // gives false positives. The authoritative invariant is behavioral: execute
      // the artifact in a hard sandbox and prove it has no side effects.

      // Execute the accepted artifact under a hard sandbox. It must complete with a
      // pure value and never touch a trapped global.
      let value;
      try {
        value = runTrapped(artifact);
      } catch (err) {
        assert.fail(
          repro(
            `compiled expr had a SIDE EFFECT when executed (sandbox tripped):\n  artifact: ${artifact}\n  error: ${err && err.message}`
          )
        );
      }
      const t = typeof value;
      assert.ok(
        t === "boolean" || t === "string" || t === "number",
        repro(
          `compiled expr produced a non-primitive (${t}) — a literal may have broken out:\n  artifact: ${artifact}\n  value: ${String(value)}`
        )
      );
      // The comparison is `SENTINEL <op> <literal>`. Since the literal is an inert
      // string, a `==`/`!=` against the "SENTINEL" sentinel must be a clean boolean.
      assert.equal(
        t,
        "boolean",
        repro(
          `expected a boolean comparison result; got ${t} (${String(value)}) — arithmetic/string concat may have leaked:\n  artifact: ${artifact}`
        )
      );
      accepted++;
    }

    // Anti-vacuity: the corpus must actually exercise BOTH paths. If everything was
    // rejected the sandbox never ran; if nothing was rejected the generator is too
    // tame. Require both, matching the existing fuzz guards.
    assert.ok(
      accepted > 0,
      `expected some injection-shaped exprs to compile and run safely (got ${accepted})`
    );
    assert.ok(
      rejected > 0,
      `expected some injection-shaped exprs to be rejected at compile time (got ${rejected})`
    );
  }));

// Pull the decoded `data-wd-computed-expr` artifacts out of compiled HTML.
function extractComputedExprs(html) {
  const out = [];
  const re = /data-wd-computed-expr="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(decodeHtml(m[1]));
  return out;
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------------------
// Test 3: determinism guard — same seed ⇒ identical generated corpus.
// ---------------------------------------------------------------------------

test("fuzz: PRNG is deterministic and reproducible for a given seed", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a.float(), b.float());

  const docA = randDoc(makeRng(777));
  const docB = randDoc(makeRng(777));
  assert.equal(docA, docB, "same seed must regenerate the identical document");

  const c = makeRng(1);
  const d = makeRng(2);
  // Different seeds should (essentially always) diverge.
  let diverged = false;
  for (let i = 0; i < 50; i++)
    if (c.float() !== d.float()) {
      diverged = true;
      break;
    }
  assert.ok(diverged, "distinct seeds must produce distinct streams");
});

function withExpectedCompilerWarnings(fn) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = String(args[0] ?? "");
    if (message.includes(":computed ") && message.includes("could not be evaluated at build time"))
      return;
    originalWarn(...args);
  };
  try {
    return fn();
  } finally {
    console.warn = originalWarn;
  }
}
