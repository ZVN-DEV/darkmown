// The INITIAL PAINT of a per-row bound destination.
//
// `[{ p.name }](/p/{ p.slug }/)` inside a reactive `@loop` compiles to one
// `data-wd-each-attr` template shared by every row, so the build-time seed on
// the element is deliberately empty for the reader parts. The runtime fills it
// on hydrate — but the painted rows the compiler emits alongside the template
// are what a crawler, a no-JS reader, and the first frame all see, and they were
// shipping the literal skeleton: `href="/p//"`, one broken link per row.
//
// `fillEachAttr` resolves the template against the row, the row meta and
// declared state for those painted rows, mirroring the compile-time seed's
// encoding and scheme guard exactly. The `<template>` keeps its empty seed —
// it serves every row, so a value baked into it would be wrong for all but one.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory and return its `<main>` HTML. Scoped to
 * `<main>` so the page shell's own favicon href, skip link and runtime `<script
 * src>` cannot be mistaken for loop output. */
const page = (lines, extra = {}) =>
  compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n`, ...extra },
    "site/pages/index.wd",
    { cwd: "/proj" }
  ).html.match(/<main id="main">([\s\S]*?)<\/main>/)[1];

/** The `<template data-wd-loop-template>` markup of the first reactive loop. */
function template(html) {
  const start = html.indexOf("<template data-wd-loop-template>");
  return html.slice(start, html.indexOf("</template>", start));
}

/** Everything the runtime will replace: the painted rows only. */
const painted = (html) => html.slice(html.indexOf("data-wd-loop-out>"));

/** Every value of `attr` in `html`, in document order. */
const values = (html, attr) =>
  [...html.matchAll(new RegExp(` ${attr}="([^"]*)"`, "g"))].map((m) => m[1]);

const PRODUCTS = ':state ps = [{ "name": "A", "slug": "a" }, { "name": "B", "slug": "b" }]';

test("painted rows carry the row's real href, and the template keeps its empty seed", () => {
  const html = page([
    PRODUCTS,
    "",
    "@loop ps into p",
    "- [{ p.name }](/p/{ p.slug }/)",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["/p/a/", "/p/b/"]);
  // One template serves every row: baking row A's destination into it would be
  // wrong for row B, so the seed stays literal-only.
  assert.deepEqual(values(template(html), "href"), ["/p//"]);
  // And the template itself is untouched, so the runtime can still refill.
  assert.match(painted(html), /data-wd-each-attr="\[&quot;href&quot;/);
});

test("an unsafe row value paints an empty href", () => {
  // The scheme guard runs on the WHOLE assembled value, exactly as the
  // compile-time seed does — markdown-it's own validateLink vetted the
  // placeholder, not the value that replaced it.
  const html = page([
    ':state ps = [{ "n": "A", "u": "javascript:alert(1)" }, { "n": "B", "u": "/ok/" }]',
    "",
    "@loop ps into p",
    "- [{ p.n }]({ p.u })",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["", "/ok/"]);
});

test("a row-meta reader ($index) paints per row", () => {
  const html = page([
    ':state ps = [{ "n": "A" }, { "n": "B" }]',
    "",
    "@loop ps into p",
    "- [{ p.n }](/row/{ $index }/)",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["/row/0/", "/row/1/"]);
});

test("a destination mixing declared state with the row resolves both", () => {
  const html = page([
    ':state base = "shop"',
    ':state ps = [{ "s": "a" }, { "s": "b" }]',
    "",
    "@loop ps into p",
    "- [x](/{ base }/{ p.s }/)",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["/shop/a/", "/shop/b/"]);
});

test("an image src is filled the same way", () => {
  const html = page([
    ':state ps = [{ "f": "a.png" }, { "f": "b.png" }]',
    "",
    "@loop ps into p",
    "- ![alt](/img/{ p.f })",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "src"), ["/img/a.png", "/img/b.png"]);
});

test("the painted value is encoded exactly like the build-time seed", () => {
  // A destination has no quoting: an unencoded `)` closes it and hands the rest
  // back to the parser, and a space silently kills the link. `&` is HTML-escaped
  // on the way into the attribute, like every other attribute the compiler emits.
  const html = page([
    ':state ps = [{ "s": "a b(c)" }]',
    "",
    "@loop ps into p",
    "- [x](/p/{ p.s }/)",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["/p/a%20b%28c%29/"]);

  const amp = page([
    ':state ps = [{ "s": "a&b" }]',
    "",
    "@loop ps into p",
    "- [x](/p?q={ p.s })",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(amp), "href"), ["/p?q=a&amp;b"]);
});

test("a missing field paints the literal skeleton, not `undefined`", () => {
  const html = page([
    ':state ps = [{ "n": "A" }]',
    "",
    "@loop ps into p",
    "- [x](/p/{ p.slug }/)",
    "@endloop"
  ]);
  assert.deepEqual(values(painted(html), "href"), ["/p//"]);
});

test("a STATIC loop's destinations are unaffected", () => {
  // Negative control: a build-unrolled row resolves its destination through the
  // normal static path (no `data-wd-each-attr` at all), and must stay that way.
  const html = page([
    "---",
    "ps: [a, b]",
    "---",
    "@loop meta.ps into p",
    "- [x](/p/{ p }/)",
    "@endloop"
  ]);
  assert.ok(!html.includes("data-wd-each-attr"), "a static loop emitted a per-row template");
  assert.deepEqual(values(html, "href"), ["/p/a/", "/p/b/"]);
});
