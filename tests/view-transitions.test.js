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
// default is one simultaneous cross-fade: the outgoing snapshot fades out
// while the incoming fades in, opacity-only, same duration and easing both
// ways. An earlier directional fade+slide read as a flicker on real sites, so
// there is deliberately no transform anywhere in the keyframes. Re-enabled per
// page.
// ---------------------------------------------------------------------------

test("transitions: true emits the @view-transition opt-in in <head>", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  assert.match(
    head,
    /@view-transition\s*\{\s*navigation:\s*auto/,
    "the @view-transition opt-in must live in <head>"
  );
  // opting into transitions is presentational only — the page stays zero-JS
  assert.equal(page.assets.runtime, false, "view transitions must not force the runtime on");
});

test("transitions: true emits a simultaneous opacity-only cross-fade (no transform, same timing both ways)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  // The outgoing and incoming root snapshots each get their own keyed fade,
  // running at once with the same duration and easing — a single cross-fade,
  // never an out-then-in sequence.
  const timing = /animation:\s*wd-nav-(?:out|in)\s+160ms\s+cubic-bezier\(0\.4, 0, 0\.2, 1\)\s+both/;
  assert.match(
    html,
    /::view-transition-old\(root\)\s*\{\s*animation:\s*wd-nav-out\s+160ms\s+cubic-bezier\(0\.4, 0, 0\.2, 1\)\s+both/,
    "old(root) must fade out over 160ms"
  );
  assert.match(
    html,
    /::view-transition-new\(root\)\s*\{\s*animation:\s*wd-nav-in\s+160ms\s+cubic-bezier\(0\.4, 0, 0\.2, 1\)\s+both/,
    "new(root) must fade in over the same 160ms and easing"
  );
  assert.match(
    html,
    /@keyframes wd-nav-out\s*\{\s*to\s*\{\s*opacity:\s*0;\s*\}\s*\}/,
    "wd-nav-out is opacity-only"
  );
  assert.match(
    html,
    /@keyframes wd-nav-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*\}/,
    "wd-nav-in is opacity-only"
  );
  // No transform anywhere in the transition stylesheet: the directional slide
  // was the flicker source, so nothing may move the snapshots.
  const start = html.indexOf("@view-transition");
  const style = html.slice(start, html.indexOf("</style>", start));
  assert.doesNotMatch(style, /transform|translate/, "the cross-fade is opacity-only");
  // The reduced-motion reduction stays: same fade, collapsed to 1ms.
  assert.match(
    html,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*::view-transition-old\(root\), ::view-transition-new\(root\)\s*\{\s*animation-duration:\s*1ms/,
    "prefers-reduced-motion keeps the 1ms reduction"
  );
  assert.ok(timing.test(style));
});

test("no transitions frontmatter → no @view-transition style (default off)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: Plain", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.ok(!page.html.includes("@view-transition"), "default pages must not emit the rule");
});

test("transitions: false explicitly opts out", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "transitions: false", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
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
