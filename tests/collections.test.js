// Typed content collections + pagination (1.5.0 headline feature).
//
// A collection is ANY `site/pages/<name>/` subdirectory, referenced by its bare
// name in `@loop` — no `content/` root, no marker file. Each entry's frontmatter
// (reused from the router's `route.meta`, never re-parsed) becomes a row plus the
// derived `url`/`slug`/`excerpt`, so the existing where/sort/format-pipe/`:if`
// machinery works unchanged. An optional `_schema.wd` validates every entry at
// build time. `@loop … paginate N` multiplies the listing into static pages
// (page 1 at the route, 2+ at `/<route>/page/<n>/`) with a `{ page.* }` pager.
//
// Headline contracts asserted here: a pure collection listing stays
// `runtime: false` (zero JS); drafts NEVER leak into a default-build listing but
// DO appear under `--drafts`; schema validation reports `file:line` on both the
// schema file and the offending entry; pagination emits every page route as
// static HTML with a correct pager.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { buildCollections, parseSchema, readSchema } from "../src/compiler/collections.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { discoverRoutes } from "../src/router.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-collections-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Write a dated `.md` blog post. The body opens with prose (so the auto-excerpt
 * fallback has a first paragraph), then a heading. */
function post(root, slug, fields, body = "Body paragraph.") {
  write(root, `site/pages/blog/${slug}.md`, [`---`, ...fields, `---`, "", body].join("\n"));
}

/** Build the collection index for a site root (default-build, no drafts). */
function indexFor(root, options = {}) {
  const paths = createPaths(root);
  const routes = discoverRoutes(paths.routesRoot, options);
  return { collections: buildCollections(routes, paths), paths, routes };
}

// ---------------------------------------------------------------------------
// Collection index + row shape
// ---------------------------------------------------------------------------

test("any site/pages/<name>/ subdir is a collection, keyed by its bare name", () => {
  const root = fixture();
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n# Home");
  write(root, "site/pages/about.md", "---\ntitle: About\n---\n# About"); // top-level page, not a collection
  post(root, "hello", ["title: Hello", "date: 2026-01-01"]);
  post(root, "world", ["title: World", "date: 2026-01-02"]);
  write(root, "site/pages/docs/guide.md", "---\ntitle: Guide\n---\nGuide body."); // /docs/guide/ → docs collection
  const { collections } = indexFor(root);
  assert.deepEqual([...collections.keys()].sort(), ["blog", "docs"]);
  assert.equal(collections.get("blog").length, 2);
  assert.equal(collections.get("docs").length, 1);
});

test("a bare top-level page (no nesting) is not a collection entry", () => {
  const root = fixture();
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n# Home");
  write(root, "site/pages/about.md", "---\ntitle: About\n---\nbody");
  write(root, "site/pages/docs/index.md", "---\ntitle: Docs\n---\nbody"); // /docs/ is single-segment → not an entry
  const { collections } = indexFor(root);
  assert.equal(collections.size, 0);
});

test("a row carries every frontmatter field plus derived url/slug/excerpt", () => {
  const root = fixture();
  post(
    root,
    "typed-post",
    ["title: Typed Post", "date: 2026-03-04", "tags: [a, b]", "featured: true"],
    "The opening paragraph becomes the excerpt."
  );
  const { collections } = indexFor(root);
  const [row] = collections.get("blog");
  assert.equal(row.title, "Typed Post");
  assert.deepEqual(row.tags, ["a", "b"]);
  assert.equal(row.featured, true);
  assert.equal(row.url, "/blog/typed-post/");
  assert.equal(row.slug, "typed-post");
  assert.equal(row.excerpt, "The opening paragraph becomes the excerpt.");
});

test("excerpt falls back to the first paragraph for a .md entry, frontmatter excerpt wins", () => {
  const root = fixture();
  post(root, "auto", ["title: Auto", "date: 2026-01-01"], "Auto-derived excerpt here.");
  post(
    root,
    "explicit",
    ["title: Explicit", "date: 2026-01-02", "excerpt: Hand-written."],
    "Body."
  );
  const { collections } = indexFor(root);
  const byUrl = Object.fromEntries(collections.get("blog").map((r) => [r.slug, r.excerpt]));
  assert.equal(byUrl.auto, "Auto-derived excerpt here.");
  assert.equal(byUrl.explicit, "Hand-written.");
});

