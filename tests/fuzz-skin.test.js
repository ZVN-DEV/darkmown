// Seeded, deterministic, zero-dependency property / fuzz tests for the SKIN
// compiler (`src/skin.js`).
//
// Strategy
// --------
// Sibling of `tests/fuzz.test.js`, same shape and same rules: a SEEDED mulberry32
// PRNG (never `Math.random`, so every failure reproduces), thousands of generated
// but structurally plausible `.skin` sources, and assertions on INVARIANTS rather
// than on exact output. On failure we print the seed and the reproducing source.
//
// `compileSkin` is a pure string → string function, which makes it an unusually
// good property-test target: the invariants below are total (they must hold for
// EVERY input), and the scoped/unscoped pair gives us an algebraic law to check
// one mode against the other instead of against a hand-written golden.
//
//   1. Totality. On plausible input `compileSkin` returns a STRING and never
//      throws; when it does reject (scoped page-level guard, misplaced `scoped`)
//      it throws a real `Error` with a non-empty message — never a non-Error,
//      never a hang.
//
//   2. Well-formedness. Output never carries the literal text `undefined`,
//      `null`, or `[object Object]`; its braces balance (ignoring braces inside
//      quoted strings, exactly as a CSS tokenizer would); and rule nesting never
//      exceeds the one level the compiler can emit (`@media { rule { … } }`).
//
//   3. Token substitution. Every `$ref` in a declaration value becomes
//      `var(--ref)`, and no bare `$` survives into the stylesheet.
//
//   4. Purity / stability. Compiling the same source twice is byte-identical,
//      and passing `{}` is identical to passing nothing.
//
//   5. SCOPING IS PURELY ADDITIVE — the headline law, and the reason this file
//      exists. CLAUDE.md makes "a non-`scoped` `.skin` must stay byte-identical"
//      a hard project invariant, currently pinned by ONE golden file
//      (`site/_/base.skin`). We generalize it to arbitrary generated input with
//      an equivalence:
//
//          compileSkin("scoped\n" + src, { scope: id })
//            .replaceAll(`[data-wd-scope="${id}"]`, "")   ===   compileSkin(src)
//
//      i.e. the ONLY difference scoping may ever make is inserting that exact
//      attribute. Anything else the scoped path touched — a reordered rule, a
//      dropped declaration, a mangled selector — breaks the equality. On top of
//      it we assert the two halves of the documented contract directly: every
//      comma-separated selector part of every rule carries the attribute on its
//      SUBJECT, while `tokens` / `:root` blocks stay GLOBAL and unscoped.
//
//   6. Deep nesting and adversarial whitespace (600-deep indentation, tabs mixed
//      with spaces, CRLF, long lines, unicode) never blow the stack and never
//      produce malformed output.
//
// A NOTE ON ERROR TEXT: we assert structural properties of thrown errors only
// (`instanceof Error`, non-empty message). Error strings are being changed in
// parallel by another track; asserting their wording would be a false failure.
//
// KNOWN BUG: one property below is quarantined behind an env flag because it
// currently FAILS against `src/skin.js`. See "KNOWN BUG" near the end of the
// file — `src/` is owned by another agent, so we document and report, never fix.

import assert from "node:assert/strict";
import test from "node:test";
import { compileSkin, scopeIdFor } from "../src/skin.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32, identical to tests/fuzz.test.js. Deterministic and
// reproducible; the base seed is fixed so CI is stable, and `WD_FUZZ_SEED`
// overrides it to reproduce a reported failure or widen exploration locally.
// (Copied rather than imported: each fuzz suite stays a self-contained artifact
// a maintainer can run and read on its own, matching the existing file.)
// ---------------------------------------------------------------------------

const BASE_SEED = Number(process.env.WD_FUZZ_SEED) || 0x1b873593;

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
// Generators. The alphabet is deliberately CSS-plausible and deliberately free
// of `{`, `}`, and the literal words `undefined` / `null`, so that the
// well-formedness invariants below stay meaningful: a brace in the OUTPUT can
// then only have been emitted by the compiler, never copied from the input.
// ---------------------------------------------------------------------------

