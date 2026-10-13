// F9 — build-time bindings: `{ $build.year }`, `{ $build.date }`,
// `{ $build.datetime }` fold to the compile timestamp in `.wd` sources.
//
// The fold is a source-level pass in src/compiler/page.js (foldBuildBindings),
// so it can never flip a page reactive, never collides with the `$index` /
// `$first` / … loop row variables, and an unknown `$build.*` name stays
// literal text. Fenced code blocks and inline code spans are left untouched,
// mirroring where `{ name }` interpolation does not run.

import assert from "node:assert/strict";
import test from "node:test";
import { foldBuildBindings } from "../src/compiler/page.js";
import { compileFromMemory } from "../src/compiler.js";

const NOW = new Date(2026, 9, 13, 8, 30, 0); // 2026-10-13 08:30 local

// ---------------------------------------------------------------------------
// The unit fold: values, fences, inline code, unknown names
// ---------------------------------------------------------------------------

test("year, date, and datetime fold from the compile timestamp", () => {
  const out = foldBuildBindings(
    "Built { $build.year } on { $build.date } at { $build.datetime }.",
    NOW
  );
  assert.match(out, /^Built 2026 on 2026-10-13 at /);
  assert.match(out, /at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.$/);
});

test("an unknown $build.* name stays literal text", () => {
  const out = foldBuildBindings("{ $build.month } { $build.year }", NOW);
  assert.equal(out, "{ $build.month } 2026");
});

test("loop row variables are not touched", () => {
  const out = foldBuildBindings("{ $index } { $number } { $first } { $build.year }", NOW);
  assert.equal(out, "{ $index } { $number } { $first } 2026");
});

test("fenced code blocks (backtick and tilde) are left untouched", () => {
  // A closing fence LONGER than the opener still closes (CommonMark), so
  // "After" folds while both fenced bodies stay literal.
  const source = [
    "Before { $build.year }",
    "```",
    "code { $build.year }",
    "````",
    "~~~js",
    "tilde { $build.date }",
    "~~~",
    "After { $build.year }"
  ].join("\n");
  const out = foldBuildBindings(source, NOW);
  assert.equal(
    out,
    [
      "Before 2026",
      "```",
      "code { $build.year }",
      "````",
      "~~~js",
      "tilde { $build.date }",
      "~~~",
      "After 2026"
    ].join("\n")
  );
});

test("inline code spans are left untouched, prose around them folds", () => {
  const out = foldBuildBindings("`{ $build.year }` and { $build.year }", NOW);
  assert.equal(out, "`{ $build.year }` and 2026");
});

test("a longer backtick run does not close a shorter span", () => {
  // One-backtick span opens; the two-backtick run must NOT close it
  // (CommonMark closes on a run of exactly the same length).
  const out = foldBuildBindings("`a `` b` and { $build.year }", NOW);
  assert.equal(out, "`a `` b` and 2026");
});

test("an unmatched backtick run is literal text; scanning resumes after it", () => {
  const out = foldBuildBindings("a ` b { $build.year }", NOW);
  assert.equal(out, "a ` b 2026");
});

test("the default timestamp is the current time", () => {
  const out = foldBuildBindings("{ $build.year }");
  assert.equal(out, String(new Date().getFullYear()));
});

// ---------------------------------------------------------------------------
// End to end through a page compile
// ---------------------------------------------------------------------------

const ENTRY = "site/pages/index.wd";

test("{ $build.year } folds in prose and keeps the page zero-JS", () => {
  const page = compileFromMemory(
    { [ENTRY]: "<main>\n\nBuilt { $build.year }.\n\n</main>\n" },
    ENTRY
  );
  assert.match(page.html, new RegExp(`Built ${new Date().getFullYear()}\\.`));
  assert.equal(page.assets.runtime, false, "a build binding is always static");
});

test("{ $build.date } folds inside raw HTML (html: true)", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: '---\nhtml: true\n---\n<main data-built="{ $build.date }">\n\nHi\n\n</main>\n'
    },
    ENTRY
  );
  assert.match(page.html, /data-built="\d{4}-\d{2}-\d{2}"/);
});

test("an unknown $build name stays literal through a full page compile", () => {
  const page = compileFromMemory({ [ENTRY]: "Built { $build.century }.\n" }, ENTRY);
  assert.match(page.html, /Built \{ \$build\.century \}\./);
});

test("a plain .md page leaves the binding literal (no interpolation in .md)", () => {
  const page = compileFromMemory(
    { "site/pages/index.md": "Built { $build.year }.\n" },
    "site/pages/index.md"
  );
  assert.match(page.html, /Built \{ \$build\.year \}\./);
});
