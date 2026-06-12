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
