// Speculation Rules: the latency half of smooth navigation, and what kills the
// white flash. `transitions: true` emits the view-transition CSS (the visual
// swap) plus a declarative <script type="speculationrules"> that PRERENDERS
// same-origin links on hover/pointerdown (eagerness: moderate). The browser
// interprets this JSON — it is NOT framework runtime JS, so the zero-JS
// invariant holds. Prefetch only warms the cache (the page still renders on
// click — that render gap is the white flash); prerender renders the page ahead
// of the click, so activation is instant. Unsupported browsers ignore the tag.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(frontmatter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-speculation-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [...frontmatter, "", "# Hi"].join("\n"));
  return compilePage(file, createPaths(root)).html;
}

// Pull the JSON body out of the speculationrules script for structural asserts.
function rules(html) {
  const m = html.match(/<script type="speculationrules">\s*([\s\S]*?)\s*<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

test("transitions: true emits a valid speculationrules prerender script", () => {
  const html = compile(["---", "transitions: true", "---"]);
  const json = rules(html);
  assert.ok(json, "a <script type=speculationrules> must be present");
  // prerender (not just prefetch): the page is rendered ahead of the click so
  // there is no render gap — the white flash — on activation.
  assert.ok(Array.isArray(json.prerender), "must prerender, not merely prefetch");
  const rule = json.prerender[0];
  assert.equal(rule.eagerness, "moderate", "moderate = hover/pointerdown, capped");
  assert.equal(rule.where.and[0].href_matches, "/*", "same-origin document links only");
});

test("the prefetch rule excludes opt-out links", () => {
  const html = compile(["---", "transitions: true", "---"]);
  const json = rules(html);
  const serialized = JSON.stringify(json);
  assert.match(serialized, /no-prefetch/, "a .no-prefetch class opts a link out");
  assert.match(serialized, /nofollow/, "rel=nofollow links are never speculated");
});

test("the speculationrules script does not flip the page reactive (zero-JS)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-speculation-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "---\ntransitions: true\n---\n\n# Hi");
  const page = compilePage(file, createPaths(root));
  assert.match(page.html, /<script type="speculationrules">/);
  assert.equal(page.assets.runtime, false, "declarative speculation rules are not framework JS");
});

test("no transitions frontmatter → no speculationrules script (default off)", () => {
  const html = compile(["---", "title: Plain", "---"]);
  assert.doesNotMatch(html, /speculationrules/);
});

test("transitions: false → no speculationrules script", () => {
  const html = compile(["---", "transitions: false", "---"]);
  assert.doesNotMatch(html, /speculationrules/);
});
