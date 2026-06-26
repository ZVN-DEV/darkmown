import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Per-row actions inside a reactive @loop: `list remove item`, `cart += item`
// ---------------------------------------------------------------------------

test("`cart += product` inside a loop emits an append-row action targeting the other list", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state products = [{"id":1,"name":"Aurora"}]',
      ":state cart = []",
      "@loop products into product",
      "::: card",
      "{ product.name }",
      ':button "Add" -> cart += product',
      ":::",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(
    page.html,
    /<button type="button" data-wd-action="append-row" data-wd-target="cart">Add<\/button>/
  );
  assert.equal(page.assets.runtime, true);
});

test("`todos remove todo` inside a loop emits a remove action targeting the looped list", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state todos = [{"id":1,"title":"A"}]',
      "@loop todos into todo",
      "::: card",
      "{ todo.title }",
      ':button "Remove" -> todos remove todo',
      ":::",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-action="remove" data-wd-target="todos"/);
});

test("`remove` with a literal value outside a loop is remove-value (not the row op)", () => {
  // New semantics: when the operand is NOT the active loop item it is a value to
  // strip from the list. A bare identifier isn't a literal, so it must be quoted.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state items = [1, 2]", ':button "x" -> items remove 2'].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-action="remove-value" data-wd-target="items" data-wd-value="2"/);
});

test("`remove` with a non-loop-item bare identifier is an unparseable literal", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state items = [1, 2]", ':button "x" -> items remove ghost'].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported action literal/
  );
});

test("`remove <other>` inside a loop where other != item is remove-value", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state todos = [{"id":1}]',
      "@loop todos into todo",
      "::: card",
      "x",
      ':button "Remove" -> todos remove "done"',
      ":::",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(
    page.html,
    /data-wd-action="remove-value" data-wd-target="todos" data-wd-value="&quot;done&quot;"/
  );
});

test("`remove` must target the list being looped, not a different list", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state todos = [{"id":1}]',
      ":state other = []",
      "@loop todos into todo",
      "::: card",
      "x",
      ':button "Remove" -> other remove todo',
      ":::",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /must target the :state list being looped/
  );
});

test("`cart += item` requires the target to be a :state list", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state products = [{"id":1}]',
      ':state note = ""',
      "@loop products into product",
      "::: card",
      "x",
      ':button "Add" -> note += product',
      ":::",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /needs note to be a :state list/
  );
});

test("ordinary loop actions and literal append still work (no regression)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ":state count = 0",
      ":state tags = []",
      ':button "Inc" -> count++',
      ':button "Tag" -> tags += "new"'
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-action="inc" data-wd-target="count"/);
  assert.match(
    page.html,
    /data-wd-action="append" data-wd-target="tags" data-wd-value="&quot;new&quot;"/
  );
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-rowaction-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
