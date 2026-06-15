import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// Regressions caught by the fuzzer (tests/fuzz.test.js) and fixed in v0.9.0.
// These lock the exact behavior with deterministic, minimal repros.

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-regress-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Array.isArray(lines) ? lines.join("\n") : lines);
  return { file, run: () => compilePage(file, createPaths(root)) };
}

test("button action errors name the offending file (invariant: errors include file path)", () => {
  // Unsupported action shape.
  const a = compile(['# Title', ':button "X" -> badAction()']);
  assert.throws(a.run, (err) => {
    assert.match(err.message, /Unsupported button action/);
    assert.match(err.message, /index\.wd/); // file path present
    return true;
  });

  // `+=` with a non-number value against a non-list state target.
  const b = compile([':state n = 0', '# Title', ':button "Y" -> n += "oops"']);
  assert.throws(b.run, (err) => {
    assert.match(err.message, /index\.wd/);
    assert.match(err.message, /list state target/);
    return true;
  });
});

test("interpolating a bare object errors instead of emitting [object Object]", () => {
  // `meta` is the frontmatter object; interpolating it bare is a mistake.
  const { run } = compile(['---', 'title: Hi', 'tags: [a, b]', '---', '- { meta }']);
  assert.throws(run, (err) => {
    assert.doesNotMatch(err.message, /\[object Object\]/);
    assert.match(err.message, /Cannot interpolate the object value/);
    assert.match(err.message, /index\.wd/);
    assert.match(err.message, /\{ meta\.title \}|@loop/); // offers a corrective path
    return true;
  });
});

test("interpolating an array frontmatter value joins with ', ' (not [object Object])", () => {
  const { run } = compile(['---', 'tags: [sales, revenue]', '---', '# T', 'Tags: { meta.tags }']);
  const { html } = run();
  assert.match(html, /Tags: sales, revenue/);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("a scalar frontmatter field still interpolates normally", () => {
  const { run } = compile(['---', 'title: Hello', '---', '# { meta.title }']);
  const { html } = run();
  assert.match(html, /Hello/);
});
