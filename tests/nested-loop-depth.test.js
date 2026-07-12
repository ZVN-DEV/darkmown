import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Reactive @loop nesting depth (TASK-01) + file:line on @loop/include errors
// (TASK-02/03).
//
// The runtime reconciles at most TWO nested `data-wd-loop` levels (an outer loop
// and one inner loop); a third level's `data-wd-loop-out` paints empty. The
// compiler rejects that third REACTIVE level up front. Static (build-unrolled)
// loops flatten to concrete markup and nest freely; a static level interleaved
// with reactive ones neither triggers nor masks the limit.
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-nest-depth-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(root) {
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

// --- TASK-01: third reactive level is rejected -----------------------------

test("three stacked REACTIVE loops throw with file:line and a corrective suggestion", () => {
  const root = fixture();
  // No frontmatter, so body line indices are 1:1 with the file. The offending
  // (third) reactive @loop sits on line 5.
  write(
    root,
    "site/pages/index.wd",
    [
      ':state orgs = [{"id":1,"teams":[{"id":"t1","members":[{"id":"m1"}]}]}]',
      "",
      "@loop orgs into org",
      "@loop org.teams into team",
      "@loop team.members into member",
      "- { member.id }",
      "@endloop",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  assert.throws(
    () => compile(root),
    (err) => {
      assert.match(err.message, /Reactive @loop nesting is limited to one inner level/);
      // Points at the third opener's true file line, and quotes that opener.
      assert.match(err.message, /index\.wd:5: "@loop team\.members into member"/);
      // Names the limit AND gives an actionable way out.
      assert.match(
        err.message,
        /Unroll the outer data at build time \(JSON\/frontmatter source\) or restructure with an include\./
      );
      return true;
    }
  );
});

test("two-level REACTIVE nesting still compiles (outer state list + one inner)", () => {
  const root = fixture();
  const page = (() => {
    write(
      root,
      "site/pages/index.wd",
      [
        ':state orgs = [{"id":1,"teams":[{"id":"t1","name":"Core"}]}]',
        "",
        "@loop orgs into org",
        "@loop org.teams into team",
        "- { team.name }",
        "@endloop",
        "@endloop"
      ].join("\n")
    );
    return compile(root);
  })();
  assert.equal(page.assets.runtime, true, "two reactive levels pull in the runtime");
  assert.match(page.html, /data-wd-loop="orgs"/);
  assert.match(page.html, /data-wd-loop-item="teams"/);
});

test("three-level STATIC nesting compiles and stays zero-JS", () => {
  const root = fixture();
  // A JSON data source unrolls at build time; the inner loops resolve their list
  // off the enclosing static row via scope (lookupPath), so all three stay static.
  write(
    root,
    "site/pages/orgs.json",
    '[{"id":1,"teams":[{"id":"t1","members":[{"id":"m1"},{"id":"m2"}]}]}]'
  );
  write(
    root,
    "site/pages/index.wd",
    [
      "@loop orgs.json into org",
      "@loop org.teams into team",
      "@loop team.members into member",
      "- { member.id }",
      "@endloop",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  assert.equal(page.assets.runtime, false, "a fully static unroll ships no runtime");
  // The deepest member id is unrolled into concrete markup (no data-wd-loop).
  assert.match(page.html, /m2/);
  assert.doesNotMatch(page.html, /data-wd-loop/);
});

test("a static OUTER loop wrapping two reactive inner levels is two reactive levels (allowed)", () => {
  const root = fixture();
  // The static outer loop doesn't add a reactive level, so the reactive state
  // loop (level 1) + its item-relative inner (level 2) stay within the limit.
  write(root, "site/pages/orgs.json", '[{"id":1},{"id":2}]');
  write(
    root,
    "site/pages/index.wd",
    [
      ':state teams = [{"id":"t1","members":[{"id":"m1"}]}]',
      "",
      "@loop orgs.json into org",
      "@loop teams into team",
      "@loop team.members into member",
      "- { member.id }",
      "@endloop",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  assert.equal(page.assets.runtime, true, "the two reactive inner levels need the runtime");
  assert.match(page.html, /data-wd-loop="teams"/);
  assert.match(page.html, /data-wd-loop-item="members"/);
});

// --- TASK-02: malformed @loop header reports file:line ---------------------

test("a malformed @loop header reports the directive's line as file:line", () => {
  const root = fixture();
  // No frontmatter, so the @loop opener is FILE line 3.
  write(
    root,
    "site/pages/index.wd",
    ["# Title", "", "@loop items", "- { item.x }", "@endloop"].join("\n")
  );
  assert.throws(
    () => compile(root),
    (err) => {
      assert.match(err.message, /Malformed @loop in .*index\.wd:3/);
      assert.match(err.message, /Use: @loop/);
      return true;
    }
  );
});

// --- TASK-03: include-resolution errors report file:line -------------------

test("an unresolvable @include reports the directive's line as file:line", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["# Title", "", "@include /nope.wd"].join("\n"));
  assert.throws(() => compile(root), /Could not resolve include "\/nope\.wd" from .*index\.wd:3/);
});

test("an @include escaping the sandbox reports the directive's line as file:line", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["# Title", "", "@include ../../secret.wd"].join("\n"));
  assert.throws(
    () => compile(root),
    /Include "\.\.\/\.\.\/secret\.wd" from .*index\.wd:3 resolves outside site\/pages or site\/_/
  );
});
