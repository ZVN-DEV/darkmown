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
// Frontmatter offset: errors report TRUE file lines, not body-relative ones.
// ---------------------------------------------------------------------------

test("a directive error after a frontmatter block reports the true file line", () => {
  const root = fixture();
  // Frontmatter occupies file lines 1-3, so the bad :state on body line 2 is
  // FILE line 5 — the number an editor jump-to-line needs.
  write(root, "site/pages/bad.wd", ["---", "title: Offset", "---", "", ":state x"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:5/
  );
});

test("an unclosed block after a frontmatter block reports the opener's true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    ["---", "title: Offset", "date: 2026-01-01", "---", "", "@loop items into item", "- x"].join(
      "\n"
    )
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Missing @endloop.*bad\.wd:6/
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
// Nested-block error line numbers: handlers inside a block body get indices
// relative to the SLICED body, so the recursive compile threads a line offset
// (nestedCtx) — errors report the TRUE file line at any depth, in every block
// kind (container, loop rows/@empty, :if branches, form, carousel).
// ---------------------------------------------------------------------------

test("a malformed directive nested in a container reports the true file line", () => {
  const root = fixture();
  // The bad :state sits on FILE line 5; body-relative it is line 2 of the slice.
  write(root, "site/pages/bad.wd", ["# Title", "", "::: hero", "", ":state x", ":::"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:5/
  );
});

test("a malformed directive at container depth 2 reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    ["::: outer", "::: inner", "", ":state x", ":::", ":::"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:4/
  );
});

test("a malformed directive in a reactive loop body reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [
      ":state items = [1, 2]",
      "",
      "@loop items into item",
      "- { item }",
      ":state y",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:5/
  );
});

test("a malformed directive in a static loop body reports the true file line (with frontmatter)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [
      "---",
      "title: T",
      "tags: [a, b]",
      "---",
      "",
      "@loop meta.tags into tag",
      "- { tag }",
      ":state z",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:8/
  );
});

test("a malformed directive in a reactive loop @empty branch reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [
      ":state items = []",
      "",
      "@loop items into item",
      "- { item }",
      "@empty",
      ":state z",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:6/
  );
});

test("a malformed directive in a static loop @empty branch reports the true file line", () => {
  const root = fixture();
  // meta.tags is absent → zero rows → the @empty branch compiles.
  write(
    root,
    "site/pages/bad.wd",
    [
      "---",
      "title: T",
      "---",
      "",
      "@loop meta.tags into tag",
      "- x",
      "@empty",
      ":state z",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:8/
  );
});

test("a malformed directive nested at depth 2 (loop inside container) reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    ["::: wrap", ":state items = [1]", "@loop items into item", ":state y", "@endloop", ":::"].join(
      "\n"
    )
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:4/
  );
});

test("a malformed directive in a nested (item-relative) loop body reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [
      ':state teams = [{"members": [1]}]',
      "",
      "@loop teams into team",
      "@loop team.members into m",
      ":state bad",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:5/
  );
});

test("a malformed directive in an :if truthy branch reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":state n = 0", "", ":if n > 0", ":state q", ":endif"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:4/
  );
});

test("a malformed directive in an :else branch reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":state n = 0", "", ":if n > 0", "high", ":else", ":state q", ":endif"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:6/
  );
});

test("a malformed directive in an :else if branch reports the true file line (desugared :if)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":state n = 0", "", ":if n > 5", "high", ":else if n > 1", ":state q", ":endif"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:6/
  );
});

test("a malformed directive inside a :form body reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":form into contact", ":input name", ":state bad", ":endform"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:3/
  );
});