test("a .wd entry gets no auto-excerpt (directive markup isn't clean prose)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/notes/first.wd",
    ["---", "title: A Note", "date: 2026-01-01", "---", "", ":state x = 1", "{ x }"].join("\n")
  );
  const { collections } = indexFor(root);
  assert.equal(collections.get("notes")[0].excerpt, "");
});

test("an index.wd/.md entry derives its slug from the containing folder, not 'index'", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/launch/index.md",
    "---\ntitle: Launch\ndate: 2026-01-01\n---\n# Launch"
  );
  const { collections } = indexFor(root);
  const row = collections.get("blog")[0];
  assert.equal(row.slug, "launch");
  assert.equal(row.url, "/blog/launch/");
});

test("derived url/slug/excerpt cannot be shadowed by stray frontmatter keys", () => {
  const root = fixture();
  post(root, "evil", ["title: Evil", "date: 2026-01-01", "url: /hacked/", "slug: nope"]);
  const { collections } = indexFor(root);
  const row = collections.get("blog")[0];
  assert.equal(row.url, "/blog/evil/"); // real route, not the frontmatter url:
  assert.equal(row.slug, "evil");
});

// ---------------------------------------------------------------------------
// @loop over a collection — resolution, where/sort, static unroll
// ---------------------------------------------------------------------------

test("a bare collection name in @loop resolves to its rows and static-unrolls (runtime:false)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post sort by post.date desc", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "old", ["title: Old", "date: 2026-01-01"]);
  post(root, "new", ["title: New", "date: 2026-02-01"]);
  const { collections, paths } = indexFor(root);
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.equal(page.assets.runtime, false); // pure listing ships zero JS
  // sorted newest-first
  assert.ok(page.html.indexOf("New") < page.html.indexOf("Old"));
});

test("where over a collection filters at build time", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post where post.featured == true", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "a", ["title: Keep", "date: 2026-01-01", "featured: true"]);
  post(root, "b", ["title: Drop", "date: 2026-01-02", "featured: false"]);
  const { collections, paths } = indexFor(root);
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.match(page.html, /Keep/);
  assert.doesNotMatch(page.html, /Drop/);
  assert.equal(page.assets.runtime, false);
});

test("a collection loop whose where reads :state becomes reactive (baked rows)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state q = ""',
      "@loop blog into post where post.title contains q",
      "- { post.title }",
      "@endloop"
    ].join("\n")
  );
  post(root, "a", ["title: Alpha", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.equal(page.assets.runtime, true); // state-driven where → reactive island
  assert.match(page.html, /data-wd-loop/);
});

test("a declared :state of the same name wins over a collection", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state blog = [1, 2]", "@loop blog into n", "- { n }", "@endloop"].join("\n")
  );
  post(root, "ignored", ["title: Ignored", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.match(page.html, /data-wd-loop="blog"/); // resolved as the :state list, not the collection
});

test("an unknown bare @loop source errors and lists the available collections", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blgo into post", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "x", ["title: X", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), paths, { collections }),
    /Available collections: blog/
  );
});

test("an unresolved bare @loop source with no collections still errors cleanly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["@loop nope into x", "- { x }", "@endloop"].join("\n"));
  const paths = createPaths(root);
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), paths, {}),
    /@loop source "nope".*was not found/s
  );
});

// ---------------------------------------------------------------------------
// Drafts never leak into a default-build collection listing
// ---------------------------------------------------------------------------

test("a draft entry is excluded from a default-build collection listing", () => {
  const root = fixture();
  post(root, "live", ["title: Live", "date: 2026-01-02"]);
  post(root, "wip", ["title: Secret WIP", "date: 2026-01-03", "draft: true"]);
  const { collections } = indexFor(root); // default build (no drafts)
  const titles = collections.get("blog").map((r) => r.title);
  assert.deepEqual(titles.sort(), ["Live"]);
});

test("a draft entry IS included in a collection under --drafts", () => {
  const root = fixture();
  post(root, "live", ["title: Live", "date: 2026-01-02"]);
  post(root, "wip", ["title: Secret WIP", "date: 2026-01-03", "draft: true"]);
  const { collections } = indexFor(root, { includeDrafts: true });
  const titles = collections
    .get("blog")
    .map((r) => r.title)
    .sort();
  assert.deepEqual(titles, ["Live", "Secret WIP"]);
});

