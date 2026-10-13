// F6 — shared page skins via the `skins:` frontmatter key.
// F12 — CSS emit order: include/base skins first, shared skins next, the
// page's own colocated skin LAST (the page always wins ties).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { resolveSharedSkins } from "../src/compiler/frontmatter.js";
import { fsReader } from "../src/compiler/fs-reader.js";
import { compileFromMemory, compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { scopeIdFor } from "../src/skin.js";

const ENTRY = "site/pages/index.wd";

// ---------------------------------------------------------------------------
// resolveSharedSkins — resolution rules + WD017 failures
// ---------------------------------------------------------------------------

function project(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-skins-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  const page = path.join(root, ENTRY);
  if (!fs.existsSync(page)) {
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, "# Hi\n");
  }
  return { root, page, context: createPaths(root), reader: fsReader() };
}

test("no skins key resolves to an empty list", () => {
  const { page, context, reader } = project();
  assert.deepEqual(resolveSharedSkins({}, page, context, reader), []);
});

test("a non-array skins value is a WD017", () => {
  const { page, context, reader } = project();
  assert.throws(
    () => resolveSharedSkins({ skins: "/base.skin" }, page, context, reader),
    (err) => err.wd.code === "WD017" && /inline array/.test(err.message)
  );
});

test("a non-string or blank entry is a WD017", () => {
  const { page, context, reader } = project({ "site/_/base.skin": "main\n  color red\n" });
  for (const skins of [[123], ["  "]]) {
    assert.throws(
      () => resolveSharedSkins({ skins }, page, context, reader),
      (err) => err.wd.code === "WD017" && /path string/.test(err.message)
    );
  }
});

test("a missing skin file is a WD017", () => {
  const { page, context, reader } = project();
  assert.throws(
    () => resolveSharedSkins({ skins: ["/nope.skin"] }, page, context, reader),
    (err) => err.wd.code === "WD017" && /does not exist/.test(err.message)
  );
});

test("an entry that is not a .skin file is a WD017", () => {
  const { page, context, reader } = project({ "site/_/base.css": "main { color: red; }" });
  assert.throws(
    () => resolveSharedSkins({ skins: ["/base.css"] }, page, context, reader),
    (err) => err.wd.code === "WD017" && /not a \.skin file/.test(err.message)
  );
});

test("an entry escaping the sandbox lexically is a WD017", () => {
  const { page, context, reader } = project();
  assert.throws(
    () => resolveSharedSkins({ skins: ["../outside.skin"] }, page, context, reader),
    (err) => err.wd.code === "WD017" && /outside site\/pages and site\/_/.test(err.message)
  );
});

test("a symlink escaping the sandbox is a WD017", () => {
  const { root, page, context, reader } = project({ "secret.skin": "main\n  color red\n" });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  fs.symlinkSync(path.join(root, "secret.skin"), path.join(root, "site/_/link.skin"));
  assert.throws(
    () => resolveSharedSkins({ skins: ["/link.skin"] }, page, context, reader),
    (err) => err.wd.code === "WD017" && /outside site\/pages and site\/_/.test(err.message)
  );
});

test("a leading slash resolves from the shelf first, then site/pages", () => {
  const { root, page, context, reader } = project({
    "site/_/base.skin": "main\n  color red\n",
    "site/pages/base.skin": "main\n  color blue\n",
    "site/pages/only-pages.skin": "main\n  color green\n"
  });
  assert.equal(
    resolveSharedSkins({ skins: ["/base.skin"] }, page, context, reader)[0],
    path.join(root, "site/_/base.skin")
  );
  assert.equal(
    resolveSharedSkins({ skins: ["/only-pages.skin"] }, page, context, reader)[0],
    path.join(root, "site/pages/only-pages.skin")
  );
});

test("a relative path resolves beside the page, then on the shelf", () => {
  const { root, page, context, reader } = project({
    "site/pages/local.skin": "main\n  color red\n",
    "site/_/shared.skin": "main\n  color blue\n"
  });
  assert.equal(
    resolveSharedSkins({ skins: ["local.skin"] }, page, context, reader)[0],
    path.join(root, "site/pages/local.skin")
  );
  assert.equal(
    resolveSharedSkins({ skins: ["shared.skin"] }, page, context, reader)[0],
    path.join(root, "site/_/shared.skin")
  );
});

// ---------------------------------------------------------------------------
// F6 — a page pulls shared skins through the normal skin pipeline
// ---------------------------------------------------------------------------

test("a shared skin is linked in the page head and tracked as a dependency", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: "---\nskins: [/base.skin]\n---\n# Hi\n",
      "site/_/base.skin": "main\n  color red\n"
    },
    ENTRY
  );
  assert.match(page.html, /<link rel="stylesheet" href="\/__wd\/styles\/site___base\.css">/);
  assert.equal(page.assets.runtime, false, "a skin adds no JavaScript");
  const source = [...page.assets.files.keys()].find((key) => key.endsWith("base.skin"));
  assert.ok(source, "the skin source is a registered asset");
  assert.ok(
    [...page.deps].some((dep) => dep.endsWith("base.skin")),
    "the skin is a build dep"
  );
});

test("shared skin tokens compile through the normal pipeline (buildSite emit)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-skins-build-"));
  const write = (rel, body) => {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  write(ENTRY, "---\nskins: [/base.skin]\n---\n# Hi\n");
  write("site/_/base.skin", ["tokens", "  ink #111", "", "main", "  color $ink"].join("\n"));
  buildSite(root);
  const css = fs.readFileSync(path.join(root, "dist/__wd/styles/site___base.css"), "utf8");
  assert.match(css, /--ink: #111/);
  assert.match(css, /main \{ color: var\(--ink\); \}/);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(html, /\/__wd\/styles\/site___base\.css/);
});

