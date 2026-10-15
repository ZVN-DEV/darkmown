// `@font-face` and `@keyframes` at-rule blocks in `.skin` (2.8.0, F1).
//
// Both are self-contained at-rule BLOCKS, not selector wrappers like
// `@media`/`@supports`: their indented children are font descriptors /
// keyframe selectors. They are always global (a `scoped` skin never stamps
// them, same contract as `tokens`), and their declaration values go through
// the shared pipeline (property aliases, `$token` refs).

import assert from "node:assert/strict";
import test from "node:test";
import { compileSkin, FONT_FACE_EXAMPLE, KEYFRAMES_EXAMPLE } from "../src/skin.js";

// --- @font-face -------------------------------------------------------------

test("@font-face compiles its indented declarations into a real at-rule", () => {
  const css = compileSkin(
    [
      "@font-face",
      '  font-family "Newsreader"',
      '  src url("/fonts/newsreader.ttf") format("truetype-variations")',
      "  font-weight 200 800",
      "  font-display swap"
    ].join("\n")
  );
  assert.equal(
    css,
    [
      "@font-face {",
      '  font-family: "Newsreader";',
      '  src: url("/fonts/newsreader.ttf") format("truetype-variations");',
      "  font-weight: 200 800;",
      "  font-display: swap;",
      "}"
    ].join("\n")
  );
});