test("a draft never reaches the listing HTML on a default build (end-to-end)", () => {
  const root = fixture();
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n# Home");
  write(
    root,
    "site/pages/blog/index.wd",
    ["@loop blog into post", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "live", ["title: Published Post", "date: 2026-01-02"]);
  post(root, "wip", ["title: Draft Leak", "date: 2026-01-03", "draft: true"]);
  buildSite(root, {});
  const html = fs.readFileSync(path.join(root, "dist/blog/index.html"), "utf8");
  assert.match(html, /Published Post/);
  assert.doesNotMatch(html, /Draft Leak/);
  // and with --drafts it appears
  buildSite(root, { includeDrafts: true });
  const drafted = fs.readFileSync(path.join(root, "dist/blog/index.html"), "utf8");
  assert.match(drafted, /Draft Leak/);
});

// ---------------------------------------------------------------------------
// _schema.wd — parse + validate (pass + fail with file:line)
// ---------------------------------------------------------------------------

test("parseSchema reads field:type rules and the optional ? modifier", () => {
  const fields = parseSchema(
    ["---", "title: string", "tags: string[]", "featured: boolean?", "---", "", "note"].join("\n"),
    "/x/_schema.wd"
  );
  assert.deepEqual(fields, [
    { name: "title", type: "string", optional: false },
    { name: "tags", type: "string[]", optional: false },
    { name: "featured", type: "boolean", optional: true }
  ]);
});

test("parseSchema reads a fence-less schema and skips blanks + comments", () => {
  const fields = parseSchema(
    ["# a note", "", "title: string", "date: date"].join("\n"),
    "/x/_schema.wd"
  );
  assert.deepEqual(
    fields.map((f) => f.name),
    ["title", "date"]
  );
});

test("an unknown schema type token errors with the schema file:line", () => {
  assert.throws(
    () =>
      parseSchema(["---", "title: string", "date: datetime", "---"].join("\n"), "/x/_schema.wd"),
    /Unknown schema type "datetime" for field "date" in \/x\/_schema\.wd:3/
  );
});

test("a malformed schema line errors with the schema file:line", () => {
  assert.throws(
    () => parseSchema(["---", "this is not a rule", "---"].join("\n"), "/x/_schema.wd"),
    /Malformed schema line in \/x\/_schema\.wd:2/
  );
});

test("readSchema returns null when a collection has no _schema.wd", () => {
  const root = fixture();
  post(root, "x", ["title: X", "date: 2026-01-01"]);
  assert.equal(readSchema("blog", createPaths(root)), null);
});

test("a valid collection passes schema validation", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "date: date", "tags: string[]?", "---"].join("\n")
  );
  post(root, "ok", ["title: Fine", "date: 2026-06-29", "tags: [a, b]"]);
  assert.doesNotThrow(() => indexFor(root));
});

test("a missing required field fails validation, naming the entry url + field", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "date: date", "---"].join("\n")
  );
  post(root, "nodate", ["title: No Date"]);
  assert.throws(
    () => indexFor(root),
    /Missing required field "date" \(date\) in \/blog\/nodate\/ \(collection "blog"\)/
  );
});

test("an optional field may be absent", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "subtitle: string?", "---"].join("\n")
  );
  post(root, "ok", ["title: Has Title"]);
  assert.doesNotThrow(() => indexFor(root));
});

test("a wrong-typed field fails validation", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "tags: string[]", "---"].join("\n")
  );
  post(root, "bad", ["title: T", "tags: just-a-string"]);
  assert.throws(() => indexFor(root), /Field "tags".*should be string\[\] but is "just-a-string"/);
});

test("an unknown extra field fails validation (typo guard)", () => {
  const root = fixture();
  write(root, "site/pages/blog/_schema.wd", ["---", "title: string", "---"].join("\n"));
  post(root, "typo", ["title: T", "titel: oops"]);
  assert.throws(
    () => indexFor(root),
    /Unknown frontmatter field "titel".*not declared in _schema\.wd/
  );
});

test("framework keys (url/slug/excerpt/draft) are allowed without a schema declaration", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "date: date", "---"].join("\n")
  );
  // draft present (a --drafts build) must not trip the unknown-key check
  post(root, "d", ["title: Draft", "date: 2026-01-01", "draft: true"]);
  assert.doesNotThrow(() => indexFor(root, { includeDrafts: true }));
});

