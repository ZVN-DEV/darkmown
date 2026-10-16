import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Cross-document view transitions: opt-in via `transitions: true` frontmatter.
// Emits a CSS-only stylesheet (no JS, same-origin, graceful fallback). Both
// root snapshots get `animation: none`: three animated defaults failed in the
// field (a directional slide read as a bounce, a simultaneous cross-fade
// double-exposed because the incoming snapshot stacks over the outgoing one,
// and a sequenced out-then-in was ignored by a shipping browser in favor of
// its own cross-fade). VT animation compositing varies too much across engines
// for a default; the instant swap has no possible artifact, and prerendering
// carries the perceived speed.
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

test("transitions: true emits no root animation (instant swap, artifact-proof)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  // Three animated defaults failed in the field (slide bounce, cross-fade
  // double-exposure, a sequenced out-then-in a shipping browser replaced with
  // its own cross-fade). VT animation compositing varies too much across
  // engines for a default: both roots get animation:none so the swap is
  // instant with no possible artifact, and prerendering carries the speed.
  assert.match(
    html,
    /::view-transition-old\(root\), ::view-transition-new\(root\)\s*\{\s*animation:\s*none/,
    "both roots must be animation-free"
  );
  const start = html.indexOf("@view-transition");
  const style = html.slice(start, html.indexOf("</style>", start));
  assert.doesNotMatch(style, /@keyframes|wd-nav/, "no keyframes at all");
  assert.doesNotMatch(style, /transform|translate/, "no transforms");
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
