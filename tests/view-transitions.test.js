import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Cross-document view transitions: opt-in via `transitions: true` frontmatter.
// Emits a CSS-only stylesheet (no JS, same-origin, graceful fallback). The
// default UA cross-fade dissolves both pages simultaneously, so mid-navigation
// the outgoing and incoming pages sit superimposed at ~50% opacity — a visible
// "double-exposure" ghost. We override it with a directional fade+slide so the
// pages move past each other instead of stacking. Re-enabled per page.
// ---------------------------------------------------------------------------

test("transitions: true emits the @view-transition opt-in in <head>", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  assert.match(head, /@view-transition\s*\{\s*navigation:\s*auto/, "the @view-transition opt-in must live in <head>");
  // opting into transitions is presentational only — the page stays zero-JS
  assert.equal(page.assets.runtime, false, "view transitions must not force the runtime on");
});

test("transitions: true overrides the default root cross-fade with a directional fade+slide", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n"));
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  // The outgoing and incoming root snapshots each get their own keyed animation
  // (not the UA cross-fade), so they never sit superimposed at 50% opacity.
  assert.match(html, /::view-transition-old\(root\)[^}]*animation:[^};]*wd-nav-out/, "old(root) must use the custom leave animation");
  assert.match(html, /::view-transition-new\(root\)[^}]*animation:[^};]*wd-nav-in/, "new(root) must use the custom enter animation");
  // Both keyframes must exist and include a translate (the directional slide
  // that separates the two pages so text doesn't ghost over text).
  assert.match(html, /@keyframes wd-nav-out\s*\{[^}]*translateY/, "wd-nav-out keyframes must slide");
  assert.match(html, /@keyframes wd-nav-in\s*\{[^}]*translateY/, "wd-nav-in keyframes must slide");
});

test("no transitions frontmatter → no @view-transition style (default off)", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "title: Plain", "---", "<main>", "", "Hi", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.ok(!page.html.includes("@view-transition"), "default pages must not emit the rule");
});

test("transitions: false explicitly opts out", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "transitions: false", "---", "<main>", "", "Hi", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.ok(!page.html.includes("@view-transition"), "transitions: false must not emit the rule");
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-transitions-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
