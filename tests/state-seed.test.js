// ---------------------------------------------------------------------------
// WD251 — a `:state`/`:store` seed that NAMES another state.
//
// `:state title = Hello world` storing the literal string is a deliberate
// feature: a headline should not need quotes. The cost of that unquoted fallback
// is `:state b = a`, which reads as "seed b from a" and instead stores the
// one-character STRING "a". The page compiles, renders the letter a, and nothing
// ever points at the line that caused it — the same silent class as the
// `persist`-swallowed-into-the-value bug this codebase already fixed once.
//
// So the compiler asks, exactly once, and only when the bare word is a name it
// can see is declared state. Quoting is the escape hatch, as it always was.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-state-seed-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return compilePage(file, createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("WD251: :state seeded from a declared state is a compile error, not the string", () => {
  assert.throws(
    () => compile([":state count = 0", ":state b = count"]),
    (err) => {
      assert.match(err.message, /^\[WD251\] /);
      assert.match(err.message, /index\.wd:2/, "points at the offending line");
      assert.match(err.message, /names the declared state "count"/);
      assert.match(err.message, /stored verbatim/, "explains what would have happened");
      assert.match(err.message, /Use: :computed name = count to derive it/, "gives the fix");
      assert.equal(err.wd.code, "WD251");
      return true;
    }
  );
});

test("WD251 covers :store the same way", () => {
  assert.throws(() => compile([":store cart = 1", ":store b = cart"]), /WD251/);
});

test("WD251 covers a :store seeded from a :state (and the reverse)", () => {
  assert.throws(() => compile([":state count = 0", ":store b = count"]), /WD251/);
  assert.throws(() => compile([":store cart = 1", ":state b = cart"]), /WD251/);
});

test("WD251 sees a section-scoped state through the scope chain", () => {
  assert.throws(
    () => compile(["::: card #box", ":state count = 0", ":state b = count", ":::"]),
    /WD251/
  );
});

test("the fix the error names actually compiles", () => {
  const page = compile([":state count = 0", ":computed b = count"]);
  assert.match(page.html, /data-wd-computed-key="b"/);
});

test("quoting keeps the literal text — the documented escape hatch", () => {
  const page = compile([":state count = 0", ':state b = "count"']);
  assert.match(page.html, /"b":"count"/);
});

test("a bare word that names NOTHING still seeds the string (the feature)", () => {
  // `:state title = Hello world` is the headline case, and a single bare word
  // that happens to look like an identifier is the same thing.
  const page = compile([":state title = Hello world", ":state status = draft"]);
  assert.match(page.html, /"title":"Hello world"/);
  assert.match(page.html, /"status":"draft"/);
});

test("a multi-word seed whose FIRST word names a state is untouched", () => {
  // The check is the whole right-hand side, not a prefix: `count them` is prose.
  const page = compile([":state count = 0", ":state note = count them"]);
  assert.match(page.html, /"note":"count them"/);
});

test("non-string seeds are never candidates", () => {
  // `true`/`false`/`null`/numbers/JSON parse to non-strings before the check.
  const page = compile([
    ":state count = 0",
    ":state flag = true",
    ":state nothing = null",
    ":state n = 42",
    ':state list = ["a"]'
  ]);
  assert.match(page.html, /"flag":true/);
  assert.match(page.html, /"nothing":null/);
  assert.match(page.html, /"n":42/);
  assert.match(page.html, /"list":\["a"\]/);
});

test("a persist token after a bare-word seed still parses as persistence", () => {
  // The persistence vocabulary is stripped before the seed is parsed, so the
  // seed check sees `draft`, not `draft persist`.
  const page = compile([":state status = draft persist"]);
  assert.match(page.html, /data-wd-persist="status"/);
  assert.match(page.html, /"status":"draft"/);
});
