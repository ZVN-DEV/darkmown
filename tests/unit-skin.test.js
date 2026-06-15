import assert from "node:assert/strict";
import test from "node:test";
import { compileSkin } from "../src/skin.js";

// ---------------------------------------------------------------------------
// Skin compiler edge cases not already covered by tests/skin.test.js:
// $ref substitution shapes, every alias, @supports wrapping, page→body in
// nested selectors, and the empty-input case.
// ---------------------------------------------------------------------------

test("$ref tokens compile to var(--ref) including hyphenated/underscored names", () => {
  const css = compileSkin([
    "tokens",
    "  brand-ink #111",
    "  pad_lg 2rem",
    "page",
    "  color $brand-ink",
    "  padding $pad_lg"
  ].join("\n"));
  assert.match(css, /--brand-ink: #111;/);
  assert.match(css, /--pad_lg: 2rem;/);
  assert.match(css, /body \{ color: var\(--brand-ink\); \}/);
  assert.match(css, /body \{ padding: var\(--pad_lg\); \}/);
});

test("multiple $refs in a single value are all substituted", () => {
  const css = compileSkin([
    "tokens",
    "  a 1px",
    "  b red",
    ".x",
    "  border $a solid $b"
  ].join("\n"));
  assert.match(css, /\.x \{ border: var\(--a\) solid var\(--b\); \}/);
});

test("every alias maps to its CSS property (radius, shadow, font, bg)", () => {
  const css = compileSkin([
    ".card",
    "  radius 8px",
    "  shadow 0 1px 2px black",
    "  font Georgia, serif",
    "  bg white"
  ].join("\n"));
  assert.match(css, /\.card \{ border-radius: 8px; \}/);
  assert.match(css, /\.card \{ box-shadow: 0 1px 2px black; \}/);
  assert.match(css, /\.card \{ font-family: Georgia, serif; \}/);
  assert.match(css, /\.card \{ background: white; \}/);
});

test("font shorthand passes through when the value contains a slash", () => {
  const css = compileSkin([
    "body",
    "  font 16px/1.4 system-ui"
  ].join("\n"));
  assert.match(css, /body \{ font: 16px\/1\.4 system-ui; \}/);
  assert.doesNotMatch(css, /font-family/);
});

test("a non-aliased property passes through verbatim", () => {
  const css = compileSkin(["page", "  letter-spacing 0.02em"].join("\n"));
  assert.match(css, /body \{ letter-spacing: 0\.02em; \}/);
});

test("& nesting splices the parent into each grouped selector", () => {
  const css = compileSkin([
    ".btn",
    "  color black",
    "  &:hover, &:focus",
    "    color blue"
  ].join("\n"));
  assert.match(css, /\.btn \{ color: black; \}/);
  assert.match(css, /\.btn:hover, \.btn:focus \{ color: blue; \}/);
});

test("a nested selector without & is descendant-combined under the parent", () => {
  const css = compileSkin([
    ".menu",
    "  display flex",
    "  a",
    "    color red"
  ].join("\n"));
  assert.match(css, /\.menu a \{ color: red; \}/);
});

test("page → body at the top level and inside nesting", () => {
  const css = compileSkin([
    "page",
    "  margin 0",
    "  a",
    "    color red"
  ].join("\n"));
  assert.match(css, /body \{ margin: 0; \}/);
  assert.match(css, /body a \{ color: red; \}/);
});

test("@supports wraps its nested rules like @media does", () => {
  const css = compileSkin([
    "@supports (display: grid)",
    "  .grid",
    "    display grid"
  ].join("\n"));
  assert.match(css, /@supports \(display: grid\) \{ \.grid \{ display: grid; \} \}/);
});

test("declarations outside any selector attach to :root", () => {
  const css = compileSkin("color black");
  assert.match(css, /:root \{ color: black; \}/);
});

test("an all-comment / all-divider source compiles to empty output", () => {
  const css = compileSkin([
    "/* just a header",
    "   spanning lines */",
    "----------------",
    "* * *"
  ].join("\n"));
  assert.equal(css.trim(), "");
});

test("the :root token block is emitted before the first rule", () => {
  const css = compileSkin([
    "tokens",
    "  ink #111",
    "page",
    "  color $ink"
  ].join("\n"));
  const rootIndex = css.indexOf(":root {");
  const bodyIndex = css.indexOf("body {");
  assert.ok(rootIndex !== -1 && bodyIndex !== -1);
  assert.ok(rootIndex < bodyIndex, ":root vars should precede the body rule");
});