const TAGS = ["h2", "h3", "a", "button", "span", "li", "img", "input", "code", "p"];
const CLASSES = [".card", ".title", ".btn", ".row", ".badge", ".panel", ".meta", ".is-open"];
const IDS = ["#hero", "#main-nav", "#footer_x"];
const ATTRS = ['[href]', '[data-open]', '[type="text"]', "[hidden]"];
const PSEUDOS = [":hover", ":focus", ":first-child", "::before", "::after", ":not([hidden])"];
const COMBINATORS = [" ", " > ", " + ", " ~ "];
const AT_RULES = [
  "@media (max-width: 640px)",
  "@media (min-width: 40rem)",
  "@media print",
  "@supports (display: grid)"
];
const PROPS = [
  "color",
  "background",
  "margin",
  "padding",
  "radius",
  "shadow",
  "bg",
  "font",
  "display",
  "border",
  "letter-spacing",
  "font-size",
  "gap",
  "opacity"
];
const VALUES = [
  "red",
  "#0f6b5e",
  "1rem",
  "0",
  "1rem 2rem 3rem",
  "1px solid #ccc",
  "flex",
  "grid",
  "0 1px 2px rgba(0, 0, 0, .2)",
  "ui-serif, Georgia, Cambria, serif",
  "16px/1.4 system-ui",
  ".85em",
  "block"
];
const REFS = ["ink", "accent", "paper", "radius-sm", "pad_lg", "line"];
const TOKEN_NAMES = ["ink", "accent", "paper", "radius-sm", "pad_lg", "line", "ring"];
const TOKEN_VALUES = ["#111", "#faf8f3", "12px", "2rem", "1px", "#e7e1d4"];
// Every modifier here is one the compiler is documented to handle: the bare
// form, `dark`, a well-formed bracketed attribute, and an unrecognized word
// (which falls back to the default `:root` scope).
const TOKEN_MODIFIERS = ["", " dark", " [data-theme=dark]", " [data-mode=compact]", " light"];
const DECORATIONS = ["", "   ", "// a note", "/* inline note */", "--------------------", "* * *"];
const INDENT_UNITS = ["  ", "    ", "\t"];

function compound(rng) {
  let s = rng.pick([...TAGS, ...CLASSES, ...IDS]);
  if (rng.bool(0.2)) s += rng.pick(ATTRS);
  if (rng.bool(0.3)) s += rng.pick(PSEUDOS);
  return s;
}

// A comma-separated selector list of 1-3 compound selectors, each optionally
// extended with descendant/child/sibling combinators.
function selector(rng) {
  const list = [];
  const parts = 1 + rng.int(3);
  for (let i = 0; i < parts; i++) {
    let s = compound(rng);
    const extra = rng.int(3);
    for (let d = 0; d < extra; d++) s += rng.pick(COMBINATORS) + compound(rng);
    list.push(s);
  }
  return list.join(", ");
}

// A nested selector: half the time an `&` splice (the shape that exercises
// normalizeSelector's `&` branch and, in scoped mode, the "resolve nesting
// FIRST, then scope the subject" ordering), half the time a plain descendant.
function nestedSelector(rng) {
  if (rng.bool(0.5)) {
    const list = [];
    const n = 1 + rng.int(2);
    for (let i = 0; i < n; i++) {
      list.push("&" + rng.pick([...PSEUDOS, ".is-open", "[data-open]"]));
    }
    return list.join(", ");
  }
  return selector(rng);
}

function declaration(rng, refs) {
  const prop = rng.pick(PROPS);
  if (rng.bool(0.3)) {
    const ref = rng.pick(REFS);
    refs.add(ref);
    return rng.bool(0.5) ? `${prop} $${ref}` : `${prop} 1px solid $${ref}`;
  }
  return `${prop} ${rng.pick(VALUES)}`;
}

function tokenDeclaration(rng) {
  return `${rng.pick(TOKEN_NAMES)} ${rng.pick(TOKEN_VALUES)}`;
}

