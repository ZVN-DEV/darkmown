// Reactive sort: `sort by { stateKey } { stateDir }` lets clickable headers
// re-sort a loop live. Literal `sort by item.field [asc|desc]` is unchanged.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(body, { shelf = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sort-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [name, content] of Object.entries(shelf)) {
    fs.writeFileSync(path.join(root, "site/_", name), content);
  }
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  return compileDocument(pageFile, createPaths(root));
}

test("literal sort by item.field [dir] is unchanged (folds at build time)", () => {
  const doc = compile(`@loop /p.json into p sort by p.price desc\n- { p.name }\n@endloop`, {
    shelf: {
      "p.json": JSON.stringify([
        { name: "A", price: 9 },
        { name: "B", price: 3 }
      ])
    }
  });
  assert.equal(doc.assets.runtime, false, "a static literal sort stays zero-JS");
  // B ($3) before A ($9) under desc? desc on price → 9 first → A then B
  assert.ok(doc.html.indexOf("A") < doc.html.indexOf("B"));
});

test("sort by { state } makes the loop reactive and emits a key: sort attr", () => {
  const doc = compile(
    `:store rows = [{"id":1,"name":"Bee"},{"id":2,"name":"Ant"}]\n:state sortKey = "name"\n\n@loop rows into r sort by { sortKey }\n- { r.name }\n@endloop`
  );
  assert.equal(doc.assets.runtime, true);
  assert.match(doc.html, /data-wd-loop-sort="key:sortKey"/);
  assert.match(doc.html, /data-wd-loop-sort-dir="asc"/);
});

test("sort by { state } { dirState } makes both the column and direction reactive", () => {
  const doc = compile(
    `:state rows = []\n:state sortKey = "name"\n:state sortDir = "desc"\n\n@loop rows into r sort by { sortKey } { sortDir }\n- { r.name }\n@endloop`
  );
  assert.match(doc.html, /data-wd-loop-sort="key:sortKey" data-wd-loop-sort-dir="key:sortDir"/);
});

test("a reactive sort over a JSON source ships the runtime (no longer folds)", () => {
  const doc = compile(
    `:state sortKey = "price"\n\n@loop /p.json into p sort by { sortKey }\n- { p.name }\n@endloop`,
    { shelf: { "p.json": JSON.stringify([{ name: "A", price: 9 }]) } }
  );
  assert.equal(doc.assets.runtime, true);
  assert.match(doc.html, /data-wd-loop-sort="key:sortKey"/);
});

test("sort by { unknown } is a compile error for column and direction", () => {
  assert.throws(
    () => compile(`:state rows = []\n\n@loop rows into r sort by { ghost }\nx\n@endloop`),
    /sort by \{ ghost \} references unknown/
  );
  assert.throws(
    () => compile(`:state rows = []\n\n@loop rows into r sort by r.name { ghostDir }\nx\n@endloop`),
    /sort direction \{ ghostDir \} references unknown/
  );
});
