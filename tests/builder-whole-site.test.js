// Whole-site build inputs (src/builder.js).
//
// Two things a page's own dependency graph cannot see are compiled INTO that
// page: the site origin (`site_url` → `<link rel="canonical">` + `og:url`) and
// every ancestor route's title (→ the page's breadcrumb JSON-LD). Both are read
// from OTHER pages' frontmatter, so editing page A invalidates page B, and B is
// never in `routesAffectedBy`.
//
// METHOD: differential. Every incremental assertion here builds the same source
// state twice — once incrementally, once from scratch — and asserts the two
// `dist/` trees are byte-identical. An incremental result that differs from a
// full rebuild IS the failure, whatever it happens to contain, which is a much
// stronger oracle than looking for one string we happened to think of.
//
// Also covered here: the paginated-listing RSS leak, and the sitemap `<lastmod>`
// validation/escaping, both of which are whole-site emissions off the same pass.

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

const devBuild = (root) => withWarns(() => buildSite(root, { depMap: true })).result;
const changedBuild = (root, changed) => withWarns(() => buildSite(root, { changed }));

/**
 * Every file under `dist/`, path → contents. The dependency map itself is
 * excluded: it is build BOOKKEEPING, not published output, and comparing it
 * would assert on key insertion order rather than on what the site serves.
 */
function snapshotDist(root) {
  const distRoot = path.join(root, "dist");
  /** @type {Record<string, string>} */
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name !== DEP_MAP_FILE)
        files[path.relative(distRoot, abs).replaceAll(path.sep, "/")] = fs.readFileSync(
          abs,
          "utf8"
        );
    }
  };
  walk(distRoot);
  return files;
}

/**
 * Build the SAME source tree from scratch in a pristine copy, and return its
 * dist snapshot — the reference an incremental build has to reproduce exactly.
 */
function fullRebuildOfSameSource(root) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fullref-"));
  fs.cpSync(path.join(root, "site"), path.join(copy, "site"), { recursive: true });
  withWarns(() => buildSite(copy));
  return snapshotDist(copy);
}

/** A nested site: `/guides/` with two child pages, so breadcrumbs exist. */
function nestedSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-wholesite-"));
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  write(root, "site/pages/guides/index.md", "---\ntitle: Guides\n---\n\n# Guides\n");
  write(root, "site/pages/guides/setup.md", "---\ntitle: Setup\n---\n\nSetup guide.\n");
  write(root, "site/pages/guides/deploy.md", "---\ntitle: Deploy\n---\n\nDeploy guide.\n");
  write(root, "site/pages/plain.md", "---\ntitle: Plain\n---\n\nUnrelated page.\n");
  return root;
}

// ---------------------------------------------------------------------------
// D1 — whole-site inputs must never leave a stale page behind
// ---------------------------------------------------------------------------

test("renaming an ancestor page refreshes every descendant's breadcrumb (incremental == full)", () => {
  const root = nestedSite();
  devBuild(root);
  assert.match(read(root, "dist/guides/setup/index.html"), /"name":"Guides"/);

  // Edit ONLY the ancestor's title. Its descendants' breadcrumb JSON-LD names
  // it, and nothing in their dependency graph mentions the file.
  write(root, "site/pages/guides/index.md", "---\ntitle: GUIDES RENAMED\n---\n\n# Guides\n");
  const { result } = changedBuild(root, ["site/pages/guides/index.md"]);

  assert.deepEqual(result.incremental.rebuilt, ["/guides/", "/guides/deploy/", "/guides/setup/"]);
  assert.match(read(root, "dist/guides/setup/index.html"), /"name":"GUIDES RENAMED"/);
  assert.doesNotMatch(read(root, "dist/guides/setup/index.html"), /"name":"Guides"/);
  assert.deepEqual(snapshotDist(root), fullRebuildOfSameSource(root));
});

test("renaming the home page refreshes every breadcrumb trail's first crumb", () => {
  const root = nestedSite();
  devBuild(root);
  assert.match(read(root, "dist/guides/setup/index.html"), /"name":"Home"/);

  // The home title leads EVERY trail, so it fans out to every nested route.
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: HOME RENAMED\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  const { result } = changedBuild(root, ["site/pages/index.md"]);

  assert.ok(result.incremental, "a rename is a fan-out, not a fallback");
  assert.match(read(root, "dist/guides/setup/index.html"), /"name":"HOME RENAMED"/);
  assert.deepEqual(snapshotDist(root), fullRebuildOfSameSource(root));
});

