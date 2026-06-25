import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Compile-error line numbers — unclosed blocks report file:line, not just file.
// ---------------------------------------------------------------------------

test("an unclosed @loop reports the opener's line as file:line", () => {
  const root = fixture();
  // No frontmatter, so body line indices are 1:1 with the file. @loop is line 3.
  write(root, "site/pages/bad.wd", ["Intro copy.", "", "@loop items into item", "- { item.x }"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Missing @endloop.*bad\.wd:3/
  );
});

test("an unclosed :if reports the opener's line", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", [":state n = 0", "", ":if n > 0", "high"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /:endif.*bad\.wd:3/
  );
});

// ---------------------------------------------------------------------------
// Unknown-directive warnings — typos that fall through to prose get a hint.
// ---------------------------------------------------------------------------

test("a mistyped directive warns (lowercase, capitalized, and hyphenated forms)", () => {
  for (const typo of ["@loopp items into x", ":State count = 0", ":end-loop"]) {
    const root = fixture();
    write(root, "site/pages/index.wd", ["# Title", "", typo].join("\n"));
    const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
    assert.ok(
      page.warnings.some((w) => /looks like a directive but matches none/.test(w)),
      `expected a typo warning for "${typo}", got: ${JSON.stringify(page.warnings)}`
    );
  }
});

test("a real directive and ordinary prose do NOT warn", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [":state count = 0", "", "Count: { count }", "", "Reach me at hello@example.com."].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.warnings.filter((w) => /looks like a directive/.test(w)).length, 0);
});

// ---------------------------------------------------------------------------
// Honest error for an unsupported inner-loop row delete.
// ---------------------------------------------------------------------------

test("deleting a row of a nested (item-relative) loop fails loud with a corrective hint", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state teams = [{"id": 1, "name": "A", "members": [{"id": 11, "name": "x"}]}]',
    "",
    "@loop teams into team",
    "@loop team.members into member",
    ':button "Remove" -> members remove member',
    "@endloop",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /nested \(item-relative\) loop/
  );
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-compile-dx-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
