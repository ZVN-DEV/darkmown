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
  write(
    root,
    "site/pages/bad.wd",
    ["Intro copy.", "", "@loop items into item", "- { item.x }"].join("\n")
  );
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
// Malformed-directive errors carry the directive's own line (file:line), not
// just the file — matching the unclosed-block errors above.
// ---------------------------------------------------------------------------

test("a malformed :state reports the directive's line as file:line", () => {
  const root = fixture();
  // No frontmatter, so body line indices are 1:1 with the file. :state is line 3.
  write(root, "site/pages/bad.wd", ["# Title", "", ":state x"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:3/
  );
});

test("a malformed directive error includes file:line for several directives", () => {
  const cases = [
    { line: ":fetch x", re: /Malformed :fetch.*bad\.wd:3/ },
    { line: ":button broken", re: /Malformed :button.*bad\.wd:3/ },
    { line: ":computed x", re: /Malformed :computed.*bad\.wd:3/ },
    { line: "@include a b", re: /Malformed @include.*bad\.wd:3/ }
  ];
  for (const { line, re } of cases) {
    const root = fixture();
    write(root, "site/pages/bad.wd", ["# Title", "", line].join("\n"));
    assert.throws(
      () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
      re,
      `expected "${line}" to throw matching ${re}`
    );
  }
});

// ---------------------------------------------------------------------------
// Action-literal errors name the failing page (no longer a bare token).
// ---------------------------------------------------------------------------

test("an unsupported action literal names the file", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":state n = 0", "", ':button "Go" -> n = {not json}'].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Unsupported action literal.*bad\.wd/
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
  write(
    root,
    "site/pages/index.wd",
    [":state count = 0", "", "Count: { count }", "", "Reach me at hello@example.com."].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.warnings.filter((w) => /looks like a directive/.test(w)).length, 0);
});

// ---------------------------------------------------------------------------
// Honest error for an unsupported inner-loop row delete.
// ---------------------------------------------------------------------------

test("deleting a row of a nested (item-relative) loop fails loud with a corrective hint", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state teams = [{"id": 1, "name": "A", "members": [{"id": 11, "name": "x"}]}]',
      "",
      "@loop teams into team",
      "@loop team.members into member",
      ':button "Remove" -> members remove member',
      "@endloop",
      "@endloop"
    ].join("\n")
  );
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
