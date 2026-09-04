// Dependency-tracked incremental dev rebuilds (src/builder.js).
//
// A dev build (`depMap: true`) records, per source route, every file its
// compile read — the page itself, `@include` targets, colocated `.skin`/`.js`
// assets, `@loop` JSON data files — plus the collections it looped, into
// `dist/.wd-dev-deps.json`. A later `changed:` build rebuilds only the routes
// whose dependency graph contains the changed file(s), while `routes.json`,
// `_headers`, robots/sitemap/rss are re-emitted globally so a partial rebuild
// can never leave them inconsistent.
//
// Headline contract: correctness first. ANY uncertainty — no/stale/corrupt dep
// map, a route added/removed/renamed, a deleted file, a file no dependency
// graph accounts for, a change to the site-wide feed link — falls back to a
// full rebuild (asserted here via the untouched-output sentinel going away).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, DEP_MAP_FILE } from "../src/builder.js";

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

/**
 * A site exercising every dependency kind: an include shared by two pages, a
 * page-colocated skin, a `blog` collection (schema'd, dated → rss) with a
 * listing, a paginated `news` collection, shelf + colocated + hidden JSON loop
 * data, an unrelated plain page (the untouched sentinel), and a 404 route.
 */
function site() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-incremental-"));
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\ndescription: A test site\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  write(root, "site/_/nav.wd", "[Home](/) · original nav\n");
  write(root, "site/pages/about.wd", "---\ntitle: About\n---\n@include /nav.wd\n\n# About\n");
  write(root, "site/pages/about.skin", "page\n  color #111\n");
  write(root, "site/pages/contact.wd", "---\ntitle: Contact\n---\n@include /nav.wd\n\n# Contact\n");
  write(root, "site/pages/plain.md", "---\ntitle: Plain\n---\n\nUnrelated sentinel page.\n");
  write(root, "site/pages/404.wd", "---\ntitle: Missing\n---\n\n# Original not-found copy\n");
  write(root, "site/pages/blog/_schema.wd", "---\ntitle: string\ndate: date\n---\n");
  write(
    root,
    "site/pages/blog/index.wd",
    "---\ntitle: Blog\n---\n@loop blog into post sort by post.date desc\n- { post.title }\n@endloop\n"
  );
  write(
    root,
    "site/pages/blog/hello.md",
    "---\ntitle: Hello\ndate: 2026-01-01\n---\n\nFirst post body.\n"
  );
  write(
    root,
    "site/pages/blog/world.md",
    "---\ntitle: World\ndate: 2026-01-02\n---\n\nSecond post body.\n"
  );
  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\n---\n@loop news into n sort by n.title paginate 1\n- { n.title }\n@endloop\n"
  );
  write(root, "site/pages/news/a.md", "---\ntitle: Alpha\n---\n\nA.\n");
  write(root, "site/pages/news/b.md", "---\ntitle: Beta\n---\n\nB.\n");
  write(root, "site/_/data.json", JSON.stringify([{ name: "shelf-original" }]));
  write(
    root,
    "site/pages/data-page.wd",
    "---\ntitle: Data\n---\n@loop /data.json into row\n- { row.name }\n@endloop\n"
  );
  write(root, "site/pages/rows.json", JSON.stringify([{ name: "colocated-original" }]));
  write(
    root,
    "site/pages/rows.wd",
    "---\ntitle: Rows\n---\n@loop ./rows.json into row\n- { row.name }\n@endloop\n"
  );
  write(root, "site/pages/_rows/data.json", JSON.stringify([{ name: "hidden-original" }]));
  write(
    root,
    "site/pages/hidden-data.wd",
    "---\ntitle: Hidden Data\n---\n@loop _rows/data.json into row\n- { row.name }\n@endloop\n"
  );
  return root;
}

/** Run `fn` with console.warn captured; returns { result, warns }. */
function withWarns(fn) {
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    return { result: fn(), warns };
  } finally {
    console.warn = original;
  }
}

/** Full dev build (writes the dep map), warnings swallowed. */
function devBuild(root) {
  return withWarns(() => buildSite(root, { depMap: true })).result;
}

/** Incremental dev build for `changed` project-relative paths. */
function changedBuild(root, changed, options = {}) {
  return withWarns(() => buildSite(root, { ...options, changed }));
}

/** Plant a sentinel over an untouched route's output; returns an "is it still
 * there" probe. Gone = the route was rewritten (i.e. a full rebuild ran). */
function sentinel(root, file = "dist/plain/index.html") {
  const marker = "<!-- sentinel: untouched -->";
  fs.writeFileSync(path.join(root, file), marker);
  return () => read(root, file) === marker;
}

