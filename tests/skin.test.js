import assert from "node:assert/strict";
import test from "node:test";
import { compileSkin } from "../src/skin.js";

test("compiles tokens and selector rules after the token block", () => {
  const css = compileSkin([
    "tokens",
    "  ink #111",
    "page",
    "  color $ink",
    ".topnav strong",
    "  color red",
    ".card",
    "  radius 8px",
    "button:hover",
    "  bg red"
  ].join("\n"));

  assert.match(css, /--ink: #111;/);
  assert.match(css, /body \{ color: var\(--ink\); \}/);
  assert.match(css, /\.topnav strong \{ color: red; \}/);
  assert.match(css, /\.card \{ border-radius: 8px; \}/);
  assert.match(css, /button:hover \{ background: red; \}/);
  assert.doesNotMatch(css, /--color:/);
});

test("multi-word and grouped selectors compile structurally (indent decides)", () => {
  const css = compileSkin([
    "pre",
    "  bg #111",
    "",
    "pre code",
    "  bg transparent",
    "  border 0",
    "",
    "h1 code, h2 code",
    "  font-size .85em",
    "",
    ".topnav a",
    "  color red",
    "  &:hover",
    "    text-decoration underline"
  ].join("\n"));
  assert.match(css, /pre \{ background: #111; \}/);
  assert.match(css, /pre code \{ background: transparent; \}/);
  assert.match(css, /h1 code, h2 code \{ font-size: \.85em; \}/);
  assert.match(css, /\.topnav a \{ color: red; \}/);
  assert.match(css, /\.topnav a:hover \{ text-decoration: underline; \}/);
});

test("declarations with commas and multiple values are never mistaken for selectors", () => {
  const css = compileSkin([
    "page",
    "  font ui-serif, Georgia, Cambria, serif",
    "  padding 1rem 2rem 3rem"
  ].join("\n"));
  assert.match(css, /body \{ font-family: ui-serif, Georgia, Cambria, serif; \}/);
  assert.match(css, /body \{ padding: 1rem 2rem 3rem; \}/);
});

test("@media blocks wrap their nested rules instead of becoming selectors", () => {
  const css = compileSkin([
    ".grid",
    "  display grid",
    "@media (max-width: 640px)",
    "  .grid",
    "    grid-template-columns 1fr",
    "  h1",
    "    font-size 2rem"
  ].join("\n"));
  assert.match(css, /\.grid \{ display: grid; \}/);
  assert.match(css, /@media \(max-width: 640px\) \{ \.grid \{ grid-template-columns: 1fr; \} \}/);
  assert.match(css, /@media \(max-width: 640px\) \{ h1 \{ font-size: 2rem; \} \}/);
});

test("font passes through as the CSS shorthand when it leads with a size", () => {
  const css = compileSkin([
    "body",
    "  font 16px/1.6 system-ui",
    "  font ui-sans-serif, system-ui"
  ].join("\n"));
  assert.match(css, /body \{ font: 16px\/1\.6 system-ui; \}/);
  assert.match(css, /body \{ font-family: ui-sans-serif, system-ui; \}/);
});

test("tokens dark compiles to a prefers-color-scheme override of :root", () => {
  const css = compileSkin([
    "tokens",
    "  ink #1a1a1a",
    "  paper #ffffff",
    "tokens dark",
    "  ink #f0f0f0",
    "  paper #14140f",
    "page",
    "  color $ink",
    "  bg $paper"
  ].join("\n"));

  // Light defaults stay on :root, unchanged.
  assert.match(css, /:root \{\n {2}--ink: #1a1a1a;\n {2}--paper: #ffffff;\n\}/);
  // Dark variant wraps :root in a prefers-color-scheme media query.
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\) \{\n:root \{\n {2}--ink: #f0f0f0;\n {2}--paper: #14140f;\n\}\n\}/
  );
  // $var references resolve the same way for both themes.
  assert.match(css, /body \{ color: var\(--ink\); \}/);
  assert.match(css, /body \{ background: var\(--paper\); \}/);
});

test("plain tokens block is byte-identical with or without a dark variant present", () => {
  const withoutDark = compileSkin([
    "tokens",
    "  ink #111",
    "page",
    "  color $ink"
  ].join("\n"));
  // The plain block must compile exactly as before the dark feature existed.
  assert.equal(withoutDark, ":root {\n  --ink: #111;\n}\nbody { color: var(--ink); }");
  assert.doesNotMatch(withoutDark, /prefers-color-scheme/);
});

test("tokens [data-theme=dark] compiles to a manual-toggle :root attribute scope", () => {
  const css = compileSkin([
    "tokens",
    "  ink #1a1a1a",
    "tokens [data-theme=dark]",
    "  ink #f0f0f0",
    "page",
    "  color $ink"
  ].join("\n"));

  assert.match(css, /:root \{\n {2}--ink: #1a1a1a;\n\}/);
  // Bracketed value is quoted into a valid attribute selector on :root.
  assert.match(css, /:root\[data-theme="dark"\] \{\n {2}--ink: #f0f0f0;\n\}/);
  assert.match(css, /body \{ color: var\(--ink\); \}/);
});

test("a malformed tokens modifier never breaks out of the attribute selector", () => {
  // Empty and breakout-shaped modifiers fall back to plain :root tokens — no
  // stray rule leaks (the `}body{…}` injection attempt is neutralized).
  for (const bad of ["tokens []", "tokens [data-theme=dark]{}body{x:1}]"]) {
    const css = compileSkin([bad, "  ink #fff"].join("\n"));
    assert.match(css, /^:root \{\n {2}--ink: #fff;\n\}$/, `bad modifier "${bad}" should fall back to :root`);
    assert.doesNotMatch(css, /body\s*\{/);
  }
  // A bracketed value containing a space is still safe: it normalizes to a
  // *quoted* attribute selector, never a junk rule or a breakout.
  const spaced = compileSkin(["tokens [data-theme=dark extra]", "  ink #fff"].join("\n"));
  assert.match(spaced, /:root\[data-theme="dark extra"\] \{/);
  assert.doesNotMatch(spaced, /body\s*\{/);
});

test("block comments and decorative divider lines are skipped, not parsed as rules", () => {
  const css = compileSkin([
    "/* Brand skin",
    "   multi-line header */",
    "tokens",
    "  ink #111  /* near-black */",
    "",
    "------------------------------",
    "page",
    "  color $ink",
    "  /* spacing tweaks below */",
    "  padding 2rem",
    "* * *",
    ".card",
    "  radius 8px"
  ].join("\n"));
  assert.match(css, /--ink: #111;/);
  assert.match(css, /body \{ color: var\(--ink\); \}/);
  assert.match(css, /body \{ padding: 2rem; \}/);
  assert.match(css, /\.card \{ border-radius: 8px; \}/);
  // dividers and comments never leak into output
  assert.doesNotMatch(css, /----/);
  assert.doesNotMatch(css, /\*\s\*/);
  assert.doesNotMatch(css, /comment|Brand skin|spacing tweaks/);
});