test("multiple @font-face blocks are allowed in one skin", () => {
  const css = compileSkin(
    [
      "@font-face",
      '  font-family "Newsreader"',
      "  font-display swap",
      "@font-face",
      '  font-family "Commit Mono"',
      "  font-display block"
    ].join("\n")
  );
  assert.equal(css.match(/@font-face \{/g).length, 2);
  assert.match(css, /font-family: "Newsreader";/);
  assert.match(css, /font-family: "Commit Mono";/);
});

test("@font-face declarations use the shared pipeline (aliases, $token refs)", () => {
  const css = compileSkin(
    ["tokens", "  ink #111", "@font-face", "  font serif", "  size-adjust 105%"].join("\n")
  );
  // `font` without a leading size stays the font-family alias.
  assert.match(css, /font-family: serif;/);
  const withRef = compileSkin(["@keyframes pulse", "  to", "    color $ink"].join("\n"));
  assert.match(withRef, /color: var\(--ink\);/);
});

test("@font-face with a trailing name is a clear error", () => {
  assert.throws(
    () => compileSkin(["@font-face serif", '  font-family "Newsreader"'].join("\n")),
    /@font-face takes no name, got "serif"/
  );
});

test("@font-face with no declarations is a clear error", () => {
  assert.throws(() => compileSkin("@font-face"), /@font-face has no declarations/);
});

test("a nested block inside @font-face is a clear error", () => {
  assert.throws(
    () => compileSkin(["@font-face", "  .fallback", "    color red"].join("\n")),
    /@font-face only takes declarations — "\.fallback" opens a nested block/
  );
});

// --- @keyframes --------------------------------------------------------------

test("@keyframes compiles from/to/percentage selectors with nested declarations", () => {
  const css = compileSkin(
    [
      "@keyframes fade-in",
      "  from",
      "    opacity 0",
      "  50%, 75%",
      "    opacity .5",
      "  to",
      "    opacity 1"
    ].join("\n")
  );
  assert.equal(
    css,
    [
      "@keyframes fade-in {",
      "  from {",
      "    opacity: 0;",
      "  }",
      "  50%, 75% {",
      "    opacity: .5;",
      "  }",
      "  to {",
      "    opacity: 1;",
      "  }",
      "}"
    ].join("\n")
  );
});

test("keyframe selectors: decimal percentages, 100%, and to are all valid", () => {
  const css = compileSkin(
    [
      "@keyframes slide",
      "  0%",
      "    left 0",
      "  12.5%",
      "    left 10%",
      "  100%",
      "    left 90%"
    ].join("\n")
  );
  assert.match(css, /0% \{/);
  assert.match(css, /12\.5% \{/);
  assert.match(css, /100% \{/);
});

test("@keyframes declarations use the shared pipeline (aliases)", () => {
  const css = compileSkin(
    ["@keyframes pop", "  from", "    radius 0", "  to", "    radius 14px"].join("\n")
  );
  assert.match(css, /border-radius: 0;/);
  assert.match(css, /border-radius: 14px;/);
});

test("@keyframes with no name is a clear error", () => {
  assert.throws(() => compileSkin("@keyframes"), /@keyframes needs a name/);
});

test("@keyframes with an invalid name is a clear error", () => {
  assert.throws(
    () => compileSkin(["@keyframes 9lives", "  to", "    opacity 1"].join("\n")),
    /invalid @keyframes name "9lives"/
  );
  assert.throws(
    () => compileSkin(["@keyframes fade in", "  to", "    opacity 1"].join("\n")),
    /invalid @keyframes name "fade in"/
  );
});

test("a child of @keyframes that is not a keyframe selector is a clear error", () => {
  assert.throws(
    () => compileSkin(["@keyframes spin", "  middle", "    opacity 1"].join("\n")),
    /"middle" is not a keyframe selector in @keyframes spin/
  );
});

test("a keyframe selector with no declarations is a clear error", () => {
  assert.throws(
    () => compileSkin(["@keyframes spin", "  from", "  to", "    opacity 1"].join("\n")),
    /keyframe "from" in @keyframes spin has no declarations/
  );
});

test("declarations inside a keyframe cannot nest further", () => {
  assert.throws(
    () => compileSkin(["@keyframes spin", "  to", "    opacity 1", "      color red"].join("\n")),
    /@keyframes declarations cannot nest — "opacity 1" opens a block inside keyframe "to"/
  );
});

test("@keyframes with no keyframe selectors is a clear error", () => {
  assert.throws(
    () => compileSkin(["@keyframes spin", "  .card", "    color red"].join("\n")),
    // `.card` is not a keyframe selector, so this fails the selector check…
    /"\.card" is not a keyframe selector/
  );
  // …and a bare @keyframes with no indented children at all gets its own error.
  assert.throws(() => compileSkin("@keyframes spin"), /@keyframes spin has no keyframe selectors/);
});

// --- Always global, even in a scoped skin ------------------------------------

test("@font-face and @keyframes stay GLOBAL in a scoped skin (like tokens)", () => {
  const css = compileSkin(
    [
      "scoped",
      "@font-face",
      '  font-family "Newsreader"',
      "@keyframes fade-in",
      "  from",
      "    opacity 0",
      ".card",
      "  animation fade-in 300ms ease"
    ].join("\n"),
    { scope: "wd-7c21" }
  );
  assert.match(css, /@font-face \{\n {2}font-family: "Newsreader";\n\}/);
  assert.match(css, /@keyframes fade-in \{/);
  // The at-rules carry no scope attribute anywhere…
  const atRuleSection = css.slice(0, css.indexOf(".card"));
  assert.ok(!atRuleSection.includes("data-wd-scope"), atRuleSection);
  // …while ordinary selectors in the same skin are still scoped.
  assert.match(css, /\.card\[data-wd-scope="wd-7c21"\] \{ animation: fade-in 300ms ease; \}/);
});

test("a scoped skin carrying ONLY at-rules compiles (they are not page-level writes)", () => {
  const css = compileSkin(["scoped", "@keyframes fade-in", "  from", "    opacity 0"].join("\n"), {
    scope: "wd-7c21"
  });
  assert.match(css, /@keyframes fade-in \{/);
});

// --- Composition with what already existed -----------------------------------

test("@keyframes nests inside @media", () => {
  const css = compileSkin(
    [
      "@media (prefers-reduced-motion: no-preference)",
      "  @keyframes spin",
      "    to",
      "      transform rotate(360deg)"
    ].join("\n")
  );
  assert.equal(
    css,
    [
      "@media (prefers-reduced-motion: no-preference) {",
      "@keyframes spin {",
      "  to {",
      "    transform: rotate(360deg);",
      "  }",
      "}",
      "}"
    ].join("\n")
  );
});

test("at-rule blocks compose with ordinary rules and token blocks around them", () => {
  const css = compileSkin(
    [
      "tokens",
      "  accent #4f46e5",
      "@keyframes fade-in",
      "  to",
      "    opacity 1",
      ".card",
      "  animation fade-in 300ms ease"
    ].join("\n")
  );
  assert.match(css, /^:root \{\n {2}--accent: #4f46e5;\n\}\n/);
  assert.match(css, /@keyframes fade-in \{\n {2}to \{\n {4}opacity: 1;\n {2}\}\n\}/);
  assert.match(css, /\.card \{ animation: fade-in 300ms ease; \}$/);
});

// --- Coded errors (WD804-WD807) ----------------------------------------------
//
// Every at-rule rejection is a registered compile error routed through
// wdError: the message leads with `[WDxxx]`, and `err.wd` mirrors the code,
// the true source line, the corrective Use: hint, and a compilable example.

/** Compile `source` and return the Error it throws (asserts it throws). */
function skinErr(source, opts) {
  let err;
  try {
    compileSkin(source, opts);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `expected "${source}" to throw`);
  return err;
}

test("every at-rule error carries its WD code, true line, hint, and example", () => {
  const cases = [
    { src: '@font-face serif\n  font-family "Newsreader"', code: "WD804", line: 1 },
    { src: "@font-face\n  .fallback\n    color red", code: "WD804", line: 2 },
    { src: "@font-face", code: "WD804", line: 1 },
    { src: "@keyframes", code: "WD805", line: 1 },
    { src: "@keyframes 9lives\n  to\n    opacity 1", code: "WD805", line: 1 },
    { src: "@keyframes fade in\n  to\n    opacity 1", code: "WD805", line: 1 },
    { src: "@keyframes spin\n  middle\n    opacity 1", code: "WD806", line: 2 },
    { src: "@keyframes spin\n  to\n    opacity 1\n      color red", code: "WD807", line: 3 },
    { src: "@keyframes spin\n  from\n  to\n    opacity 1", code: "WD807", line: 2 },
    { src: "@keyframes spin", code: "WD807", line: 1 }
  ];
  for (const { src, code, line } of cases) {
    const err = skinErr(src);
    assert.equal(err.wd.code, code, `wrong code for:\n${src}\n${err.message}`);
    assert.ok(err.message.startsWith(`[${code}] `), `missing prefix: ${err.message}`);
    assert.equal(err.wd.line, line, `wrong line for:\n${src}\n${err.message}`);
    // No file was threaded, so the location falls back to `on line N`.
    assert.equal(err.wd.file, undefined);
    assert.match(err.message, new RegExp(` on line ${line}\\. Use: `), err.message);
    assert.ok(err.wd.hint.length > 0, "missing hint");
    assert.ok(err.wd.example.length > 0, "missing example");
    assert.ok(err.message.endsWith(`Use: ${err.wd.hint}`), `hint not in message: ${err.message}`);
  }
});

test("a threaded file turns the location into file:line", () => {
  const err = skinErr("@keyframes 9lives\n  to\n    opacity 1", {
    file: "/site/pages/index.skin"
  });
  assert.equal(err.wd.code, "WD805");
  assert.equal(err.wd.file, "/site/pages/index.skin");
  assert.equal(err.wd.line, 1);
  assert.match(
    err.message,
    /\[WD805\] invalid @keyframes name "9lives" in \/site\/pages\/index\.skin:1\. Use: /
  );
  assert.match(err.message, / — e\.g\. @keyframes fade-in$/);
});

test("the reported line is the true file line, past comments and blanks", () => {
  // The block comment spans file lines 1-2; the bad @keyframes opener is line 5.
  const src = [
    "/* brand",
    "   header */",
    "",
    "// note",
    "@keyframes 9lives",
    "  to",
    "    opacity 1"
  ].join("\n");
  const err = skinErr(src);
  assert.equal(err.wd.line, 5);
  assert.match(err.message, / on line 5\. Use: /);
});

test("the documented at-rule examples compile verbatim", () => {
  // The registry (src/errors.js) documents these constants, so they must
  // compile for as long as the at-rules do — same contract as the directive
  // `*_EXAMPLE` constants.
  assert.match(compileSkin(FONT_FACE_EXAMPLE), /@font-face \{\n {2}font-family: "Newsreader";\n\}/);
  assert.match(
    compileSkin(KEYFRAMES_EXAMPLE),
    /@keyframes fade-in \{\n {2}to \{\n {4}opacity: 1;\n {2}\}\n\}/
  );
});