function depMap(root) {
  return JSON.parse(read(root, path.join("dist", DEP_MAP_FILE)));
}

// ---------------------------------------------------------------------------
// Dependency-map construction
// ---------------------------------------------------------------------------

test("a dev build records per-route deps: page, include, colocated skin, loop data, collections", () => {
  const root = site();
  devBuild(root);
  const map = depMap(root);
  assert.equal(map.version, 2);
  assert.deepEqual(map.feed, { href: "https://example.com/rss.xml", title: "Home" });
  // The whole-site inputs no per-route dependency graph can see: the origin
  // every canonical URL is built from, and every route's title (which the
  // DESCENDANTS' breadcrumbs name).
  assert.equal(map.site.url, "https://example.com");
  assert.equal(map.site.titles["/blog/"], "Blog");
  assert.equal(map.site.titles["/blog/hello/"], "Hello");

  const about = map.routes["/about/"];
  assert.equal(about.file, "site/pages/about.wd");
  assert.ok(about.deps.includes("site/pages/about.wd"), "the route's own file is a dep");
  assert.ok(about.deps.includes("site/_/nav.wd"), "the resolved include is a dep");
  assert.ok(about.deps.includes("site/pages/about.skin"), "the colocated skin is a dep");

  assert.ok(map.routes["/contact/"].deps.includes("site/_/nav.wd"), "include fan-out is recorded");
  assert.ok(!map.routes["/plain/"].deps.includes("site/_/nav.wd"));

  assert.deepEqual(map.routes["/blog/"].collections, ["blog"], "the looped collection is recorded");
  assert.deepEqual(map.routes["/about/"].collections, []);
  assert.ok(
    map.routes["/data-page/"].deps.includes("site/_/data.json"),
    "shelf loop data is a dep"
  );
  assert.ok(
    map.routes["/rows/"].deps.includes("site/pages/rows.json"),
    "colocated loop data is a dep"
  );

  // A paginated route records every emitted page, so global files can be
  // reassembled without recompiling it.
  assert.deepEqual(
    map.routes["/news/"].pages.map((page) => page.route),
    ["/news/", "/news/page/2/"]
  );
});

test("a production build (no depMap) writes no dependency map into dist", () => {
  const root = site();
  withWarns(() => buildSite(root));
  assert.ok(!fs.existsSync(path.join(root, "dist", DEP_MAP_FILE)));
});

// ---------------------------------------------------------------------------
// Incremental rebuild correctness
// ---------------------------------------------------------------------------

