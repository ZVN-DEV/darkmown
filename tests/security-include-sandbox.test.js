// ---------------------------------------------------------------------------
// WD601 — the include sandbox. Includes resolve ONLY inside `site/pages` and
// `site/_` (CLAUDE.md invariant).
//
// Before this file, `WD601` appeared in `src/errors.js` and `docs/errors.md` and
// in zero tests. That mattered twice over:
//
//   * Weakening the boundary from `startsWith(root + sep)` to a bare
//     `startsWith(root)` left the suite green — and a sibling directory that
//     merely shares the prefix (`site/pages-secret/`) then leaked into the page.
//   * The check was LEXICAL only. A symlink sitting inside `site/pages` and
//     pointing anywhere on the disk passed it, and its target's bytes were
//     compiled into the built page. Verified on a real filesystem, not a mock:
//     the symlink is created with `fs.symlinkSync`.
//
// The behavioral table below is the contract: what is inside, what is outside,
// and by which of the two checks.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

const SECRET = "SECRET CONTENT LEAKED";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-sandbox-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** A project with a secret file OUTSIDE the sandbox and a sibling-prefix dir. */
function project() {
  const root = fixture();
  write(root, "secret/secret.md", `${SECRET}\n`);
  write(root, "site/pages-secret/s.md", `${SECRET}\n`);
  write(root, "site/_/nav.wd", "# Nav\n");
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  return root;
}

// Creating a symlink needs Developer Mode or elevation on Windows, so the
// symlink half of the table is skipped where the OS refuses rather than failing
// the matrix. The lexical half still runs everywhere.
const noSymlinks = (() => {
  const probe = fixture();
  try {
    fs.symlinkSync(path.join(probe, "target"), path.join(probe, "link"));
    return false;
  } catch {
    return "symlinks are not creatable on this platform";
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

function compileIndex(root, body) {
  write(root, "site/pages/index.wd", body);
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

/** Assert the include is refused with WD601 and nothing leaked. */
function assertRefused(root, body, label) {
  let err;
  try {
    compileIndex(root, body);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: expected the include to be refused, it compiled`);
  assert.match(err.message, /^\[WD601\] /, `${label}: expected WD601, got ${err.message}`);
  assert.match(err.message, /resolves outside site\/pages or site\/_/, label);
  assert.equal(err.wd.code, "WD601");
}

// ---------------------------------------------------------------------------
// Outside the sandbox — refused
// ---------------------------------------------------------------------------

test("WD601: a `../` traversal out of site/pages is refused (lexical)", () => {
  const root = project();
  try {
    assertRefused(root, "@include ../../secret/secret.md\n", "traversal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WD601: a SIBLING-PREFIX directory is refused — site/pages-secret is not site/pages", () => {
  // The `path.sep` boundary is the whole check here. A bare `startsWith(root)`
  // accepts `…/site/pages-secret/s.md` because it starts with `…/site/pages`.
  const root = project();
  try {
    assertRefused(root, "@include ../pages-secret/s.md\n", "sibling prefix");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WD601: a SYMLINK inside site/pages pointing outside is refused (canonical)", {
  skip: noSymlinks
}, () => {
  const root = project();
  try {
    fs.symlinkSync("../../secret/secret.md", path.join(root, "site/pages/leak.md"));
    assertRefused(root, "@include ./leak.md\n", "symlink escape");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WD601: a symlinked DIRECTORY inside site/_ pointing outside is refused", {
  skip: noSymlinks
}, () => {
  const root = project();
  try {
    fs.symlinkSync(path.join(root, "secret"), path.join(root, "site/_/vendor"));
    assertRefused(root, "@include /vendor/secret.md\n", "symlinked directory");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("WD601: a symlinked @loop DATA file pointing outside is refused too", {
  skip: noSymlinks
}, () => {
  // `@loop` resolves its JSON source through the same gate, so the sandbox
  // covers data as well as pages.
  const root = project();
  try {
    write(root, "secret/data.json", JSON.stringify([{ name: SECRET }]));
    fs.symlinkSync(path.join(root, "secret/data.json"), path.join(root, "site/_/data.json"));
    assertRefused(root, "@loop /data.json into r\n{ r.name }\n@endloop\n", "symlinked data");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("no refused include ever leaks a byte of its target into the built page", {
  skip: noSymlinks
}, () => {
  // The property that actually matters, asserted over output rather than errors.
  const root = project();
  try {
    fs.symlinkSync("../../secret/secret.md", path.join(root, "site/pages/leak.md"));
    for (const body of ["@include ./leak.md\n", "@include ../pages-secret/s.md\n"]) {
      let html = "";
      try {
        html = compileIndex(root, body).html;
      } catch {
        // refused, as required
      }
      assert.doesNotMatch(html, new RegExp(SECRET), `leaked through: ${body.trim()}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Inside the sandbox — allowed (the controls that stop the guard over-reaching)
// ---------------------------------------------------------------------------

test("an ordinary shelf include still resolves", () => {
  const root = project();
  try {
    const page = compileIndex(root, "@include /nav.wd\n");
    assert.match(page.html, /Nav/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a project whose ROOT is itself reached through a symlink still compiles", {
  skip: noSymlinks
}, () => {
  // The canonical check must realpath BOTH sides. Realpathing only the file
  // rejects every legitimate include on a machine where the project sits under a
  // symlinked parent — which is the normal case on macOS (`/tmp` → `/private/tmp`).
  const parent = fixture();
  const real = path.join(parent, "real");
  const link = path.join(parent, "link");
  try {
    fs.mkdirSync(real, { recursive: true });
    write(real, "site/_/nav.wd", "# Nav\n");
    write(real, "site/pages/index.wd", "@include /nav.wd\n");
    fs.symlinkSync(real, link);
    const page = compilePage(path.join(link, "site/pages/index.wd"), createPaths(link));
    assert.match(page.html, /Nav/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a symlink INSIDE the sandbox pointing at another sandbox file is allowed", {
  skip: noSymlinks
}, () => {
  // The rule is containment, not "no symlinks": a link that stays inside
  // `site/_` is ordinary project structure.
  const root = project();
  try {
    write(root, "site/_/real-nav.wd", "# Real Nav\n");
    fs.symlinkSync(path.join(root, "site/_/real-nav.wd"), path.join(root, "site/_/alias.wd"));
    const page = compileIndex(root, "@include /alias.wd\n");
    assert.match(page.html, /Real Nav/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing include is still WD602 (not found), not WD601 (out of sandbox)", () => {
  // The canonical check runs only after the file exists, so a typo keeps its own
  // error and its own fix.
  const root = project();
  try {
    assert.throws(() => compileIndex(root, "@include /nope.wd\n"), /WD602/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a project with NO site/_ directory still resolves a page-relative include", () => {
  // The canonical check maps `realpath` over BOTH roots, and `site/_` is
  // optional. A root that cannot be canonicalized has to fall back to the path
  // as written rather than failing the whole containment test.
  const root = fixture();
  try {
    write(root, "site/pages/partial.md", "# Partial\n");
    const page = compileIndex(root, "@include ./partial.md\n");
    assert.match(page.html, /Partial/);
    assert.equal(fs.existsSync(path.join(root, "site/_")), false, "no shelf in this project");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