/**
 * Generate a structurally plausible `.skin` source.
 *
 * `scopeSafe` restricts the corpus to constructs a SCOPED skin accepts: no
 * page-level selectors (`page`/`*`/`html`/`body`/`::selection`) and no bare
 * top-level declarations, both of which are a deliberate compile error in
 * scoped mode. `allowGlobal` permits whole-selector `:global(…)` escapes, which
 * are excluded from the strip-equivalence law (they are the one construct that
 * legitimately differs between the two modes).
 *
 * Returns the source plus the facts the invariants need, so no test has to
 * re-parse the generated input.
 */
function randSkin(rng, opts = {}) {
  const { scopeSafe = false, allowGlobal = false } = opts;
  const unit = rng.pick(INDENT_UNITS);
  const lines = [];
  const refs = new Set();
  let ruleCount = 0;
  let globalCount = 0;
  let pageLevelCount = 0;

  const blocks = 1 + rng.int(5);
  for (let b = 0; b < blocks; b++) {
    if (rng.bool(0.25)) lines.push(rng.pick(DECORATIONS));
    const kind = rng.int(12);

    if (kind < 2) {
      // A design-token block. Always global, in both modes.
      lines.push("tokens" + rng.pick(TOKEN_MODIFIERS));
      const n = 1 + rng.int(3);
      for (let i = 0; i < n; i++) lines.push(unit + tokenDeclaration(rng));
      continue;
    }

    if (kind < 4) {
      // An at-rule wrapper. Its children must be selectors: a declaration
      // directly under `@media` would fall to `:root` (a page-level write).
      lines.push(rng.pick(AT_RULES));
      const sels = 1 + rng.int(2);
      for (let s = 0; s < sels; s++) {
        lines.push(unit + selector(rng));
        const decls = 1 + rng.int(2);
        for (let d = 0; d < decls; d++) {
          lines.push(unit + unit + declaration(rng, refs));
          ruleCount++;
        }
      }
      continue;
    }

    if (allowGlobal && kind === 4) {
      lines.push(`:global(${rng.pick([...CLASSES, ...TAGS])})`);
      lines.push(unit + declaration(rng, refs));
      ruleCount++;
      globalCount++;
      continue;
    }

    if (!scopeSafe && kind === 5) {
      // Page-level constructs: legal in a global skin, a compile error in a
      // scoped one. Only ever generated for the unscoped corpus.
      if (rng.bool(0.5)) {
        lines.push(rng.pick(["page", "html", "body", "::selection"]));
        lines.push(unit + declaration(rng, refs));
        ruleCount++;
      } else {
        lines.push(declaration(rng, refs)); // bare declaration → :root
        ruleCount++;
      }
      pageLevelCount++;
      continue;
    }

    lines.push(selector(rng));
    const decls = 1 + rng.int(3);
    for (let d = 0; d < decls; d++) {
      lines.push(unit + declaration(rng, refs));
      ruleCount++;
    }
    if (rng.bool(0.4)) {
      lines.push(unit + nestedSelector(rng));
      const nested = 1 + rng.int(2);
      for (let d = 0; d < nested; d++) {
        lines.push(unit + unit + declaration(rng, refs));
        ruleCount++;
      }
    }
  }

  return { src: lines.join("\n"), refs, ruleCount, globalCount, pageLevelCount };
}

// ---------------------------------------------------------------------------
// Invariant helpers.
// ---------------------------------------------------------------------------

/**
 * Brace balance the way a CSS tokenizer sees it: braces inside a quoted string
 * are ordinary characters, so `[a="}"]` is balanced while `[{="v"]` is not.
 * Returns the final depth (0 = balanced) or `-1` for an underflow (a `}` with
 * no open block), which is the shape a selector-level injection would take.
 */
function braceDepth(css) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return -1;
  }
  return depth;
}

/**
 * Split compiled CSS into its two emitted shapes:
 *   - `blocks`: multi-line `SELECTOR {\n  --a: b;\n}` token blocks (including
 *     the nested `@media (prefers-color-scheme: dark) { :root:not(…) { … } }`)
 *   - `rules`:  one-line `SEL { prop: value; }`, optionally wrapped in an
 *     at-rule: `@media (…) { SEL { prop: value; } }`
 * Anything that matches neither shape is returned in `unknown`, which the tests
 * assert stays empty — a new emitted shape should fail loudly, not slip past.
 */
