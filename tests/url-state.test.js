// ---------------------------------------------------------------------------
// F2 — `:state … from-url`, compile side.
//
// `from-url` is a third word in the persistence vocabulary, on `:state` only:
// it says the value ALSO lives in the query string. It composes with `persist`
// (URL beats storage beats seed at boot) and is rejected with a reason on
// `:store`/`:theme`, which are shared across pages and tabs.
//
// The runtime half — boot precedence, replaceState, popstate — lives in
// tests/runtime-dom.test.js.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-url-state-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), lines.join("\n"));
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The thrown compile error for `lines`, or null when it compiles. */
function errorFor(lines) {
  try {
    compile(lines);
    return null;
  } catch (error) {
    return error;
  }
}

test("`from-url` marks the seed script with the state key", () => {
  const page = compile([':state q = "" from-url', "", "Query: { q }"]);
  assert.match(page.html, /<script type="application\/json" data-wd-state data-wd-url="q">/);
});

test("`from-url` composes with `persist`, in either order", () => {
  for (const line of [':state q = "" persist from-url', ':state q = "" from-url persist']) {
    const page = compile([line, "", "Query: { q }"]);
    assert.match(page.html, /data-wd-persist="q"/, line);
    assert.match(page.html, /data-wd-url="q"/, line);
  }
});

test("the seed is still the seed — the token is never swallowed into the value", () => {
  // The failure this vocabulary exists to prevent: a token glued to the value,
  // seeding the STRING `"" from-url` and failing much later, somewhere else.
  const page = compile([':state q = "start" from-url']);
  assert.match(page.html, /\{"q":"start"\}/);
});

test("a section-qualified key keeps its full key on the marker", () => {
  // The runtime derives the query parameter from the key (`cart:items` →
  // `cart.items`), so the marker carries the key, not the parameter.
  const page = compile([
    "::: section #cart",
    ':state items = "" from-url',
    "",
    "In cart: { items }",
    ":::"
  ]);
  assert.match(page.html, /data-wd-url="cart:items"/);
});

test("NEGATIVE CONTROL: without the token there is no marker at all", () => {
  const page = compile([':state q = ""', "", "Query: { q }"]);
  assert.doesNotMatch(page.html, /data-wd-url/);
});

test("`from-url` on a :store is WD260, and says why", () => {
  const error = errorFor([":store cart = [] from-url"]);
  assert.match(error.message, /\[WD260\]/);
  assert.match(error.message, /:store in .*index\.wd:1 cannot be from-url/);
  assert.match(error.message, /shared by every page and every tab/);
  assert.match(error.message, /Use: :state name = value from-url/);
  assert.equal(error.wd.code, "WD260");
  assert.equal(error.wd.line, 1);
});

test("`from-url` on a :theme is WD260 too", () => {
  const error = errorFor([':theme = "auto" from-url']);
  assert.match(error.message, /\[WD260\]/);
});

test("`from-url` on a :computed is WD211, and names the fix", () => {
  const error = errorFor([":state n = 1", ":computed double = n * 2 from-url"]);
  assert.match(error.message, /\[WD211\]/);
  assert.match(error.message, /cannot come from the URL/);
});

test("`persist ephemeral` on one line is WD261 rather than a swallowed token", () => {
  // Before the modifier tail was parsed as a set, this compiled: `ephemeral`
  // was the token and `persist` became part of the value.
  const error = errorFor([":state n = 0 persist ephemeral"]);
  assert.match(error.message, /\[WD261\]/);
  assert.match(error.message, /"persist" and "ephemeral" at once/);
  assert.equal(error.wd.code, "WD261");
});

test("the same modifier twice is WD261", () => {
  const error = errorFor([":state n = 0 persist persist"]);
  assert.match(error.message, /\[WD261\]/);
  assert.match(error.message, /the same word twice/);
});

test("a quoted value that ENDS in a modifier word is still text", () => {
  // The documented escape hatch: quoting keeps the word.
  const page = compile([':state label = "keep it ephemeral"']);
  assert.match(page.html, /\{"label":"keep it ephemeral"\}/);
  assert.doesNotMatch(page.html, /data-wd-store-ephemeral/);
});
