// `darkmown validate` — the CLI wiring of the tools-surface validator.
//
// In-process coverage follows the cli-coverage.test.js pattern: run(argv, env)
// with an injectable { cwd, log, error } against a temp fixture project, plus
// two subprocess tests proving the real exit codes (0 clean, 1 on errors) the
// binary maps from CliError.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CliError, helpText, run } from "../src/cli.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function freshDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `darkmown-validate-${label}-`));
}

// A capturing IO env: collects everything written to log/warn/error.
function capture(cwd) {
  const out = { log: [], warn: [], error: [] };
  return {
    env: {
      cwd,
      log: (...a) => out.log.push(a.join(" ")),
      warn: (...a) => out.warn.push(a.join(" ")),
      error: (...a) => out.error.push(a.join(" "))
    },
    out,
    stdout: () => out.log.join("\n"),
    stderr: () => out.error.join("\n")
  };
}

/** Write a fixture project: a map of project-relative path → contents. */
function writeProject(root, files) {
  for (const [file, contents] of Object.entries(files)) {
    const abs = path.join(root, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
}

const CLEAN_HOME = `---
title: Home
---

# Home

:state count = 0

:button "Go" -> count++
`;

const BROKEN_STATE = `---
title: Broken
---

:state
`;

test("help lists the validate command", () => {
  assert.match(helpText(), /darkmown validate \[path\]/);
});

test("validate passes a clean project and reports each page", async () => {
  const root = freshDir("clean");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/about.md": "---\ntitle: About\n---\n\n# About\n",
    // Not compiler-readable: the source map must skip it without failing.
    "site/pages/notes.txt": "scratch\n"
  });
  const { env, stdout, stderr } = capture(root);
  const result = await run(["validate"], env);

  assert.equal(result.command, "validate");
  assert.match(stdout(), /✓ site\/pages\/index\.wd — compiles\. reactive \(ships the runtime\)/);
  assert.match(stdout(), /✓ site\/pages\/about\.md — compiles\. static \(ships zero JavaScript\)/);
  assert.match(stdout(), /✓ 2 pages validated$/m);
  assert.equal(stderr(), "");
});

test("validate prints warnings in the headline with a bullet each", async () => {
  const root = freshDir("warnings");
  writeProject(root, {
    // `:State` matches no directive: a warning, not an error.
    "site/pages/index.wd": "---\ntitle: Home\n---\n\n:State count = 0\n"
  });
  const { env, stdout } = capture(root);
  await run(["validate"], env);

  assert.match(stdout(), /compiles with 1 warning\./);
  assert.match(stdout(), /- .*":State" looks like a directive but matches none/);
  assert.match(stdout(), /✓ 1 page validated, 1 warning$/m);
});

test("validate fails a broken page with its WD code and fails the run", async () => {
  const root = freshDir("broken");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/broken.wd": BROKEN_STATE
  });
  const { env, stdout, stderr } = capture(root);
  const failure = await run(["validate"], env).then(
    () => null,
    (err) => err
  );

  assert.ok(failure instanceof CliError, "a validation failure throws CliError");
  assert.equal(failure.silent, true, "the details were already printed");
  assert.match(stdout(), /✓ site\/pages\/index\.wd/);
  assert.match(stderr(), /✗ site\/pages\/broken\.wd — WD201 at broken\.wd:5/);
  assert.match(stderr(), /use: :state name = value/);
  assert.match(stderr(), /✗ 1 of 2 pages failed validation/);
});

test("validate resolves a collection loop the way the build does", async () => {
  const root = freshDir("collections");
  writeProject(root, {
    "site/pages/blog/post.md": "---\ntitle: Post\ndate: 2026-10-01\n---\n\nHello.\n",
    "site/pages/index.wd": `---
title: Home
---

@loop blog into post
- [{ post.title }]({ post.url })
@endloop
`
  });
  const { env, stdout } = capture(root);
  await run(["validate"], env);
  assert.match(stdout(), /✓ 2 pages validated$/m);
});

test("validate fails on a collection schema violation before checking pages", async () => {
  const root = freshDir("schema");
  writeProject(root, {
    "site/pages/blog/_schema.wd": "---\ntitle: string\ndate: date\n---\n",
    "site/pages/blog/post.md": "---\ntitle: Post\n---\n\nNo date here.\n",
    "site/pages/index.wd": CLEAN_HOME
  });
  const { env, stderr } = capture(root);
  const failure = await run(["validate"], env).then(
    () => null,
    (err) => err
  );

  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /✗ \[WD123\]/);
  assert.match(stderr(), /Missing required field "date"/);
});

