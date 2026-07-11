// ---------------------------------------------------------------------------
// Dogfood: the repo's OWN demo site must build — including with --drafts, the
// staging path a plain `npm run build` never exercises (a draft-only compile
// error, e.g. a loop over an optional field only a draft omits, hid here once).
// The site is copied to a temp dir so the repo's real dist/ is never touched.
// Plus a head well-formedness sweep over every built page: no `<link` or
// `<script` markup may ever appear INSIDE an attribute value (the class of bug
// a double-wrapped stylesheet link produces).
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../src/builder.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Copy the repo's site/ into a fresh temp project root. */
function siteCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-dogfood-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.cpSync(path.join(repoRoot, "site"), path.join(root, "site"), { recursive: true });
  return root;
}

/** Every .html file under a directory, recursively. */
function htmlFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".html"))
    .map((rel) => path.join(dir, rel));
}

test("the repo's own site builds with --drafts (staging) and includes the draft", () => {
  const root = siteCopy();
  const result = buildSite(root, { includeDrafts: true });
  assert.ok(result.routes.length > 0, "the demo site produced routes");
  assert.ok(
    result.routes.some((route) => route.route === "/blog/unfinished-thoughts/"),
    "the draft blog post is part of a --drafts build"
  );
  assert.ok(fs.existsSync(path.join(root, "dist/blog/unfinished-thoughts/index.html")));
});

test("the docs table of contents is honest: every #fragment link targets a real heading id, statically", () => {
  const root = siteCopy();
  const result = buildSite(root, { includeDrafts: true });
  const html = fs.readFileSync(path.join(root, "dist/docs/index.html"), "utf8");

  const fragments = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const tocLinks = fragments.filter((id) => id !== "main"); // "main" is the shell's skip link
  assert.ok(
    tocLinks.length >= 20,
    `the docs TOC lists the page's sections (saw ${tocLinks.length})`
  );

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const id of tocLinks) {
    assert.ok(ids.has(id), `docs TOC links to #${id} but no element carries id="${id}"`);
  }

  const docs = result.routes.find((route) => route.route === "/docs/");
  assert.equal(docs?.assets.runtime, false, "the docs page (TOC included) stays static");
});

test("every built page's markup is well-formed: no <link>/<script> inside an attribute value", () => {
  const root = siteCopy();
  buildSite(root, { includeDrafts: true });
  const pages = htmlFiles(path.join(root, "dist"));
  assert.ok(pages.length > 0, "the build emitted HTML pages");
  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    // An attribute value opens with `="` — tag markup before its closing quote
    // means a tag was serialized into another tag's attribute.
    const mangled = html.match(/="[^"]*<(?:link|script)/);
    assert.equal(
      mangled,
      null,
      `${path.relative(root, file)} has tag markup inside an attribute value: ${mangled?.[0]}`
    );
  }
});