test("schema type coverage: number, boolean, date scalars + numeric/boolean strings", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "rank: number", "live: boolean", "date: date", "---"].join("\n")
  );
  post(root, "a", ["title: A", "rank: 3", "live: true", "date: 2026-01-01"]);
  post(root, "b", ["title: B", 'rank: "7"', "live: false", "date: 2026-02-02"]); // quoted scalars
  assert.doesNotThrow(() => indexFor(root));
});

test("a non-numeric string fails a number field, a bad date fails a date field", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "rank: number", "---"].join("\n")
  );
  post(root, "bad", ["title: T", "rank: high"]);
  assert.throws(() => indexFor(root), /Field "rank".*should be number/);

  const root2 = fixture();
  write(
    root2,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "date: date", "---"].join("\n")
  );
  post(root2, "bad", ["title: T", "date: not-a-date"]);
  assert.throws(() => indexFor(root2), /Field "date".*should be date/);
});

// ---------------------------------------------------------------------------
// Pagination — route multiplication + pager vars + runtime:false
// ---------------------------------------------------------------------------

/** A paginated blog site: N posts dated newest = post-N, listing at /blog/. */
function paginatedSite(count, perPage) {
  const root = fixture();
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n# Home"
  );
  write(
    root,
    "site/pages/blog/index.wd",
    [
      `@loop blog into post sort by post.date desc paginate ${perPage}`,
      "- [{ post.title }]({ post.url })",
      "@endloop",
      "",
      "Page { page.current } of { page.total }.",
      ":if page.prev",
      "[Newer]({ page.prev })",
      ":endif",
      ":if page.next",
      "[Older]({ page.next })",
      ":endif"
    ].join("\n")
  );
  for (let i = 1; i <= count; i++) {
    post(root, `post-${i}`, [`title: Post ${i}`, `date: 2026-01-${String(i).padStart(2, "0")}`]);
  }
  return root;
}

test("paginate N multiplies the listing into static pages at /<route>/page/<n>/", () => {
  const root = paginatedSite(5, 2); // 5 posts / 2 per page → 3 pages
  const { routes } = buildSite(root, {});
  const blogPages = routes.filter((r) => r.route.startsWith("/blog")).map((r) => r.route);
  assert.ok(blogPages.includes("/blog/"));
  assert.ok(blogPages.includes("/blog/page/2/"));
  assert.ok(blogPages.includes("/blog/page/3/"));
  // every generated page is static HTML
  for (const r of routes.filter((r) => r.route.startsWith("/blog/page/") || r.route === "/blog/")) {
    assert.equal(r.assets.runtime, false);
  }
  assert.ok(fs.existsSync(path.join(root, "dist/blog/page/2/index.html")));
  assert.ok(fs.existsSync(path.join(root, "dist/blog/index.html")));
});

test("page 1 stays at the listing route; later pages slice the next rows", () => {
  const root = paginatedSite(5, 2);
  buildSite(root, {});
  const page1 = fs.readFileSync(path.join(root, "dist/blog/index.html"), "utf8");
  const page2 = fs.readFileSync(path.join(root, "dist/blog/page/2/index.html"), "utf8");
  // newest-first: page 1 = Post 5, Post 4; page 2 = Post 3, Post 2
  assert.match(page1, /Post 5/);
  assert.match(page1, /Post 4/);
  assert.doesNotMatch(page1, /Post 3/);
  assert.match(page2, /Post 3/);
  assert.match(page2, /Post 2/);
  assert.doesNotMatch(page2, /Post 5/);
});

test("the pager exposes current/total + prev/next URLs (empty at the ends)", () => {
  const root = paginatedSite(5, 2);
  buildSite(root, {});
  const page1 = fs.readFileSync(path.join(root, "dist/blog/index.html"), "utf8");
  const page2 = fs.readFileSync(path.join(root, "dist/blog/page/2/index.html"), "utf8");
  const page3 = fs.readFileSync(path.join(root, "dist/blog/page/3/index.html"), "utf8");
  assert.match(page1, /Page 1 of 3\./);
  assert.match(page2, /Page 2 of 3\./);
  assert.match(page3, /Page 3 of 3\./);
  // page 1: no Newer (prev empty), has Older → /blog/page/2/
  assert.doesNotMatch(page1, /Newer/);
  assert.match(page1, /href="\/blog\/page\/2\/">Older/);
  // page 2: Newer → /blog/ , Older → /blog/page/3/
  assert.match(page2, /href="\/blog\/">Newer/);
  assert.match(page2, /href="\/blog\/page\/3\/">Older/);
  // page 3: Newer → /blog/page/2/ , no Older
  assert.match(page3, /href="\/blog\/page\/2\/">Newer/);
  assert.doesNotMatch(page3, /Older/);
});

