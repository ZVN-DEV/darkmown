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