test("renaming a leaf page rebuilds only itself — the fan-out stays precise", () => {
  const root = nestedSite();
  devBuild(root);

  write(root, "site/pages/guides/deploy.md", "---\ntitle: Deploy Renamed\n---\n\nDeploy guide.\n");
  const { result } = changedBuild(root, ["site/pages/guides/deploy.md"]);

  assert.deepEqual(result.incremental.rebuilt, ["/guides/deploy/"], "a leaf has no descendants");
  assert.deepEqual(snapshotDist(root), fullRebuildOfSameSource(root));
});

test("changing site_url falls back to a full rebuild, so no page keeps a stale canonical", () => {
  // No dated post, so the rss <link> is absent before AND after — the existing
  // feed-link guard cannot see this change, which is exactly why it shipped.
  const root = nestedSite();
  devBuild(root);
  assert.match(
    read(root, "dist/plain/index.html"),
    /rel="canonical" href="https:\/\/example\.com\/plain\/"/
  );
  assert.doesNotMatch(read(root, "dist/plain/index.html"), /rss\.xml/);

  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://moved.example\n---\n\n# Home\n"
  );
  const { result, warns } = changedBuild(root, ["site/pages/index.md"]);

  assert.equal(result.incremental, undefined);
  assert.ok(
    warns.some((warn) => /full rebuild — site_url changed/.test(warn)),
    warns.join("\n")
  );
  // The bug this replaces: a sitemap at the new origin over stale canonicals.
  assert.match(
    read(root, "dist/plain/index.html"),
    /rel="canonical" href="https:\/\/moved\.example\/plain\/"/
  );
  assert.match(read(root, "dist/sitemap.xml"), /https:\/\/moved\.example\/plain\//);
  assert.deepEqual(snapshotDist(root), fullRebuildOfSameSource(root));
});

test("a dependency-map without the whole-site record falls back to a full rebuild", () => {
  const root = nestedSite();
  devBuild(root);
  // A map written by an older Darkmown: right shape, no site record.
  const map = JSON.parse(read(root, path.join("dist", DEP_MAP_FILE)));
  delete map.site;
  fs.writeFileSync(path.join(root, "dist", DEP_MAP_FILE), JSON.stringify(map));

  write(root, "site/pages/plain.md", "---\ntitle: Plain\n---\n\nEdited.\n");
  const { result, warns } = changedBuild(root, ["site/pages/plain.md"]);
  assert.equal(result.incremental, undefined);
  assert.ok(warns.some((warn) => /full rebuild — no dependency map/.test(warn)));
});

// ---------------------------------------------------------------------------
// D3 — paginated listing pages are not posts
// ---------------------------------------------------------------------------

test("a dated paginated listing produces ONE rss item, not one per generated page", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-paginate-rss-"));
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  // A listing with its own `date:` paginating three entries → /news/, page/2/, page/3/.
  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\ndate: 2026-03-01\n---\n@loop news into n sort by n.title paginate 1\n- { n.title }\n@endloop\n"
  );
  for (const [file, title] of [
    ["a.md", "Alpha"],
    ["b.md", "Beta"],
    ["c.md", "Gamma"]
  ]) {
    write(root, `site/pages/news/${file}`, `---\ntitle: ${title}\n---\n\nBody.\n`);
  }
  withWarns(() => buildSite(root));

  const rss = read(root, "dist/rss.xml");
  assert.equal(rss.match(/<item>/g).length, 1, "the listing syndicates once, not once per page");
  assert.equal(rss.match(/<title>News<\/title>/g).length, 1);
  assert.doesNotMatch(rss, /\/news\/page\/2\//, "a generated page is not a post");

  // The generated pages are still indexable HTML, so they stay in the sitemap —
  // dated from the listing SOURCE FILE, which is what they actually are.
  const sitemap = read(root, "dist/sitemap.xml");
  assert.match(sitemap, /https:\/\/example\.com\/news\/page\/2\//);
  assert.match(sitemap, /https:\/\/example\.com\/news\/page\/3\//);
  assert.equal(
    sitemap.match(/<lastmod>2026-03-01<\/lastmod>/g).length,
    1,
    "only the listing carries its own date"
  );
});

// ---------------------------------------------------------------------------
// D4 — the sitemap <lastmod> is validated and escaped
// ---------------------------------------------------------------------------

function siteWithDate(date) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-lastmod-"));
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  write(root, "site/pages/post.md", `---\ntitle: Post\ndate: ${date}\n---\n\nBody.\n`);
  return root;
}