test("changing an include rebuilds exactly the routes whose include graph contains it", () => {
  const root = site();
  devBuild(root);
  const untouched = sentinel(root);

  write(root, "site/_/nav.wd", "[Home](/) · UPDATED nav\n");
  const { result } = changedBuild(root, ["site/_/nav.wd"]);

  assert.deepEqual(result.incremental.rebuilt, ["/about/", "/contact/"]);
  assert.match(read(root, "dist/about/index.html"), /UPDATED nav/);
  assert.match(read(root, "dist/contact/index.html"), /UPDATED nav/);
  assert.ok(untouched(), "an unrelated route's output is not rewritten");

  // Global outputs stay whole-site consistent after the partial rebuild.
  const manifest = JSON.parse(read(root, "dist/routes.json"));
  assert.equal(manifest.length, result.routes.length);
  assert.ok(manifest.some((entry) => entry.route === "/plain/"));
  assert.ok(manifest.some((entry) => entry.route === "/news/page/2/"));
  for (const entry of manifest) assert.equal(entry.assets.runtime, false);
  const sitemap = read(root, "dist/sitemap.xml");
  assert.match(sitemap, /https:\/\/example\.com\/plain\//);
  assert.match(sitemap, /https:\/\/example\.com\/news\/page\/2\//);
});

test("changing a collection entry rebuilds the entry, its listing, and refreshes rss", () => {
  const root = site();
  devBuild(root);
  const untouched = sentinel(root);

  write(
    root,
    "site/pages/blog/hello.md",
    "---\ntitle: Hello Renamed\ndate: 2026-01-01\n---\n\nFirst post body.\n"
  );
  const { result } = changedBuild(root, ["site/pages/blog/hello.md"]);

  assert.deepEqual(result.incremental.rebuilt, ["/blog/", "/blog/hello/"]);
  assert.match(read(root, "dist/blog/index.html"), /Hello Renamed/);
  assert.match(read(root, "dist/blog/hello/index.html"), /Hello Renamed/);
  assert.match(read(root, "dist/rss.xml"), /Hello Renamed/, "rss is regenerated globally");
  assert.ok(untouched());
});

test("changing a collection's _schema.wd rebuilds the collection's consumers (and re-validates)", () => {
  const root = site();
  devBuild(root);

  write(
    root,
    "site/pages/blog/_schema.wd",
    "---\ntitle: string\ndate: date\ntags: string[]?\n---\n"
  );
  const { result } = changedBuild(root, ["site/pages/blog/_schema.wd"]);
  assert.deepEqual(result.incremental.rebuilt, ["/blog/"]);

  // A schema the entries now violate fails the incremental build loudly (the
  // validation runs fresh every time), never a silent stale page.
  write(
    root,
    "site/pages/blog/_schema.wd",
    "---\ntitle: string\ndate: date\nauthor: string\n---\n"
  );
  assert.throws(
    () => changedBuild(root, ["site/pages/blog/_schema.wd"]),
    /Missing required field "author"/
  );
});

test("multiple changed files rebuild the union of their affected routes", () => {
  const root = site();
  devBuild(root);

  write(root, "site/_/nav.wd", "[Home](/) · batch nav\n");
  write(root, "site/pages/plain.md", "---\ntitle: Plain\n---\n\nEdited sentinel page.\n");
  const { result } = changedBuild(root, ["site/_/nav.wd", "site/pages/plain.md"]);
  assert.deepEqual(result.incremental.rebuilt, ["/about/", "/contact/", "/plain/"]);
});

test("a shrunk pagination removes stale page outputs from dist, routes.json, and the sitemap", () => {
  const root = site();
  devBuild(root);
  assert.ok(fs.existsSync(path.join(root, "dist/news/page/2/index.html")));

  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\n---\n@loop news into n sort by n.title paginate 10\n- { n.title }\n@endloop\n"
  );
  const { result } = changedBuild(root, ["site/pages/news/index.wd"]);

  assert.deepEqual(result.incremental.rebuilt, ["/news/"]);
  assert.ok(!fs.existsSync(path.join(root, "dist/news/page/2/index.html")), "stale page removed");
  const manifest = JSON.parse(read(root, "dist/routes.json"));
  assert.ok(!manifest.some((entry) => entry.route === "/news/page/2/"));
  assert.doesNotMatch(read(root, "dist/sitemap.xml"), /\/news\/page\/2\//);
});

test("a shelf JSON data change rebuilds its loops and refreshes the published /__wd/data copy", () => {
  const root = site();
  devBuild(root);

  write(root, "site/_/data.json", JSON.stringify([{ name: "shelf-updated" }]));
  const { result } = changedBuild(root, ["site/_/data.json"]);

  assert.deepEqual(result.incremental.rebuilt, ["/data-page/"]);
  assert.match(read(root, "dist/data-page/index.html"), /shelf-updated/);
  assert.match(read(root, "dist/__wd/data/data.json"), /shelf-updated/);
});

test("a page-colocated JSON data change rebuilds and re-copies; hidden data is never published", () => {
  const root = site();
  devBuild(root);

  write(root, "site/pages/rows.json", JSON.stringify([{ name: "colocated-updated" }]));
  const colocated = changedBuild(root, ["site/pages/rows.json"]).result;
  assert.deepEqual(colocated.incremental.rebuilt, ["/rows/"]);
  assert.match(read(root, "dist/rows/index.html"), /colocated-updated/);
  assert.match(read(root, "dist/rows.json"), /colocated-updated/);

  write(root, "site/pages/_rows/data.json", JSON.stringify([{ name: "hidden-updated" }]));
  const hidden = changedBuild(root, ["site/pages/_rows/data.json"]).result;
  assert.deepEqual(hidden.incremental.rebuilt, ["/hidden-data/"]);
  assert.match(read(root, "dist/hidden-data/index.html"), /hidden-updated/);
  assert.ok(!fs.existsSync(path.join(root, "dist/_rows")), "hidden segments are never published");
});

test("rebuilding the /404/ route refreshes dist/404.html", () => {
  const root = site();
  devBuild(root);

  write(root, "site/pages/404.wd", "---\ntitle: Missing\n---\n\n# Fresh not-found copy\n");
  const { result } = changedBuild(root, ["site/pages/404.wd"]);
  assert.deepEqual(result.incremental.rebuilt, ["/404/"]);
  assert.match(read(root, "dist/404.html"), /Fresh not-found copy/);
});

// ---------------------------------------------------------------------------
// Fallback-to-full triggers — any uncertainty runs the whole build
// ---------------------------------------------------------------------------

test("fallback: no dependency map (a non-dev build ran last) runs a full rebuild", () => {
  const root = site();
  withWarns(() => buildSite(root)); // production build — writes no map
  const untouched = sentinel(root);

  write(root, "site/_/nav.wd", "[Home](/) · post-fallback nav\n");
  const { result, warns } = changedBuild(root, ["site/_/nav.wd"]);
  assert.equal(result.incremental, undefined);
  assert.ok(warns.some((warn) => /full rebuild — no dependency map/.test(warn)));
  assert.ok(!untouched(), "the fallback rebuilt everything");
  assert.match(read(root, "dist/plain/index.html"), /sentinel page/);
  // The fallback full build still writes a fresh map, so the NEXT change can be
  // incremental again.
  assert.ok(fs.existsSync(path.join(root, "dist", DEP_MAP_FILE)));
});

test("fallback: a corrupt or version-mismatched map runs a full rebuild", () => {
  const root = site();
  devBuild(root);

  fs.writeFileSync(path.join(root, "dist", DEP_MAP_FILE), "not json");
  const corrupt = changedBuild(root, ["site/_/nav.wd"]);
  assert.equal(corrupt.result.incremental, undefined);
  assert.ok(corrupt.warns.some((warn) => /full rebuild — no dependency map/.test(warn)));

  fs.writeFileSync(
    path.join(root, "dist", DEP_MAP_FILE),
    JSON.stringify({ version: 99, routes: {} })
  );
  const stale = changedBuild(root, ["site/_/nav.wd"]);
  assert.equal(stale.result.incremental, undefined);
  assert.ok(stale.warns.some((warn) => /full rebuild — no dependency map/.test(warn)));
});

test("fallback: a new page file runs a full rebuild (and the new route is built)", () => {
  const root = site();
  devBuild(root);

  write(root, "site/pages/brand-new.md", "---\ntitle: New\n---\n\nBrand new page.\n");
  const { result, warns } = changedBuild(root, ["site/pages/brand-new.md"]);
  assert.equal(result.incremental, undefined);
  assert.ok(
    warns.some((warn) => /full rebuild — a route was added, removed, or renamed/.test(warn))
  );
  assert.match(read(root, "dist/brand-new/index.html"), /Brand new page/);
});

test("fallback: a deleted route file runs a full rebuild (and its output is gone)", () => {
  const root = site();
  devBuild(root);

  fs.rmSync(path.join(root, "site/pages/plain.md"));
  const { result, warns } = changedBuild(root, ["site/pages/plain.md"]);
  assert.equal(result.incremental, undefined);
  assert.ok(
    warns.some((warn) => /full rebuild — a route was added, removed, or renamed/.test(warn))
  );
  assert.ok(!fs.existsSync(path.join(root, "dist/plain")));
});

test("fallback: a deleted non-route dependency (colocated skin) runs a full rebuild", () => {
  const root = site();
  devBuild(root);

  fs.rmSync(path.join(root, "site/pages/about.skin"));
  const { result, warns } = changedBuild(root, ["site/pages/about.skin"]);
  assert.equal(result.incremental, undefined);
  assert.ok(
    warns.some((warn) =>
      /full rebuild — "site\/pages\/about\.skin" was removed or renamed/.test(warn)
    )
  );
});

test("fallback: a file no dependency graph accounts for runs a full rebuild", () => {
  const root = site();
  write(root, "site/_/unreferenced.wd", "Nothing includes me — yet.\n");
  devBuild(root);

  write(root, "site/_/unreferenced.wd", "Now a page might want me.\n");
  const { result, warns } = changedBuild(root, ["site/_/unreferenced.wd"]);
  assert.equal(result.incremental, undefined);
  assert.ok(
    warns.some((warn) =>
      /full rebuild — "site\/_\/unreferenced\.wd" is not in the dependency map/.test(warn)
    )
  );
});

test("fallback: a change to the site-wide feed link runs a full rebuild", () => {
  const root = site();
  devBuild(root);
  const untouched = sentinel(root);

  // Dropping site_url kills the rss feed — and the <link rel=alternate> every
  // page's head embeds, so a partial rebuild would leave stale feed links.
  write(root, "site/pages/index.md", "---\ntitle: Home\ndescription: A test site\n---\n\n# Home\n");
  const { result, warns } = changedBuild(root, ["site/pages/index.md"]);
  assert.equal(result.incremental, undefined);
  assert.ok(warns.some((warn) => /full rebuild — the site feed link changed/.test(warn)));
  assert.ok(!untouched());
  assert.doesNotMatch(read(root, "dist/plain/index.html"), /rss\.xml/);
});

test("fallback: a targeted build (--target) always runs full", () => {
  const root = site();
  devBuild(root);

  const { result, warns } = changedBuild(root, ["site/_/nav.wd"], { target: "cloudflare" });
  assert.equal(result.incremental, undefined);
  assert.ok(warns.some((warn) => /full rebuild — targeted builds always run full/.test(warn)));
});
