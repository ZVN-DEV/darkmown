// Compile-time hint for paragraph-wrapped sibling HTML (2.8.0, F11).
//
// The rebuild bug: 16 carrier cards written as consecutive raw-HTML lines were
// wrapped into a single Markdown `<p>`, collapsing the grid to one column. The
// trap is real only for lines the parser does NOT hoist into an html_block —
// CommonMark hoists any line starting with a block-level tag (`<div>`,
// `<section>`, …), so sixteen consecutive `<div class="card">` lines render
// fine, while the same lines rooted at `<a>`, `<picture>`, or a custom element
// stay inline and collapse into one paragraph.
//
// The hint therefore keys on the OUTCOME: a markdown-it core rule inspects
// paragraph (inline) tokens — the parser has already decided what hoisted —
// and warns once per run of 2+ consecutive lines that each open with a
// component-looking tag (one carrying a class or id; classless `<a href>`
// lines are ordinary prose links, meant to share a paragraph). Container
// blocks, fenced code, and blank-line separation are no-warn by construction,
// not by special case. False positives are worse than misses, and every guard
// below pins one.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler/index.js";

/** Compile one body as a page with the given frontmatter; return its warnings. */
function compile(body, frontmatter = "html: true\n", ext = "wd") {
  const page = compileFromMemory(
    { [`site/pages/index.${ext}`]: `---\ntitle: T\n${frontmatter}---\n\n${body}\n` },
    `site/pages/index.${ext}`
  );
  return page.warnings;
}

/** Just the F11 hints a compile produced (other warnings filtered out). */
const siblingHints = (warnings) => warnings.filter((w) => /sibling HTML block lines/.test(w));

/** The rebuild repro: N consecutive card lines. */
const cards = (n, tag = "a") =>
  Array.from({ length: n }, (_, i) =>
    tag === "a"
      ? `<a class="card" href="/c${i}">Card ${i}</a>`
      : `<div class="card">Card ${i}</div>`
  ).join("\n");

test("the 16-card rebuild repro warns once, naming the count and the fix", () => {
  const hints = siblingHints(compile(cards(16)));
  assert.deepEqual(hints, [
    "/site/pages/index.wd:6: 16 sibling HTML block lines will render inline in one <p>; " +
      "wrap them in a container (e.g. a raw <div>)"
  ]);
});

test("the same 16 cards inside a raw container do not warn (the fix from the rebuild)", () => {
  assert.deepEqual(siblingHints(compile(`<div class="grid">\n${cards(16)}\n</div>`)), []);
});

test("consecutive <div> card lines do not warn — CommonMark hoists them into one html_block", () => {
  assert.deepEqual(siblingHints(compile(cards(16, "div"))), []);
});

test("cards separated by blank lines do not warn — each is its own one-line paragraph", () => {
  const solo = Array.from({ length: 4 }, (_, i) => `<a class="card" href="/c${i}">Card ${i}</a>`);
  assert.deepEqual(siblingHints(compile(solo.join("\n\n"))), []);
});

test("a single card line does not warn", () => {
  assert.deepEqual(siblingHints(compile(cards(1))), []);
});

test("a run of exactly two warns with N=2", () => {
  const hints = siblingHints(compile(cards(2)));
  assert.deepEqual(hints, [
    "/site/pages/index.wd:6: 2 sibling HTML block lines will render inline in one <p>; " +
      "wrap them in a container (e.g. a raw <div>)"
  ]);
});

test("two runs in one paragraph warn once each, on their own lines", () => {
  // <a>x</a> x2, a plain text line (breaks the run), then <a>x</a> x2 again.
  const hints = siblingHints(compile(`${cards(2)}\nsome text\n${cards(2)}`));
  assert.deepEqual(hints, [
    "/site/pages/index.wd:6: 2 sibling HTML block lines will render inline in one <p>; " +
      "wrap them in a container (e.g. a raw <div>)",
    "/site/pages/index.wd:9: 2 sibling HTML block lines will render inline in one <p>; " +
      "wrap them in a container (e.g. a raw <div>)"
  ]);
});

test("a run inside a fenced code block is documentation, not markup — no warn", () => {
  assert.deepEqual(siblingHints(compile(`\`\`\`html\n${cards(4)}\n\`\`\``)), []);
});

test("lines led by a { state } binding do not warn — a bound span is meant to be inline", () => {
  const hints = siblingHints(compile(":state x = 1\n:state y = 2\n\n{ x }\n{ y }"));
  assert.deepEqual(hints, []);
});

test("on a page without html: true the tags are escaped text — no warn", () => {
  assert.deepEqual(siblingHints(compile(cards(4), "")), []);
});

test("a plain .md page carries no warnings channel for the hint (hint is .wd-only)", () => {
  assert.deepEqual(siblingHints(compile(cards(4), "html: true\n", "md")), []);
});

test("classless tag lines do not warn — consecutive prose links are meant to share a paragraph", () => {
  const prose = ['<a href="/x">one</a>', '<a href="/y">two</a>', '<a href="/z">three</a>'].join(
    "\n"
  );
  assert.deepEqual(siblingHints(compile(prose)), []);
});

test("a run inside a ::: directive container still warns — directive containers are not raw HTML", () => {
  const hints = siblingHints(compile(`::: .grid\n${cards(3)}\n:::`));
  assert.equal(hints.length, 1);
  assert.match(hints[0], /: 3 sibling HTML block lines/);
});