test("an XML-hostile date: warns and omits <lastmod> instead of destroying the sitemap", () => {
  const root = siteWithDate('2026<bad&"q"');
  const { warns } = withWarns(() => buildSite(root));

  const sitemap = read(root, "dist/sitemap.xml");
  assert.ok(
    warns.some((warn) => /sitemap <lastmod> omitted for \/post\//.test(warn)),
    warns.join("\n")
  );
  assert.match(sitemap, /<loc>https:\/\/example\.com\/post\/<\/loc>/, "the URL is still indexed");
  assert.doesNotMatch(sitemap, /<lastmod>2026</);
  // The whole point: the document still parses. A raw `<` or `&` in an element
  // makes it unparseable, and then NOTHING on the site gets indexed.
  assert.doesNotMatch(sitemap, /&(?!(amp|lt|gt|quot|apos);)/, "no unescaped ampersands anywhere");
  assert.equal(sitemap.match(/</g).length, sitemap.match(/>/g).length, "tags stay balanced");
});

test("a human-written date: warns and omits, instead of silently emitting `Jan 5, 202`", () => {
  const root = siteWithDate("Jan 5, 2026");
  const { warns } = withWarns(() => buildSite(root));

  const sitemap = read(root, "dist/sitemap.xml");
  assert.ok(
    warns.some((warn) => /date: "Jan 5, 2026" is not a date/.test(warn)),
    warns.join("\n")
  );
  assert.doesNotMatch(sitemap, /Jan 5, 202/);
  assert.doesNotMatch(sitemap, /<lastmod><\/lastmod>/, "an empty element is not emitted either");
});

test("an impossible calendar day is rejected; a real ISO date passes through", () => {
  const bad = siteWithDate("2026-02-30");
  const { warns } = withWarns(() => buildSite(bad));
  assert.ok(warns.some((warn) => /date: "2026-02-30" is not a date/.test(warn)));

  const good = siteWithDate("2026-01-05T10:30:00Z");
  withWarns(() => buildSite(good));
  assert.match(read(good, "dist/sitemap.xml"), /<lastmod>2026-01-05<\/lastmod>/);
});

// ---------------------------------------------------------------------------
// D7 — include-shelf .skin/.js sources are compiler input, not published media
// ---------------------------------------------------------------------------

test("a shelf include's .skin/.js sources are not published verbatim to /__wd/media", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-shelf-"));
  write(root, "site/pages/index.wd", "---\ntitle: Home\n---\n@include /card.wd\n");
  write(root, "site/_/card.wd", "A shared card.\n");
  write(root, "site/_/card.skin", "card\n  color #123456\n");
  write(root, "site/_/card.js", "console.log('card');\n");
  write(root, "site/_/logo.svg", "<svg></svg>\n");
  withWarns(() => buildSite(root));

  const media = path.join(root, "dist/__wd/media");
  assert.ok(!fs.existsSync(path.join(media, "card.skin")), "the skin SOURCE is not published");
  assert.ok(!fs.existsSync(path.join(media, "card.js")), "the script SOURCE is not published");
  assert.ok(fs.existsSync(path.join(media, "logo.svg")), "real shelf media still publishes");

  // The compiled output is still emitted, on its own path, and still linked.
  const html = read(root, "dist/index.html");
  const skinHref = /href="(\/__wd\/styles\/[^"]+\.css)"/.exec(html);
  assert.ok(skinHref, `the compiled skin is linked: ${html}`);
  assert.match(read(root, path.join("dist", skinHref[1])), /#123456/);
});
