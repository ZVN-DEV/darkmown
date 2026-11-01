import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// A page that compiles clean but cannot work is the worst outcome for an AI
// authoring loop, which reads a green compile as "done". These stay warnings, not
// errors, because the page still builds and a colocated .js can set state.
function compile(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-silent-"));
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, "site/pages", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}
const page = (...lines) => ["---", "title: T", "---", "", ...lines].join("\n");

test("an unresolved name in prose warns with its line, once", () => {
  const { html, warnings } = compile({
    "index.wd": page("Hello { usr.name } and { usr.name }.")
  });
  assert.match(html, /Hello \{ usr\.name \}/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /index\.wd:5: "\{ usr\.name \}" matches no :state/);
});

test("an unresolved name offers the nearest declared name", () => {
  const { warnings } = compile({ "index.wd": page(":state count = 0", "", "{ coutn }") });
  assert.match(warnings[0], /Did you mean "count"\?/);
});

test("an unresolved name with nothing close offers no guess", () => {
  const { warnings } = compile({
    "index.wd": page(":state count = 0", "", "{ somethingelse } { c }")
  });
  assert.doesNotMatch(warnings[0], /Did you mean/);
});

test("a missing include argument warns from the include's own file", () => {
  const { warnings } = compile({
    "index.wd": page('@include /card.wd with title="Hi"'),
    "../_/card.wd": "{ title } { titel }\n"
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /card\.wd:1: "\{ titel \}"/);
  assert.match(warnings[0], /Did you mean "title"\?/);
});

test("braces the author escaped or put in code do not warn", () => {
  const { warnings } = compile({
    "index.wd": page("Write \\{ name } to bind. Or `{ name }`.", "", "```", "{ name }", "```")
  });
  assert.deepEqual(warnings, []);
});

test("a :fetch URL reading undeclared state warns, naming the file and line", () => {
  const { warnings } = compile({
    "index.wd": page(":state id = 1", ':fetch user from "/api/u/{ userid }"')
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /index\.wd:6: :fetch "\/api\/u\/\{ userid \}" reads "\{ userid \}"/);
});

test("a :fetch URL may read state declared further down the page", () => {
  const { warnings } = compile({
    "index.wd": page(':fetch user from "/api/u/{ id }"', ":state id = 1")
  });
  assert.deepEqual(warnings, []);
});

test("a :fetch URL may read another :fetch's result", () => {
  const { warnings } = compile({
    "index.wd": page(':fetch a from "/api/a"', ':fetch b from "/api/b/{ a.id }"')
  });
  assert.deepEqual(warnings, []);
});
