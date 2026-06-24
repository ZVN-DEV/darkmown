import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Cross-document view transitions: opt-in via `transitions: true` frontmatter.
// Emits the CSS-only @view-transition rule (no JS, same-origin, graceful
// fallback). Was previously disabled; re-enabled per page so authors choose.
// ---------------------------------------------------------------------------

const STYLE = "<style>@view-transition { navigation: auto; }</style>";

test("transitions: true emits the @view-transition style in <head>", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "transitions: true", "---", "<main>", "", "Hi", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.ok(page.html.includes(STYLE), "expected the @view-transition style to be emitted");
  // it belongs to the document head, before </head>
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  assert.ok(head.includes(STYLE), "the style must live in <head>");
  // opting into transitions is presentational only — the page stays zero-JS
  assert.equal(page.assets.runtime, false, "view transitions must not force the runtime on");
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
