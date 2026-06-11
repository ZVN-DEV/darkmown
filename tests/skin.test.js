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