test("a malformed directive inside a :carousel slide reports the true file line", () => {
  const root = fixture();
  write(
    root,
    "site/pages/bad.wd",
    [":carousel", "::: slide", ":state bad", ":::", ":endcarousel"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :state.*bad\.wd:3/
  );
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

// ---------------------------------------------------------------------------
// The operator the author WROTE is the operator that ships.
// ---------------------------------------------------------------------------

test('`list append "…prepend…"` stays an append — the OPERAND cannot pick the operator', () => {
  // The check used to search the whole expression for " prepend ", so a value
  // that merely contained the word silently compiled to data-wd-action="prepend"
  // and the item landed at the wrong end of the list. No error, no warning.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":store list = []", ':button "A" -> list append "we prepend things"'].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  assert.match(html, /data-wd-action="append"/);
  assert.doesNotMatch(html, /data-wd-action="prepend"/);
  assert.match(html, /data-wd-value="&quot;we prepend things&quot;"/, "the value is intact");
});

test("`list prepend v` is still a prepend (control)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":store list = []", ':button "B" -> list prepend "x"'].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  assert.match(html, /data-wd-action="prepend"/);
});

test("a value containing the word append does not turn a prepend into an append", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":store list = []", ':button "C" -> list prepend "we append things"'].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  assert.match(html, /data-wd-action="prepend"/);
});

// ---------------------------------------------------------------------------
// One error, one code.
// ---------------------------------------------------------------------------

test("the include-cycle error prints its code exactly once", () => {
  // `wdError` prefixes `[WDxxx]`, and page.js hardcoded a second copy in the
  // message text, so the terminal showed `[WD612] [WD612] Include cycle …`.
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /a.wd\n");
  write(root, "site/_/a.wd", "@include /b.wd\n");
  write(root, "site/_/b.wd", "@include /a.wd\n");
  let err;
  try {
    compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected an include cycle to be detected");
  assert.equal(err.message.match(/\[WD612\]/g).length, 1, err.message);
  assert.match(err.message, /^\[WD612\] Include cycle detected: /);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-compile-dx-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// ---------------------------------------------------------------------------
// The "looks like a directive but matches none" warning must name only lines
// that really match none.
// ---------------------------------------------------------------------------

/** Compile a body and return its non-fatal warnings. */
function warningsOf(body) {
  const root = fixture();
  write(root, "site/pages/index.wd", body);
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).warnings;
}

test("a real directive never trips the unknown-directive warning", () => {
  // KNOWN_DIRECTIVE is consulted only for lines that fell through to prose, so a
  // name missing from it turns a directive typo into "check the spelling" — the
  // wrong problem for a token spelled correctly.
  for (const line of [
    ":slider volume = 50 min=0 max=100 step=1",
    ":slider", // the bare opener: still a real directive, just missing its name
    ":carousel\n::: slide\nhi\n:::\n:endcarousel"
  ]) {
    assert.deepEqual(
      warningsOf(`${line}\n`).filter((w) => w.includes("matches none")),
      [],
      line
    );
  }
});

test("a deleted directive DOES trip it — :note and :sprint are no longer .wd syntax", () => {
  // The mirror image: a name left in KNOWN_DIRECTIVE after its handler is gone
  // renders as literal text AND suppresses the warning that would have said so.
  const warnings = warningsOf(':note "gone"\n:sprint min=1 max=2 roles="a"\n');
  assert.equal(warnings.length, 2, warnings.join("\n"));
  assert.match(warnings[0], /":note" looks like a directive but matches none/);
  assert.match(warnings[1], /":sprint" looks like a directive but matches none/);
});

test("a stray :endcarousel is the same coded error every other stray closer gets", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ":endcarousel\n");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /\[WD010\] Stray ":endcarousel" with no matching opener/
  );
});

test("the WD311 action hint lists refetch, so it names the whole vocabulary", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [":state n = 0", ':button "Go" -> n frobnicate 1'].join("\n"));
  let err;
  try {
    compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected an unsupported action to throw");
  assert.match(err.message, /^\[WD311\] /);
  assert.match(err.message, /refetch/, "WD311 under-reported the vocabulary it accepts");
  assert.match(err.wd.hint, /refetch/, "the structured hint must agree with the message");
});

test("the op the hint names actually compiles", () => {
  // A hint that lists something the compiler rejects is worse than an omission.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [':fetch board from "/api/board.json"', ':button "Refresh" -> board refetch'].join("\n")
  );
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)).html;
  assert.match(html, /data-wd-action="refetch" data-wd-target="board"/);
});