test("validate resolves includes from the shelf", async () => {
  const root = freshDir("includes");
  writeProject(root, {
    "site/_/nav.wd": "[Home](/)\n",
    "site/pages/index.wd": "---\ntitle: Home\nhtml: true\n---\n\n@include /nav.wd\n\n# Home\n",
    "site/pages/index.skin": "page\n  color #222\n"
  });
  const { env, stdout } = capture(root);
  await run(["validate"], env);
  assert.match(stdout(), /✓ 1 page validated$/m);
});

test("validate checks draft pages too", async () => {
  const root = freshDir("drafts");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/wip.wd": `---
title: WIP
draft: true
---

:state
`
  });
  const { env, stderr } = capture(root);
  const failure = await run(["validate"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError, "a broken draft fails validation");
  assert.match(stderr(), /✗ site\/pages\/wip\.wd — WD201/);
});

test("validate accepts a single-file argument", async () => {
  const root = freshDir("single");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/broken.wd": BROKEN_STATE
  });

  const clean = capture(root);
  await run(["validate", "site/pages/index.wd"], clean.env);
  assert.match(clean.stdout(), /✓ 1 page validated$/m);

  const broken = capture(root);
  const failure = await run(["validate", "site/pages/broken.wd"], broken.env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(broken.stderr(), /✗ 1 of 1 page failed validation/);
});

test("validate accepts a directory argument and checks only that subtree", async () => {
  const root = freshDir("directory");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/broken.wd": BROKEN_STATE,
    "site/pages/blog/post.md": "---\ntitle: Post\n---\n\nHello.\n"
  });
  const { env, stdout, stderr } = capture(root);
  await run(["validate", "site/pages/blog"], env);
  assert.match(stdout(), /✓ site\/pages\/blog\/post\.md/);
  assert.match(stdout(), /✓ 1 page validated$/m);
  assert.equal(stderr(), "");
});

test("validate reports a project with no site/pages", async () => {
  const root = freshDir("empty");
  const { env, stderr } = capture(root);
  const failure = await run(["validate"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /No site\/pages directory found/);
});

test("validate reports a missing target path", async () => {
  const root = freshDir("missing");
  writeProject(root, { "site/pages/index.wd": CLEAN_HOME });
  const { env, stderr } = capture(root);
  const failure = await run(["validate", "nope.wd"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /Nothing to validate at "nope\.wd"/);
});

test("validate reports a directory with no pages in it", async () => {
  const root = freshDir("nopages");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "assets/readme.txt": "not a page\n"
  });
  const { env, stderr } = capture(root);
  const failure = await run(["validate", "assets"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /No pages found under "assets"/);
});

test("validate refuses a non-page file argument", async () => {
  const root = freshDir("nonpage");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "site/pages/logo.svg": "<svg></svg>\n"
  });
  const { env, stderr } = capture(root);
  const failure = await run(["validate", "site/pages/logo.svg"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /only \.md and \.wd sources compile/);
});

test("validate refuses a page file outside site/", async () => {
  const root = freshDir("outside");
  writeProject(root, {
    "site/pages/index.wd": CLEAN_HOME,
    "notes.md": "# Notes\n"
  });
  const { env, stderr } = capture(root);
  const failure = await run(["validate", "notes.md"], env).then(
    () => null,
    (err) => err
  );
  assert.ok(failure instanceof CliError);
  assert.match(stderr(), /validate checks pages and includes under site\//);
});

test("binary exits 0 on a clean project and 1 on a broken one, with no stack trace", () => {
  const clean = freshDir("bin-clean");
  writeProject(clean, { "site/pages/index.wd": CLEAN_HOME });
  const okOutput = execFileSync("node", [cliPath, "validate"], { cwd: clean, encoding: "utf8" });
  assert.match(okOutput, /✓ 1 page validated/);

  const broken = freshDir("bin-broken");
  writeProject(broken, { "site/pages/broken.wd": BROKEN_STATE });
  let failed = false;
  try {
    execFileSync("node", [cliPath, "validate"], { cwd: broken, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    failed = true;
    assert.equal(error.status, 1, "validate must exit non-zero on a compile error");
    const stderr = String(error.stderr);
    assert.match(stderr, /^✗ /m, "error output must be prefixed with ✗");
    assert.match(stderr, /WD201/, "error output must carry the WD code");
    assert.doesNotMatch(stderr, /\n\s+at \w/, "must not print a Node stack trace");
  }
  assert.equal(failed, true, "validate was expected to fail on the broken page");
});
