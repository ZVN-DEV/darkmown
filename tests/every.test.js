// Compile-level tests for the time layer: `:every <duration> -> <actions>`.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-every-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  return compileDocument(pageFile, createPaths(root));
}

/** Pull the JSON payload of the emitted data-wd-every marker. */
function everyDef(html) {
  const m = html.match(/<script type="application\/json" data-wd-every>(.*?)<\/script>/s);
  return m ? JSON.parse(m[1].replaceAll("\\u003c", "<")) : null;
}

test(":every emits a marker, declares the runtime, and parses the action", () => {
  const doc = compile(`:state count = 0\n\n:every 5s -> count++`);
  assert.equal(doc.assets.runtime, true);
  assert.deepEqual(everyDef(doc.html), { ms: 5000, actions: [{ op: "inc", target: "count" }] });
});

test(":every parses ms / s / m units and a bare integer (ms)", () => {
  assert.equal(everyDef(compile(`:state n = 0\n\n:every 500ms -> n++`).html).ms, 500);
  assert.equal(everyDef(compile(`:state n = 0\n\n:every 3s -> n++`).html).ms, 3000);
  assert.equal(everyDef(compile(`:state n = 0\n\n:every 2m -> n++`).html).ms, 120000);
  assert.equal(everyDef(compile(`:state n = 0\n\n:every 250 -> n++`).html).ms, 250);
});

test(":every chains multiple actions with ;", () => {
  const def = everyDef(compile(`:state n = 0\n:state m = 0\n\n:every 1s -> n++ ; m += 2`).html);
  assert.deepEqual(def.actions, [
    { op: "inc", target: "n" },
    { op: "add", target: "m", value: 2 }
  ]);
});

test(":every with a fetch refetch is the live-polling pattern", () => {
  const doc = compile(`:fetch board from "/__wd/data/x.json"\n\n:every 5s -> board refetch`);
  assert.deepEqual(everyDef(doc.html).actions, [{ op: "refetch", target: "board" }]);
});

test(":every rejects a malformed directive, bad duration, and zero", () => {
  assert.throws(() => compile(`:state n = 0\n\n:every 5s n++`), /Malformed :every/);
  assert.throws(() => compile(`:state n = 0\n\n:every 5x -> n++`), /duration "5x" is not valid/);
  assert.throws(() => compile(`:state n = 0\n\n:every 0s -> n++`), /duration "0s" is not valid/);
});

test(":every validates its action targets like :button", () => {
  assert.throws(() => compile(`:every 1s -> ghost++`), /unknown state "ghost"/);
});
