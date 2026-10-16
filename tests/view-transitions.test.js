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
// default is a quick out-then-in: outgoing fades to 0 in 90ms, incoming fades
// in after an 80ms delay. A simultaneous cross-fade was measured on a real
// site and read as flicker: the incoming snapshot stacks over the outgoing
// one, so image-heavy pages double-expose (outgoing opaque, incoming ghosting
// through). Sequencing keeps at most a ~10ms overlap near background opacity.
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

test("transitions: true emits a sequenced out-then-in with no ghosting overlap", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  // A simultaneous cross-fade stacks both snapshots (incoming over outgoing)
  // and double-exposes image-heavy pages: measured as flicker. The outgoing
  // snapshot therefore fades out first (90ms) and the incoming one fades in
  // after an 80ms delay, so the overlap is at most ~10ms near background
  // opacity and nothing ever ghosts.
  assert.match(
    html,
    /::view-transition-old\(root\)\s*\{\s*animation:\s*wd-nav-out\s+90ms\s+cubic-bezier\(0\.4, 0, 0\.2, 1\)\s+both/,
    "old(root) fades out over 90ms"
  );
  assert.match(
    html,
    /::view-transition-new\(root\)\s*\{\s*animation:\s*wd-nav-in\s+130ms\s+cubic-bezier\(0\.4, 0, 0\.2, 1\)\s+80ms\s+both/,
    "new(root) fades in after an 80ms delay"
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
  const start = html.indexOf("@view-transition");
  const style = html.slice(start, html.indexOf("</style>", start));
  assert.doesNotMatch(style, /transform|translate/, "the transition is opacity-only");
  // The reduced-motion reduction stays: everything collapses to 1ms with no delay.
  assert.match(
    html,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*::view-transition-old\(root\), ::view-transition-new\(root\)\s*\{\s*animation-duration:\s*1ms;\s*animation-delay:\s*0ms/,
    "prefers-reduced-motion keeps the 1ms reduction"
  );
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