test("a .md page can list shared skins too", () => {
  const page = compileFromMemory(
    {
      "site/pages/index.md": "---\nskins: [/base.skin]\n---\n# Hi\n",
      "site/_/base.skin": "main\n  color red\n"
    },
    "site/pages/index.md"
  );
  assert.match(page.html, /\/__wd\/styles\/site___base\.css/);
});

// ---------------------------------------------------------------------------
// F12 — the cascade: include skins, then shared skins, then the page skin LAST
// ---------------------------------------------------------------------------

/** Stylesheet hrefs in a compiled page's head, in link order. */
function stylesheetOrder(html) {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
}

test("include skins come first, shared skins next, the page skin LAST", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: ["---", "skins: [/base.skin]", "---", "@include /nav.wd", "", "# Hi"].join("\n"),
      "site/_/nav.wd": "Navigation\n",
      "site/_/nav.skin": "nav\n  display flex\n",
      "site/_/base.skin": "main\n  color red\n",
      "site/pages/index.skin": "h1\n  color blue\n"
    },
    ENTRY
  );
  assert.deepEqual(stylesheetOrder(page.html), [
    "/__wd/styles/site___nav.css",
    "/__wd/styles/site___base.css",
    "/__wd/styles/site_pages_index.css"
  ]);
});

test("shared skins keep their listed order, ahead of the page skin", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: "---\nskins: [/one.skin, /two.skin]\n---\n# Hi\n",
      "site/_/one.skin": "a\n  color red\n",
      "site/_/two.skin": "b\n  color blue\n",
      "site/pages/index.skin": "c\n  color green\n"
    },
    ENTRY
  );
  assert.deepEqual(stylesheetOrder(page.html), [
    "/__wd/styles/site___one.css",
    "/__wd/styles/site___two.css",
    "/__wd/styles/site_pages_index.css"
  ]);
});

test("with no shared skins, include skins still precede the page skin", () => {
  // This pins the F12 contract change: before 2.8 the page's own skin was
  // emitted FIRST, so page-level overrides of design-system rules needed
  // higher specificity. The page now always wins ties on equal specificity.
  const page = compileFromMemory(
    {
      [ENTRY]: "@include /nav.wd\n\n# Hi\n",
      "site/_/nav.wd": "Navigation\n",
      "site/_/nav.skin": "nav\n  display flex\n",
      "site/pages/index.skin": "h1\n  color blue\n"
    },
    ENTRY
  );
  assert.deepEqual(stylesheetOrder(page.html), [
    "/__wd/styles/site___nav.css",
    "/__wd/styles/site_pages_index.css"
  ]);
});

test("a shared skin that is also the page's colocated skin stays LAST", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: ["---", "skins: [/base.skin, index.skin]", "---", "# Hi"].join("\n"),
      "site/_/base.skin": "a\n  color red\n",
      "site/pages/index.skin": "c\n  color green\n"
    },
    ENTRY
  );
  assert.deepEqual(stylesheetOrder(page.html), [
    "/__wd/styles/site___base.css",
    "/__wd/styles/site_pages_index.css"
  ]);
});

// ---------------------------------------------------------------------------
// F6 — scoping: a shared skin marked `scoped` scopes the page body
// ---------------------------------------------------------------------------

test("a scoped shared skin stamps the page body with its scope id", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: "---\nskins: [/base.skin]\n---\n# Hi\n",
      "site/_/base.skin": ["scoped", "h1", "  color red"].join("\n")
    },
    ENTRY
  );
  const scope = scopeIdFor("site/_/base.skin");
  assert.match(page.html, new RegExp(`<h1 id="hi" data-wd-scope="${scope}">`));
  const source = [...page.assets.scopedSkins].find((key) => key.endsWith("base.skin"));
  assert.ok(source, "the scoped shared skin is registered for scoped emit");
});

test("the page's own scoped skin wins over a scoped shared skin", () => {
  const page = compileFromMemory(
    {
      [ENTRY]: "---\nskins: [/base.skin]\n---\n# Hi\n",
      "site/_/base.skin": ["scoped", "h1", "  color red"].join("\n"),
      "site/pages/index.skin": ["scoped", "h1", "  color blue"].join("\n")
    },
    ENTRY
  );
  const pageScope = scopeIdFor("site/pages/index.skin");
  assert.match(page.html, new RegExp(`data-wd-scope="${pageScope}"`));
  assert.doesNotMatch(page.html, new RegExp(`data-wd-scope="${scopeIdFor("site/_/base.skin")}"`));
});

// ---------------------------------------------------------------------------
// F6 — compile errors surface through a full page compile
// ---------------------------------------------------------------------------

test("a bad skins entry fails the page compile with WD017", () => {
  assert.throws(
    () => compileFromMemory({ [ENTRY]: "---\nskins: [/nope.skin]\n---\n# Hi\n" }, ENTRY),
    (err) => err.wd.code === "WD017" && /nope\.skin/.test(err.message)
  );
});

test("skins resolve identically from disk (fs reader)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-skins-fs-"));
  const write = (rel, body) => {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  write(ENTRY, "---\nskins: [/base.skin]\n---\n# Hi\n");
  write("site/_/base.skin", "main\n  color red\n");
  const page = compilePage(path.join(root, ENTRY), createPaths(root));
  assert.match(page.html, /\/__wd\/styles\/site___base\.css/);
});