function parseCss(css) {
  const blocks = [];
  const rules = [];
  const unknown = [];
  const openStack = [];
  for (const line of css.split("\n")) {
    if (line === "") continue;
    if (openStack.length > 0) {
      if (line === "}") {
        const selector = openStack.pop();
        blocks.push({ selector, declarations: [] });
      } else if (!line.startsWith("  --") && !line.endsWith(" {")) {
        unknown.push(line);
      } else if (line.endsWith(" {")) {
        openStack.push(line.slice(0, -2));
      }
      continue;
    }
    if (line.endsWith(" {")) {
      openStack.push(line.slice(0, -2));
      continue;
    }
    if (line.endsWith(" }") && line.includes(" { ")) {
      rules.push({ line, selector: ruleSelector(line) });
      continue;
    }
    unknown.push(line);
  }
  return { blocks, rules, unknown, unclosed: openStack.length };
}

/** The selector of a one-line rule, unwrapping an `@media`/`@supports` prefix. */
function ruleSelector(line) {
  let rest = line;
  if (rest.startsWith("@")) {
    const open = rest.indexOf(" { ");
    rest = rest.slice(open + 3, rest.length - 2);
  }
  return rest.slice(0, rest.indexOf(" { "));
}

const SCOPE_ID = scopeIdFor("site/_/fuzz-component.skin");
const SCOPE_ATTR = `[data-wd-scope="${SCOPE_ID}"]`;