test("a single-page collection does not multiply routes", () => {
  const root = paginatedSite(2, 5); // 2 posts, 5 per page → 1 page
  const { routes } = buildSite(root, {});
  assert.ok(!routes.some((r) => r.route.startsWith("/blog/page/")));
  const page1 = fs.readFileSync(path.join(root, "dist/blog/index.html"), "utf8");
  assert.match(page1, /Page 1 of 1\./);
  assert.doesNotMatch(page1, /Newer/);
  assert.doesNotMatch(page1, /Older/);
});

test("paginated pages join the sitemap and inflate the build route count", () => {
  const root = paginatedSite(5, 2);
  const result = buildSite(root, {});
  // home + blog index + 2 extra pages + 5 posts = 9 routes
  assert.equal(result.routes.length, 9);
  const sitemap = fs.readFileSync(path.join(root, "dist/sitemap.xml"), "utf8");
  assert.match(sitemap, /https:\/\/example\.com\/blog\/page\/2\//);
  assert.match(sitemap, /https:\/\/example\.com\/blog\/page\/3\//);
});

test("drafts are excluded before pagination, so the page count reflects published posts only", () => {
  const root = paginatedSite(4, 2); // 4 published → 2 pages
  post(root, "wip", ["title: WIP", "date: 2026-02-01", "draft: true"]); // a 5th, draft
  const { routes } = buildSite(root, {});
  const blogPages = routes.filter((r) => r.route === "/blog/" || r.route.startsWith("/blog/page/"));
  assert.equal(blogPages.length, 2); // still 2 pages — the draft didn't push to a 3rd
  for (const file of ["dist/blog/index.html", "dist/blog/page/2/index.html"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /WIP/);
  }
});

// ---------------------------------------------------------------------------
// paginate guards
// ---------------------------------------------------------------------------

test("paginate on a non-collection source (JSON file) is a compile error", () => {
  const root = fixture();
  write(root, "site/_/posts.json", JSON.stringify([{ title: "a" }, { title: "b" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /posts.json into p paginate 1", "- { p.title }", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), {}),
    /@loop paginate requires a collection source/
  );
});

test("paginate on an in-scope value is a compile error", () => {
  const root = fixture();
  // meta.tags is an in-scope array
  write(
    root,
    "site/pages/index.wd",
    ["---", "tags: [a, b]", "---", "@loop meta.tags into t paginate 1", "- { t }", "@endloop"].join(
      "\n"
    )
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), {}),
    /@loop paginate requires a collection source/
  );
});

test("paginate on a :state list is a compile error", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state items = [1, 2]", "@loop items into n paginate 1", "- { n }", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), {}),
    /@loop paginate requires a collection source/
  );
});

test("paginate cannot combine with offset/limit", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post paginate 2 limit 1", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "x", ["title: X", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), paths, { collections }),
    /@loop paginate cannot combine with offset\/limit/
  );
});

test("paginate 0 is rejected as malformed", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post paginate 0", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "x", ["title: X", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), paths, { collections }),
    /Malformed @loop clause/
  );
});

test("sortable cannot combine with paginate", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post paginate 2 sortable", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "x", ["title: X", "date: 2026-01-01"]);
  const { collections, paths } = indexFor(root);
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), paths, { collections }),
    /sortable cannot combine with where\/sort\/reverse\/offset\/limit\/paginate/
  );
});

test("a non-paginated collection loop with no page scope renders page 1 by default", () => {
  // currentPage() default branch: compiled without a `page` var in scope.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post paginate 2", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "a", ["title: A", "date: 2026-01-01"]);
  post(root, "b", ["title: B", "date: 2026-01-02"]);
  post(root, "c", ["title: C", "date: 2026-01-03"]);
  const { collections, paths } = indexFor(root);
  // No `vars.page` passed → currentPage falls back to 1, rendering the first slice.
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.equal(page.pagination.total, 2); // 3 posts / 2 per page
  assert.equal(page.assets.runtime, false);
});

