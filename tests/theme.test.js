// Compile-level tests for the manual theme toggle: `:theme` declares a durable
// store and a reflect marker; the skin's `tokens dark` powers OS-auto + override.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-theme-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  return compileDocument(pageFile, createPaths(root));
}

test(":theme declares a durable store seeded auto and a reflect marker", () => {
  const doc = compile(`:theme\n\n:button "Dark" -> theme = "dark"`);
  assert.equal(doc.assets.runtime, true);
  assert.match(doc.html, /<script type="application\/json" data-wd-store="theme">"auto"<\/script>/);
  assert.match(doc.html, /<span data-wd-theme="theme" hidden><\/span>/);
  // not ephemeral — the choice persists across reloads
  assert.doesNotMatch(doc.html, /data-wd-store-ephemeral/);
});

test(":theme accepts a custom name and seed", () => {
  const doc = compile(`:theme mode = "dark"`);
  assert.match(doc.html, /data-wd-store="mode">"dark"<\/script>/);
  assert.match(doc.html, /data-wd-theme="mode"/);
});

test(":theme store participates in collision checks like any :store", () => {
  assert.throws(() => compile(`:theme\n:store theme = "x"`), /collides|declared twice/i);
});

test("buttons drive the theme store with the normal action vocabulary", () => {
  const doc = compile(
    `:theme\n\n:button "Light" -> theme = "light"\n:button "Auto" -> theme = "auto"`
  );
  assert.match(doc.html, /data-wd-action="set" data-wd-target="theme"[^>]*>Light/);
});

test(":theme with leftover tokens is a compile error", () => {
  assert.throws(() => compile(`:theme one two`), /Malformed :theme/);
});
