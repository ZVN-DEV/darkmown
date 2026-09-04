// Feed scale + configuration (src/feeds.js, src/builder.js).
//
// Two things a site outgrows:
//   * the sitemap protocol's 50,000-URL cap — over it Google rejects the whole
//     document, so the entries shard into numbered files behind a
//     `<sitemapindex>` while `sitemap.xml` (the URL robots.txt names, and the
//     one everyone has already submitted) keeps being the entry point;
//   * the 20-item RSS window, which was a hardcoded constant.
//
// The 50,001-entry case is driven through the PURE planner rather than by
// building 50,001 pages, so the assertion is about the split and nothing else,
// and the suite stays fast.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import {
  buildSitemap,
  buildSitemapIndex,
  RSS_ITEM_LIMIT,
  rssItemLimit,
  SITEMAP_URL_LIMIT,
  sitemapDocuments
} from "../src/feeds.js";

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

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

/** `n` synthetic sitemap entries — no filesystem, no compiler. */
function entries(n) {
  return Array.from({ length: n }, (_, i) => ({
    loc: `https://example.com/p/${i}/`,
    lastmod: "2026-01-01"
  }));
}

// ---------------------------------------------------------------------------
// D9 — sitemap index and the 50,000-URL split
// ---------------------------------------------------------------------------

test("at the 50,000 cap the sitemap is still one plain urlset", () => {
  const docs = sitemapDocuments(entries(SITEMAP_URL_LIMIT), "https://example.com");
  assert.deepEqual(
    docs.map((doc) => doc.file),
    ["sitemap.xml"]
  );
  assert.match(docs[0].xml, /<urlset /);
  assert.doesNotMatch(docs[0].xml, /sitemapindex/);
  assert.equal(docs[0].xml.match(/<url>/g).length, SITEMAP_URL_LIMIT);
});

test("50,001 entries shard into numbered sitemaps behind a sitemapindex", () => {
  const docs = sitemapDocuments(entries(SITEMAP_URL_LIMIT + 1), "https://example.com");
  assert.deepEqual(
    docs.map((doc) => doc.file),
    ["sitemap-1.xml", "sitemap-2.xml", "sitemap.xml"]
  );

  const [first, second, index] = docs;
  assert.equal(first.xml.match(/<url>/g).length, SITEMAP_URL_LIMIT, "the first shard is full");
  assert.equal(second.xml.match(/<url>/g).length, 1, "the overflow lands in the second");
  // No entry is dropped and none is duplicated across the split.
  assert.match(first.xml, /<loc>https:\/\/example\.com\/p\/0\/<\/loc>/);
  assert.match(second.xml, /<loc>https:\/\/example\.com\/p\/50000\/<\/loc>/);
  assert.doesNotMatch(first.xml, /\/p\/50000\//);

  // `sitemap.xml` stays the entry point robots.txt names — it just becomes the
  // index, so every already-submitted sitemap URL keeps working.
  assert.match(index.xml, /<sitemapindex /);
  assert.doesNotMatch(index.xml, /<urlset/);
  assert.match(index.xml, /<loc>https:\/\/example\.com\/sitemap-1\.xml<\/loc>/);
  assert.match(index.xml, /<loc>https:\/\/example\.com\/sitemap-2\.xml<\/loc>/);
  assert.equal(index.xml.match(/<sitemap>/g).length, 2, "one entry per shard, no more");
});

test("three shards number sequentially and every entry survives the split", () => {
  const total = SITEMAP_URL_LIMIT * 2 + 5;
  const docs = sitemapDocuments(entries(total), "https://example.com");
  assert.deepEqual(
    docs.map((doc) => doc.file),
    ["sitemap-1.xml", "sitemap-2.xml", "sitemap-3.xml", "sitemap.xml"]
  );
  const urls = docs.slice(0, -1).reduce((sum, doc) => sum + doc.xml.match(/<url>/g).length, 0);
  assert.equal(urls, total, "every entry is in exactly one shard");
});

test("the sitemapindex escapes shard URLs", () => {
  const xml = buildSitemapIndex(["https://example.com/sitemap-1.xml?a=1&b=2"]);
  assert.match(xml, /sitemap-1\.xml\?a=1&amp;b=2/);
  assert.doesNotMatch(xml, /&(?!amp;)/);
});

test("a normal-sized build writes one sitemap.xml and no shards; stale shards are swept", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-sitemap-"));
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  write(root, "site/pages/about.md", "---\ntitle: About\n---\n\nAbout.\n");
  withWarns(() => buildSite(root));

  assert.match(read(root, "dist/sitemap.xml"), /<urlset /);
  assert.ok(!fs.existsSync(path.join(root, "dist/sitemap-1.xml")));
  // robots.txt keeps naming the single entry point, sharded or not.
  assert.match(read(root, "dist/robots.txt"), /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);

  // A shard left over from when the site was bigger must not survive: it is
  // listed nowhere and still crawlable. A full build wipes `dist` anyway, so the
  // case that needs the sweep is the INCREMENTAL one, which does not.
  withWarns(() => buildSite(root, { depMap: true }));
  fs.writeFileSync(path.join(root, "dist/sitemap-1.xml"), "<stale/>");
  fs.writeFileSync(path.join(root, "dist/sitemap-7.xml"), "<stale/>");
  write(root, "site/pages/about.md", "---\ntitle: About\n---\n\nEdited.\n");
  const { result } = withWarns(() => buildSite(root, { changed: ["site/pages/about.md"] }));

  assert.ok(result.incremental, "the sweep has to work on the build that does not wipe dist");
  assert.ok(!fs.existsSync(path.join(root, "dist/sitemap-1.xml")), "stale shard removed");
  assert.ok(!fs.existsSync(path.join(root, "dist/sitemap-7.xml")), "stale shard removed");
  assert.match(read(root, "dist/sitemap.xml"), /<urlset /, "the real sitemap is still there");
});