test("a collection loop that filters to zero rows renders the @empty branch", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      '@loop blog into p where p.title == "nope"',
      "- { p.title }",
      "@empty",
      "Nothing here.",
      "@endloop"
    ].join("\n")
  );
  post(root, "real", ["title: Real", "date: 2026-01-02"]);
  const { collections, paths } = indexFor(root);
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.match(page.html, /Nothing here\./);
  assert.doesNotMatch(page.html, /Real/);
});

// ---------------------------------------------------------------------------
// QUOTES ARE THE ESCAPE HATCH FROM NUMERIC COERCION.
//
// A collection row coerces bare scalars so `where p.featured == true` and
// numeric sorts behave like a JSON loop. That coercion used to run AFTER the
// frontmatter parser had already stripped the author's quotes, so it could not
// tell `sku: "007"` from `sku: 007` and turned both into the number 7. With a
// `_schema.wd` declaring `sku: string` the collection then became UNBUILDABLE,
// and the WD124 blamed the author for a string they did in fact write.
// Zero-padded ids, ISBNs, zip codes, SKUs, episode numbers and `x.y0` versions
// all live in that gap.
// ---------------------------------------------------------------------------

const NUMERIC_LOOKING = [
  ["007", "a zero-padded id"],
  ["1.10", "a trailing-zero version"],
  ["01234", "a leading-zero zip code"],
  ["0", "a single zero"],
  ["-0", "a signed zero"]
];

for (const [value, why] of NUMERIC_LOOKING) {
  test(`a QUOTED "${value}" stays the string it was written as (${why})`, () => {
    const root = fixture();
    post(root, "entry", ["title: Entry", "date: 2026-01-01", `sku: "${value}"`]);
    const { collections } = indexFor(root);
    const [row] = collections.get("blog");
    assert.strictEqual(row.sku, value);
  });

  test(`an UNQUOTED ${value} still coerces to a number (documented behavior)`, () => {
    // The coercion is the feature; the quotes are the opt-out. Both halves are
    // asserted so a future fix cannot quietly disable one of them.
    const root = fixture();
    post(root, "entry", ["title: Entry", "date: 2026-01-01", `sku: ${value}`]);
    const { collections } = indexFor(root);
    const [row] = collections.get("blog");
    assert.strictEqual(row.sku, Number(value));
  });
}

test("a quoted numeric field satisfies a `string` schema instead of failing the build", () => {
  const root = fixture();
  write(
    root,
    "site/pages/blog/_schema.wd",
    ["---", "title: string", "date: date", "sku: string", "---"].join("\n")
  );
  post(root, "entry", ["title: Entry", "date: 2026-01-01", 'sku: "007"']);
  const { collections } = indexFor(root);
  assert.strictEqual(collections.get("blog")[0].sku, "007");
});

test("the page <title> and the listing row agree on a quoted numeric value", () => {
  // The bug's sharpest edge: the entry page rendered `007` from `meta.title`
  // while the collection listing rendered `7` for the same field.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["@loop blog into post", "- { post.title }", "@endloop"].join("\n")
  );
  post(root, "entry", ['title: "007"', "date: 2026-01-01"]);
  const paths = createPaths(root);
  const { collections } = indexFor(root);
  const entry = compilePage(path.join(root, "site/pages/blog/entry.md"), paths).html;
  const listing = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections }).html;
  assert.match(entry, /<title>007<\/title>/);
  assert.match(listing, /<li>007<\/li>/);
});

test("quoted true/false stay strings, unquoted stay booleans", () => {
  const root = fixture();
  post(root, "entry", ["title: Entry", "date: 2026-01-01", 'flag: "true"', "real: false"]);
  const { collections } = indexFor(root);
  const [row] = collections.get("blog");
  assert.strictEqual(row.flag, "true");
  assert.strictEqual(row.real, false);
});

test("single quotes work as the escape hatch too", () => {
  const root = fixture();
  post(root, "entry", ["title: Entry", "date: 2026-01-01", "sku: '007'"]);
  const { collections } = indexFor(root);
  assert.strictEqual(collections.get("blog")[0].sku, "007");
});

test("a .wd entry's quoted numeric field is protected too (not just .md)", () => {
  // `rowFor` reads every entry, not only the ones with a `.md` excerpt fallback.
  const root = fixture();
  write(
    root,
    "site/pages/blog/entry.wd",
    ["---", "title: Entry", "date: 2026-01-01", 'sku: "007"', "---", "", "# Entry"].join("\n")
  );
  const { collections } = indexFor(root);
  assert.strictEqual(collections.get("blog")[0].sku, "007");
});