function assertWellFormed(css, repro) {
  assert.equal(typeof css, "string", repro("output was not a string"));
  assert.ok(!css.includes("undefined"), repro("output contained literal 'undefined'"));
  assert.ok(!css.includes("[object Object]"), repro("output contained '[object Object]'"));
  assert.ok(!css.includes("null"), repro("output contained literal 'null'"));
  assert.equal(braceDepth(css), 0, repro("emitted CSS braces do not balance"));
  const parsed = parseCss(css);
  assert.deepEqual(parsed.unknown, [], repro("emitted a line matching no known CSS shape"));
  assert.equal(parsed.unclosed, 0, repro("emitted an unclosed block"));
  // The compiler can only ever nest one level deep (`@media { rule { … } }`).
  assert.ok(!/\{[^}]*\{[^}]*\{/.test(css), repro("emitted CSS nested more than two levels"));
  return parsed;
}

function assertErrorish(err, repro) {
  assert.ok(err instanceof Error, repro(`threw a non-Error: ${String(err)}`));
  assert.ok(
    typeof err.message === "string" && err.message.length > 0,
    repro("thrown Error had an empty message")
  );
}

// ---------------------------------------------------------------------------
// Test 1: totality + well-formedness + $ref substitution + purity (unscoped).
// ---------------------------------------------------------------------------

test("fuzz: compileSkin is total, well-formed, and purely functional (unscoped)", () => {
  const CASES = 1500;
  let compiled = 0;
  let withRefs = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = (BASE_SEED + i) >>> 0;
    const rng = makeRng(seed);
    const { src, refs } = randSkin(rng);
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: unscoped) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\n` +
      `--- input .skin ---\n${src}\n--- end input ---\n`;

    // Totality: a plausible unscoped skin must never throw.
    let css;
    try {
      css = compileSkin(src);
    } catch (err) {
      assert.fail(repro(`unscoped compile threw: ${err && err.message}`));
    }

    assertWellFormed(css, repro);

    // $ref substitution: every `$name` in a declaration value becomes
    // `var(--name)`, and no bare `$` survives into the stylesheet.
    assert.ok(!css.includes("$"), repro("a raw `$` survived into the emitted CSS"));
    for (const ref of refs) {
      assert.ok(css.includes(`var(--${ref})`), repro(`$${ref} did not become var(--${ref})`));
    }
    if (refs.size > 0) withRefs++;

    // Purity: same input, same output — and `{}` is the same as no options.
    assert.equal(css, compileSkin(src), repro("compileSkin was not deterministic"));
    assert.equal(css, compileSkin(src, {}), repro("passing {} differed from passing nothing"));

    // An unscoped skin never emits the scope attribute (CLAUDE.md invariant).
    assert.ok(!css.includes("data-wd-scope"), repro("unscoped output carried a scope attribute"));
    compiled++;
  }

  assert.equal(compiled, CASES, "every plausible unscoped skin must compile");
  assert.ok(withRefs > 0, `expected some generated skins to use $refs (got ${withRefs})`);
});

// ---------------------------------------------------------------------------
// Test 2: SCOPING IS PURELY ADDITIVE — the headline law.
//
// This generalizes CLAUDE.md's "a non-`scoped` .skin must stay byte-identical"
// from one golden file to arbitrary generated input, and simultaneously pins
// the documented scoped contract (subject-scoped rules, global tokens).
// ---------------------------------------------------------------------------

test("fuzz: scoped compilation only ever ADDS the scope attribute (strip-equivalence)", () => {
  const CASES = 1500;
  let checked = 0;
  let scopedRules = 0;
  let tokenBlocks = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x55555555) + i) >>> 0;
    const rng = makeRng(seed);
    const { src, ruleCount } = randSkin(rng, { scopeSafe: true });
    const scopedSrc = `scoped\n${src}`;
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: scoping) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `scope: ${SCOPE_ID}\n` +
      `reason: ${msg}\n` +
      `--- input .skin (compiled with and without the leading "scoped") ---\n${src}\n--- end input ---\n`;

    const subjects = new Set();
    let scoped;
    try {
      scoped = compileSkin(scopedSrc, { scope: SCOPE_ID, subjects });
    } catch (err) {
      assert.fail(repro(`scope-safe source was rejected in scoped mode: ${err && err.message}`));
    }
    const plain = compileSkin(src);

    assertWellFormed(scoped, repro);

    // THE LAW: removing the attribute recovers the unscoped output byte for byte.
    assert.equal(
      scoped.replaceAll(SCOPE_ATTR, ""),
      plain,
      repro("scoped output was not the unscoped output plus the scope attribute")
    );

    // Anti-vacuity: a source with rules must actually differ between the modes.
    if (ruleCount > 0) {
      assert.notEqual(scoped, plain, repro("scoped mode emitted nothing extra for a source with rules"));
    }

    const parsed = parseCss(scoped);

    // Every comma part of every rule selector carries the attribute exactly
    // once, on its SUBJECT (the rightmost compound), and inside that compound it
    // sits before any trailing pseudo so the result stays valid CSS
    // (`.card[…]:hover`, never `.card:hover[…]`).
    for (const rule of parsed.rules) {
      for (const part of rule.selector.split(", ")) {
        const hits = part.split(SCOPE_ATTR).length - 1;
        assert.equal(hits, 1, repro(`selector part "${part}" carried ${hits} scope attributes`));
        const compounds = part.trim().split(/\s+/);
        const subject = compounds.at(-1);
        assert.ok(
          subject.includes(SCOPE_ATTR),
          repro(`scope attribute was not on the subject of "${part}"`)
        );
        const colon = subject.indexOf(":");
        assert.ok(
          colon === -1 || colon > subject.indexOf(SCOPE_ATTR),
          repro(`scope attribute landed after a pseudo in "${subject}" (invalid CSS)`)
        );
      }
      scopedRules++;
    }

    // Token blocks stay GLOBAL: `:root` never gets the attribute.
    for (const block of parsed.blocks) {
      assert.ok(
        !block.selector.includes("data-wd-scope"),
        repro(`token block selector "${block.selector}" was scoped — tokens must stay global`)
      );
      tokenBlocks++;
    }
    assert.ok(
      !/:root[^\n]*data-wd-scope/.test(scoped),
      repro(":root carried a scope attribute somewhere in the output")
    );

    // The `subjects` sink the builder uses for its unused-selector warning only
    // ever receives a single leading token (`.class`, `#id`, tag) or "".
    for (const subject of subjects) {
      assert.ok(
        /^([.#]?[A-Za-z_][\w-]*)?$/.test(subject),
        repro(`subjects sink received an unusable token: ${JSON.stringify(subject)}`)
      );
    }
    checked++;
  }

  assert.equal(checked, CASES, "every scope-safe skin must compile in both modes");
  assert.ok(scopedRules > 0, `expected scoped rules to be emitted (got ${scopedRules})`);
  assert.ok(tokenBlocks > 0, `expected some global token blocks (got ${tokenBlocks})`);
});

// ---------------------------------------------------------------------------
// Test 3: the scoped page-level guard, and the `:global()` escape hatch.
// ---------------------------------------------------------------------------

test("fuzz: page-level constructs are rejected in scoped mode and accepted globally", () => {
  const CASES = 400;
  let rejected = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x0f0f0f0f) + i) >>> 0;
    const rng = makeRng(seed);
    // Force at least one page-level construct into the source.
    let doc = randSkin(rng, { scopeSafe: false });
    for (let tries = 0; doc.pageLevelCount === 0 && tries < 12; tries++) {
      doc = randSkin(makeRng((seed + 0x9e3779b9 * (tries + 1)) >>> 0), { scopeSafe: false });
    }
    if (doc.pageLevelCount === 0) continue;

    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: page-level guard) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\n` +
      `--- input .skin ---\n${doc.src}\n--- end input ---\n`;

    // Globally: page-level styling is exactly what a global skin is for.
    const plain = compileSkin(doc.src);
    assertWellFormed(plain, repro);

    // Scoped: it must be a compile-time rejection, never a silently
    // never-matching rule. Structural assertion only, no message matching.
    // The call is the ONLY thing inside the try: an assertion is itself an
    // Error, so asserting inside a catch that accepts Errors would swallow the
    // failure and make this test unable to fail.
    let error = null;
    try {
      compileSkin(`scoped\n${doc.src}`, { scope: SCOPE_ID });
    } catch (err) {
      error = err;
    }
    assert.ok(error, repro("a page-level construct was accepted in scoped mode"));
    assertErrorish(error, repro);
    rejected++;
  }

  assert.ok(rejected > 0, `expected page-level constructs to be rejected (got ${rejected})`);
});

test("fuzz: a whole-selector :global() escapes scoping while its siblings stay scoped", () => {
  const CASES = 400;
  let escapes = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x12345678) + i) >>> 0;
    const rng = makeRng(seed);
    const doc = randSkin(rng, { scopeSafe: true, allowGlobal: true });
    if (doc.globalCount === 0) continue;

    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: :global escape) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\n` +
      `--- input .skin ---\n${doc.src}\n--- end input ---\n`;

    const css = compileSkin(`scoped\n${doc.src}`, { scope: SCOPE_ID });
    assertWellFormed(css, repro);

    // `:global(…)` never survives into the output as text, and the rules it
    // produced are unscoped — exactly `globalCount` of them.
    assert.ok(!css.includes(":global("), repro(":global() leaked into the emitted CSS"));
    const { rules } = parseCss(css);
    const unscoped = rules.filter((r) => !r.selector.includes(SCOPE_ATTR));
    assert.equal(
      unscoped.length,
      doc.globalCount,
      repro(`expected ${doc.globalCount} unscoped rule(s), got ${unscoped.length}`)
    );
    escapes += doc.globalCount;
  }

  assert.ok(escapes > 0, `expected some :global() escapes to be generated (got ${escapes})`);
});