test("buildSitemap omits <lastmod> for an entry that has none", () => {
  const xml = buildSitemap([{ loc: "https://example.com/x/", lastmod: "" }]);
  assert.match(xml, /<loc>https:\/\/example\.com\/x\/<\/loc>/);
  assert.doesNotMatch(xml, /<lastmod>/);
});

// ---------------------------------------------------------------------------
// D10 — `rss_limit:` on the home page
// ---------------------------------------------------------------------------

test("rssItemLimit defaults to 20 and accepts any positive whole number", () => {
  assert.equal(rssItemLimit({}), RSS_ITEM_LIMIT);
  assert.equal(RSS_ITEM_LIMIT, 20);
  assert.equal(rssItemLimit({ rss_limit: "50" }), 50);
  assert.equal(rssItemLimit({ rss_limit: "1" }), 1);
  assert.equal(rssItemLimit({ rss_limit: " 7 " }), 7, "frontmatter whitespace is trimmed");
});

test("rssItemLimit rejects anything that is not a positive whole number", () => {
  for (const bad of ["0", "-5", "2.5", "all", "", "twenty", "1e3", "0x10", "7.0", "+5"]) {
    assert.throws(
      () => rssItemLimit({ rss_limit: bad }, "/site/pages/index.md"),
      (err) => {
        assert.equal(err.wd.code, "WD950");
        assert.equal(err.wd.hint, "rss_limit: 20");
        assert.match(err.message, /Invalid rss_limit/);
        assert.match(err.message, /site\/pages\/index\.md/);
        return true;
      },
      `rss_limit: ${bad} must not be accepted`
    );
  }
});

/** A site with `count` dated posts and an optional `rss_limit:` on the home page. */
function postsSite(count, limitLine = "") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-rsslimit-"));
  write(
    root,
    "site/pages/index.md",
    `---\ntitle: Home\nsite_url: https://example.com\n${limitLine}---\n\n# Home\n`
  );
  for (let i = 1; i <= count; i++) {
    const day = String(i).padStart(2, "0");
    write(
      root,
      `site/pages/p${day}.md`,
      `---\ntitle: Post ${day}\ndate: 2026-01-${day}\n---\n\nBody.\n`
    );
  }
  return root;
}

test("rss.xml caps at 20 items by default and at rss_limit when the home page sets one", () => {
  const capped = postsSite(25);
  const defaulted = withWarns(() => buildSite(capped)).result;
  assert.equal(defaulted.feeds.rss, 20);
  assert.equal(read(capped, "dist/rss.xml").match(/<item>/g).length, 20);

  const raised = postsSite(25, "rss_limit: 25\n");
  const wide = withWarns(() => buildSite(raised)).result;
  assert.equal(wide.feeds.rss, 25);
  const xml = read(raised, "dist/rss.xml");
  assert.equal(xml.match(/<item>/g).length, 25);
  assert.match(xml, /<title>Post 01<\/title>/, "the oldest post now makes the window");

  const narrowed = postsSite(25, "rss_limit: 3\n");
  const tight = withWarns(() => buildSite(narrowed)).result;
  assert.equal(tight.feeds.rss, 3);
  // Still newest-first: a smaller window keeps the most recent posts.
  assert.match(read(narrowed, "dist/rss.xml"), /<title>Post 25<\/title>/);
  assert.doesNotMatch(read(narrowed, "dist/rss.xml"), /<title>Post 22<\/title>/);
});

test("an invalid rss_limit fails the build with WD950 rather than silently using 20", () => {
  const root = postsSite(3, "rss_limit: lots\n");
  assert.throws(() => withWarns(() => buildSite(root)), /\[WD950\][\s\S]*Invalid rss_limit "lots"/);
});
