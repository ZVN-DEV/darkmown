import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(text, ext = "wd") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-tasks-"));
  const file = path.join(root, `site/pages/index.${ext}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntitle: T\n---\n\n${text}\n`);
  return compilePage(file, createPaths(root));
}

test("a .wd task list renders read-only checkboxes", () => {
  const { html } = compile("- [ ] Open\n- [x] Done\n- [X] Also done");
  assert.match(html, /<li><input type="checkbox" disabled> Open<\/li>/);
  assert.match(html, /<li><input type="checkbox" disabled checked> Done<\/li>/);
  assert.match(html, /<li><input type="checkbox" disabled checked> Also done<\/li>/);
});

test("a task list works in an ordered list and in a loose one", () => {
  assert.match(compile("1. [x] First").html, /<li><input type="checkbox" disabled checked> First/);
  assert.match(
    compile("- [ ] One\n\n- [ ] Two").html,
    /<li>\s*<p><input type="checkbox" disabled> One<\/p>/
  );
});

test("a task item keeps its bindings and inline markup", () => {
  const { html } = compile(":state n = 3\n\n- [ ] **Bold** { n }");
  assert.match(
    html,
    /<input type="checkbox" disabled> <strong>Bold<\/strong> <span data-wd-bind="n"/
  );
});

test("a static task list keeps the page static", () => {
  assert.equal(compile("- [ ] Open").assets.runtime, false);
});

test(".md stays strict CommonMark", () => {
  const { html } = compile("- [ ] Open", "md");
  assert.match(html, /<li>\[ \] Open<\/li>/);
  assert.doesNotMatch(html, /<input/);
});

test("only a leading marker in a list item counts", () => {
  for (const text of [
    "[ ] Not in a list",
    "- Item [ ] later",
    "- [y] Other",
    "- [ ]no space",
    "- \\[ ] Escaped"
  ]) {
    assert.doesNotMatch(compile(text).html, /<input/, text);
  }
});