// ---------------------------------------------------------------------------
// Test 4: `tokens [modifier]` normalization.
//
// The bracketed modifier is the ONE structured field a skin author can put
// arbitrary text into that reaches a selector, so it is the only real injection
// surface in this compiler (declaration values are copied verbatim by design —
// a skin author is trusted the same way a `.css` file's author is). We fuzz it
// with malformed and injection-shaped modifiers and assert the guard holds.
// ---------------------------------------------------------------------------

const MODIFIER_NAMES = ["data-theme", "data-mode", "a", "x-y", "{", "}", "a{b", "a}b", ""];
const MODIFIER_VALUES = ["dark", "light", "a b", "}", "{", '"', "x;y", ""];

function randModifier(rng) {
  if (rng.bool(0.2)) {
    return rng.pick([
      "[]",
      "[a]",
      "[=x]",
      "[data-theme=dark]{}body{x:1}]",
      "[a=b]extra",
      "[[a=b]]",
      "[a=b][c=d]"
    ]);
  }
  return `[${rng.pick(MODIFIER_NAMES)}=${rng.pick(MODIFIER_VALUES)}]`;
}

test("fuzz: a malformed tokens modifier never invents a new rule", () => {
  const CASES = 600;
  let fallbacks = 0;
  let attributes = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x2a2a2a2a) + i) >>> 0;
    const rng = makeRng(seed);
    const modifier = randModifier(rng);
    const name = rng.pick(TOKEN_NAMES);
    const value = rng.pick(TOKEN_VALUES);
    const src = [`tokens ${modifier}`, `  ${name} ${value}`].join("\n");
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: tokens modifier) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\n` +
      `modifier: ${JSON.stringify(modifier)}\n` +
      `--- input .skin ---\n${src}\n--- end input ---\n`;

    const css = compileSkin(src);
    assert.equal(typeof css, "string", repro("output was not a string"));

    // The declared token is always emitted, and it is the ONLY declaration.
    const lines = css.split("\n");
    const declarations = lines.filter((l) => l.startsWith("  --"));
    assert.deepEqual(
      declarations,
      [`  --${name}: ${value};`],
      repro("the token declaration was altered or duplicated")
    );

    // Exactly one block, and its selector is always rooted at `:root` — a
    // modifier can never invent a second rule or retarget the block at the page.
    const opens = lines.filter((l) => l.endsWith(" {"));
    assert.equal(opens.length, 1, repro(`expected exactly one block, got ${opens.length}`));
    assert.ok(
      opens[0].startsWith(":root"),
      repro(`token block was retargeted away from :root: ${opens[0]}`)
    );
    assert.ok(
      !/(^|\s)(body|html|\*)\s*\{/.test(css),
      repro("a modifier synthesized a page-level rule")
    );

    if (opens[0] === ":root {") fallbacks++;
    else attributes++;
  }

  // Both paths must be live: malformed modifiers fall back to `:root`, and
  // well-formed ones produce an attribute-scoped `:root[…]`.
  assert.ok(fallbacks > 0, `expected some modifiers to fall back to :root (got ${fallbacks})`);
  assert.ok(attributes > 0, `expected some attribute-scoped blocks (got ${attributes})`);
});

// ---------------------------------------------------------------------------
// KNOWN BUG — quarantined so the tree stays green; run it with
// `WD_FUZZ_KNOWN_BUGS=1 node --test tests/fuzz-skin.test.js` to see it fail.
//
// `normalizeAttr` (src/skin.js:309-312) QUOTES the attribute value but never
// VALIDATES the attribute name, so junk in the name position lands unquoted in
// a selector:
//
//     tokens [{=v]        →  :root[{="v"] {  --ink: #fff; }
//                                  ^ unquoted brace inside the selector
//
// The stylesheet's braces no longer balance, and a CSS parser consuming the
// never-closed block swallows EVERY rule that follows in the file. Its own
// docstring states the opposite contract ("Returns null for a malformed
// modifier … so the caller can fall back to default `:root` tokens instead of
// emitting a junk selector"), and `tests/skin.test.js` already asserts that
// contract for the shapes the regex happens to reject. This case slips through.
//
// Fix shape (NOT applied here — src/ is owned by another track): require the
// captured name to be a CSS identifier, e.g. `/^[A-Za-z_-][\w-]*$/`, and return
// null otherwise so the existing `:root` fallback engages.
// ---------------------------------------------------------------------------

const KNOWN_BUG_SKIP =
  process.env.WD_FUZZ_KNOWN_BUGS === "1"
    ? false
    : "KNOWN BUG (unfixed, src/ owned by another track): `tokens [{=v]` emits " +
      ":root[{=\"v\"] — an unquoted brace in the attribute NAME unbalances the " +
      "stylesheet. Run with WD_FUZZ_KNOWN_BUGS=1 to reproduce.";

test(
  "fuzz: a tokens modifier never emits an unquoted brace into a selector",
  { skip: KNOWN_BUG_SKIP },
  () => {
    const CASES = 600;
    for (let i = 0; i < CASES; i++) {
      const seed = ((BASE_SEED ^ 0x2a2a2a2a) + i) >>> 0;
      const rng = makeRng(seed);
      const modifier = randModifier(rng);
      const src = [`tokens ${modifier}`, "  ink #fff", ".card", "  color red"].join("\n");
      const css = compileSkin(src);
      assert.equal(
        braceDepth(css),
        0,
        `\n\n=== KNOWN BUG REPRODUCED (skin: tokens modifier) ===\n` +
          `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
          `modifier: ${JSON.stringify(modifier)}\n` +
          `emitted CSS has unbalanced braces (a CSS parser swallows the rest of the file):\n${css}\n`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Test 5: depth and adversarial whitespace.
//
// Only the total invariants are asserted here: mixed tabs/spaces deliberately
// produce structurally ambiguous nesting, so the *shape* of the output is not
// predictable — but it must still be a well-formed string, and the compiler
// must not blow the stack on deep input.
// ---------------------------------------------------------------------------

test("fuzz: deep nesting and adversarial whitespace never crash or corrupt output", () => {
  const CASES = 300;
  let compiled = 0;
  let rejected = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x7fffffff) + i) >>> 0;
    const rng = makeRng(seed);
    const lines = [];
    const depth = 1 + rng.int(60);
    // A deep indentation chain, with the indent unit varying per level so tabs
    // and spaces interleave (the compiler counts raw characters, not levels).
    for (let d = 0; d < depth; d++) {
      lines.push(rng.pick(INDENT_UNITS).repeat(d + 1) + compound(rng));
    }
    lines.push(rng.pick(INDENT_UNITS).repeat(depth + 1) + `color ${rng.pick(VALUES)}`);
    if (rng.bool(0.3)) lines.push("/* trailing\n   multi-line\n   comment */");
    if (rng.bool(0.3)) lines.push(rng.pick(DECORATIONS));
    if (rng.bool(0.2)) lines.push("é-ünïcode-clâss");
    const src = lines.join(rng.bool(0.15) ? "\r\n" : "\n");

    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (skin: depth/whitespace) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `depth: ${depth}\n` +
      `reason: ${msg}\n` +
      `--- input .skin ---\n${src}\n--- end input ---\n`;

    // The call is the ONLY thing inside the try: an assertion is itself an
    // Error, so asserting inside a catch that accepts Errors would swallow the
    // failure and make this test unable to fail.
    let css;
    let error = null;
    try {
      css = compileSkin(src);
    } catch (err) {
      error = err;
    }
    if (error) {
      assertErrorish(error, repro);
      rejected++;
      continue;
    }
    assert.equal(typeof css, "string", repro("output was not a string"));
    assert.ok(!css.includes("undefined"), repro("output contained literal 'undefined'"));
    assert.ok(!css.includes("[object Object]"), repro("output contained '[object Object]'"));
    assert.equal(braceDepth(css), 0, repro("emitted CSS braces do not balance"));
    assert.equal(css, compileSkin(src), repro("compileSkin was not deterministic"));
    compiled++;
  }

  assert.ok(compiled > 0, `expected deep/adversarial sources to compile (got ${compiled})`);
  assert.equal(rejected, 0, `no depth/whitespace input should be rejected (got ${rejected})`);
});

// A single very deep source: guards the iterative indentation stack against a
// stack-overflow regression if it were ever made recursive.
test("fuzz: a 600-level indentation chain compiles without blowing the stack", () => {
  const lines = [];
  for (let d = 0; d < 600; d++) lines.push("  ".repeat(d + 1) + `.l${d}`);
  lines.push("  ".repeat(601) + "color red");
  const css = compileSkin(lines.join("\n"));
  assert.equal(braceDepth(css), 0);
  assert.ok(css.endsWith("{ color: red; }"));
  assert.ok(css.includes(".l0 .l1 .l2"), "the whole descendant chain is preserved");
});

// ---------------------------------------------------------------------------
// Test 6: determinism guard — the same seed must regenerate the same corpus,
// otherwise a printed seed would not reproduce a reported failure.
// ---------------------------------------------------------------------------

test("fuzz: the skin generator is deterministic and reproducible for a given seed", () => {
  const a = makeRng(24680);
  const b = makeRng(24680);
  for (let i = 0; i < 500; i++) assert.equal(a.float(), b.float());

  assert.equal(randSkin(makeRng(1357)).src, randSkin(makeRng(1357)).src);
  assert.notEqual(randSkin(makeRng(1)).src, randSkin(makeRng(2)).src);
});
