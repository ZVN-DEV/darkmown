// Directive-lookalike hints are suppressed inside raw <style>/<script> blocks
// (2.8.0, F2).
//
// The "looks like a directive but matches none" hint exists for typos in
// prose. A raw HTML <style> block (pages with `html: true`) is CSS, and a raw
// <script> block is JS — `@font-face {` / `@keyframes x {` / JSDoc `@param`
// lines there are not directives and used to warn once per line, per page.
// Inside either block the hint is now suppressed; everywhere else it is
// unchanged.
//
// These tests drive `compileBody` directly (the layer that owns the hint) with
// the `html: true` markdown instance, so they exercise exactly the raw-HTML
// prose path a real page takes.

import assert from "node:assert/strict";
import test from "node:test";
import { compileBody } from "../src/compiler/body.js";
import { createCompilation, createScope } from "../src/compiler/context.js";
import { selectMd } from "../src/compiler/markdown.js";

/** Compile one `html: true` body, returning its HTML and all warnings. */
function compile(body) {
  const comp = createCompilation(/** @type {any} */ ({}));
  const ctx = /** @type {any} */ ({
    file: "/proj/site/pages/index.wd",
    comp,
    scope: createScope(null),
    sections: [],
    stack: [],
    md: selectMd({ html: true })
  });
  const html = compileBody(body.split("\n"), ctx);
  return { html, warnings: comp.warnings };
}

/** The lookalike hints a compile produced (other warnings filtered out). */
const lookalikes = ({ warnings }) => warnings.filter((w) => /looks like a directive/.test(w));

test("@-lines and :-lines inside a raw <style> block do not warn", () => {
  const page = compile(
    [
      "<style>",
      "@font-face {",
      '  font-family: "Newsreader";',
      "}",
      "@keyframes pulse-spin {",
      "  to { transform: rotate(360deg); }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  .dot { animation: none; }",
      "}",
      ":root { --x: 1; }",
      "</style>"
    ].join("\n")
  );
  assert.deepEqual(lookalikes(page), []);
  // The CSS itself still renders through untouched.
  assert.ok(page.html.includes("@font-face {"), page.html);
  assert.ok(page.html.includes("@keyframes pulse-spin {"), page.html);
});

test("directive-looking lines inside a raw <script> block do not warn", () => {
  const page = compile(
    ["<script>", "@media nope {", ":stateish thing", "@param {object} opts", "</script>"].join("\n")
  );
  assert.deepEqual(lookalikes(page), []);
});

test("a <style>/<script> opener with attributes still starts the block", () => {
  const page = compile(['<style media="print">', "@font-face {", "}", "</style>"].join("\n"));
  assert.deepEqual(lookalikes(page), []);
});

test("the hint still fires before and after the block", () => {
  const page = compile(
    ["@typo before", "", "<style>", "@font-face {", "}", "</style>", "", "@typo after"].join("\n")
  );
  const hints = lookalikes(page);
  assert.equal(hints.length, 2, hints.join("\n"));
  assert.match(hints[0], /"@typo" looks like a directive/);
  assert.match(hints[1], /"@typo" looks like a directive/);
});

test("a same-line <script></script> pair suppresses nothing", () => {
  const page = compile(['<script src="/x.js"></script>', "", "@loopp items into x"].join("\n"));
  const hints = lookalikes(page);
  assert.equal(hints.length, 1, hints.join("\n"));
  assert.match(hints[0], /"@loopp" looks like a directive/);
});

test("other raw HTML contexts still warn — only <style>/<script> are suppressed", () => {
  const page = compile(["<div>", "@font-face {", "</div>"].join("\n"));
  const hints = lookalikes(page);
  assert.equal(hints.length, 1, hints.join("\n"));
  assert.match(hints[0], /"@font-face" looks like a directive/);
});

test("plain prose without any raw block is unaffected", () => {
  const page = compile(
    ["# Title", "", "Reach me at hello@example.com.", "", ":State count = 0"].join("\n")
  );
  const hints = lookalikes(page);
  assert.equal(hints.length, 1, hints.join("\n"));
  assert.match(hints[0], /":State" looks like a directive/);
});

test("the block state survives many lines and an unterminated block stays suppressed", () => {
  const page = compile(
    ["<style>", "@font-face {", "}", "@keyframes a {", "}", "@media x {", "}"].join("\n")
  );
  assert.deepEqual(lookalikes(page), []);
});
