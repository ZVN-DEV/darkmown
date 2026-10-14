// ---------------------------------------------------------------------------
// Shelf assets: what `site/_/` publishes to `/__wd/`.
//
// The docs promise "any non-.md/.wd file in site/_/ is served at
// /__wd/media/<path>", and pages rely on it (`<script src="/__wd/media/lib/helper.js">`).
// A `.skin`/`.js` COLOCATED with a `.wd`/`.md` of the same basename is different:
// it is a compiler input with its own emit path (/__wd/styles, /__wd/scripts), and
// publishing its source too shipped a stale, unreferenced duplicate. Wave 1 fixed
// the duplicate by skipping every .skin/.js, which silently 404'd the standalone
// ones the docs promise. Both halves are pinned here.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";

function write(root, file, content) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-shelf-assets-"));
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n\n# Home\n");
  // colocated include + its skin/js: compiler inputs, not media
  write(root, "site/_/card.wd", "::: card\nHello\n:::\n");
  write(root, "site/_/card.skin", ".card\n  color red\n");
  write(root, "site/_/card.js", "console.log('card');\n");
  // standalone shelf files: plain assets the docs promise under /__wd/media
  write(root, "site/_/lib/helper.js", "export const x = 1;\n");
  write(root, "site/_/standalone.skin", "tokens\n  brand red\n");
  write(root, "site/_/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>\n");
  write(root, "site/_/data.json", "[]\n");
  return root;
}

test("standalone shelf .js/.skin files are published to /__wd/media; colocated ones are not", () => {
  const root = project();
  buildSite(root);
  const media = path.join(root, "dist/__wd/media");
  assert.ok(fs.existsSync(path.join(media, "lib/helper.js")), "standalone .js is served");
  assert.ok(fs.existsSync(path.join(media, "standalone.skin")), "standalone .skin is served");
  assert.ok(fs.existsSync(path.join(media, "logo.svg")), "media is served");
  assert.ok(fs.existsSync(path.join(root, "dist/__wd/data/data.json")), "json goes to /__wd/data");
  assert.ok(!fs.existsSync(path.join(media, "card.skin")), "colocated .skin has its own emit path");
  assert.ok(!fs.existsSync(path.join(media, "card.js")), "colocated .js has its own emit path");
  assert.ok(!fs.existsSync(path.join(media, "card.wd")), "include sources are never published");
});

test("a .skin beside a .md include is colocated too", () => {
  const root = project();
  write(root, "site/_/note.md", "# Note\n");
  write(root, "site/_/note.skin", ".note\n  color blue\n");
  buildSite(root);
  assert.ok(!fs.existsSync(path.join(root, "dist/__wd/media/note.skin")));
});

// ---------------------------------------------------------------------------
// Publish boundary: the shelf mirrors the page-asset rules (emitPageAssets) —
// a hidden (`.`, `-`, `_`) path segment is private framework input, and a
// symlink is never followed. Before this, `site/_/.env.backup` and a symlink
// pointing anywhere on the disk both published their bytes to /__wd/media/.
// ---------------------------------------------------------------------------

// Creating a symlink needs Developer Mode or elevation on Windows, so the
// symlink tests skip where the OS refuses rather than failing the suite.
const noSymlinks = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "wd-symlink-probe-"));
  try {
    fs.symlinkSync(path.join(probe, "target"), path.join(probe, "link"));
    return false;
  } catch {
    return "symlinks are not creatable on this platform";
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

/** Run `fn` with console.warn swallowed; returns its return value. */
function quiet(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
}

test("hidden shelf files (.env.backup, -draft/, _private/) are never published", () => {
  const root = project();
  write(root, "site/_/.env.backup", "SECRET_KEY=1\n");
  write(root, "site/_/-draft/notes.txt", "draft\n");
  write(root, "site/_/_private/internal.svg", "<svg/>\n");
  buildSite(root);
  const media = path.join(root, "dist/__wd/media");
  assert.ok(!fs.existsSync(path.join(media, ".env.backup")), "dotfile is private");
  assert.ok(!fs.existsSync(path.join(media, "-draft/notes.txt")), "dash segment is private");
  assert.ok(
    !fs.existsSync(path.join(media, "_private/internal.svg")),
    "underscore segment is private"
  );
  // The public shelf files still publish.
  assert.ok(fs.existsSync(path.join(media, "logo.svg")));
});

test("a symlinked shelf asset does not publish its target's bytes", { skip: noSymlinks }, () => {
  const root = project();
  write(root, "outside-secret.txt", "TOP SECRET\n");
  fs.symlinkSync(path.join(root, "outside-secret.txt"), path.join(root, "site/_/leaked.txt"));
  buildSite(root);
  const out = path.join(root, "dist/__wd/media/leaked.txt");
  assert.ok(!fs.existsSync(out), "the symlink is skipped, its target never copied");
});

test("incremental builds never re-copy a symlinked or hidden shelf asset", {
  skip: noSymlinks
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-shelf-assets-incremental-"));
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n\n# Home\n");
  // A shelf JSON symlinked to an in-shelf target is a legitimate @loop source
  // (the include sandbox allows in-sandbox symlinks), so it lands in the dep
  // map and reaches copyChangedAsset on change — the publish side must still
  // refuse it, exactly like the full build's sweep.
  write(root, "site/_/real.json", JSON.stringify([{ name: "ok" }]));
  fs.symlinkSync(path.join(root, "site/_/real.json"), path.join(root, "site/_/linked.json"));
  write(root, "site/pages/linked.wd", "@loop /linked.json into row\n- { row.name }\n@endloop\n");
  // A hidden shelf path is readable as a loop source but never published.
  write(root, "site/_/-hidden/data.json", JSON.stringify([{ name: "hidden" }]));
  write(
    root,
    "site/pages/hidden.wd",
    "@loop /-hidden/data.json into row\n- { row.name }\n@endloop\n"
  );

  quiet(() => buildSite(root, { depMap: true }));
  assert.ok(
    !fs.existsSync(path.join(root, "dist/__wd/data/linked.json")),
    "full build skips the symlink"
  );
  assert.ok(
    !fs.existsSync(path.join(root, "dist/__wd/data/-hidden/data.json")),
    "full build skips hidden paths"
  );

  for (const changed of ["site/_/linked.json", "site/_/-hidden/data.json"]) {
    const result = quiet(() => buildSite(root, { changed: [changed] }));
    assert.ok(result.incremental, `${changed} stays on the incremental path (it is a known dep)`);
  }
  assert.ok(
    !fs.existsSync(path.join(root, "dist/__wd/data/linked.json")),
    "incremental re-copy refused the symlink"
  );
  assert.ok(
    !fs.existsSync(path.join(root, "dist/__wd/data/-hidden/data.json")),
    "incremental re-copy refused the hidden path"
  );
});
