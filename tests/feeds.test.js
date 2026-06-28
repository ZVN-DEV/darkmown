// Feeds & crawler files: sitemap.xml, rss.xml, robots.txt, plus the draft gate
// that keeps `draft: true` pages out of every feed. Build-time only (zero
// runtime). Covers the pure builders in src/feeds.js and the full build wiring
// in src/builder.js — with the leak contract (a draft that also has a date
// produces ZERO sitemap + ZERO rss entries) as the headline assertion.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import {
  absoluteUrl,
  buildRobots,
  buildRss,
  buildSitemap,
  escapeXml,
  firstParagraph,
  isoDate,
  lastmodFor,
  RSS_ITEM_LIMIT,
  rfc822,
  rssDescription
} from "../src/feeds.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-feeds-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** A site root with the home page's `site_url` set (the feeds trigger). */
function siteWithUrl(root, homeExtra = "") {
  write(
    root,
    "site/pages/index.md",
    [
      "---",
      "title: My Blog",
      "description: Notes",
      "site_url: https://example.com",
      homeExtra,
      "---",
      "",
      "# Home"
    ].join("\n")
  );
}

// --- pure builders: escaping, URL join, dates ------------------------------

test("escapeXml covers the five predefined entities", () => {
  assert.equal(
    escapeXml(`a & b < c > "d" 'e'`),
    "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;"
  );
  // non-string input is coerced
  assert.equal(escapeXml(42), "42");
});

test("absoluteUrl joins origin + route, collapsing the boundary slash", () => {
  assert.equal(absoluteUrl("https://x.com", "/"), "https://x.com/");
  assert.equal(absoluteUrl("https://x.com", "/about/"), "https://x.com/about/");
  // tolerates a stray trailing slash on the origin
  assert.equal(absoluteUrl("https://x.com/", "/about/"), "https://x.com/about/");
});

test("isoDate formats a Date as yyyy-mm-dd", () => {
  assert.equal(isoDate(new Date("2026-06-28T13:45:00Z")), "2026-06-28");
});

test("rfc822 formats a date in GMT, and returns empty for an unparseable value", () => {
  assert.equal(rfc822("2026-06-28"), "Sun, 28 Jun 2026 00:00:00 GMT");
  assert.equal(rfc822("2026-01-01T08:09:05Z"), "Thu, 01 Jan 2026 08:09:05 GMT");
  assert.equal(rfc822("not a date"), "");
});

// --- firstParagraph: the .md RSS-description fallback -----------------------

test("firstParagraph takes the first prose block and strips inline markdown", () => {
  const body = "First **bold** and `code` and a [link](/x) line.\nSecond line.\n\nNext para.";
  assert.equal(firstParagraph(body), "First bold and code and a link line. Second line.");
});

test("firstParagraph skips leading blanks and bails on a non-prose opener", () => {
  assert.equal(firstParagraph("\n\nReal prose here."), "Real prose here.");
  assert.equal(firstParagraph("# Heading only\n\nbody"), "");
  assert.equal(firstParagraph("```\ncode\n```"), "");
  assert.equal(firstParagraph("- a list\n- item"), "");
  assert.equal(firstParagraph("> a quote"), "");
  assert.equal(firstParagraph("1. ordered"), "");
  assert.equal(firstParagraph("   "), "");
});

// --- rssDescription priority: excerpt → description → first paragraph -------

test("rssDescription prefers excerpt, then description", () => {
  assert.equal(rssDescription({ excerpt: "E", description: "D" }, "/p.md", "Body"), "E");
  assert.equal(rssDescription({ description: "D" }, "/p.md", "Body"), "D");
});

test("rssDescription falls back to the first paragraph for plain .md only", () => {
  assert.equal(
    rssDescription({}, "/p.md", "Lead paragraph here.\n\nMore."),
    "Lead paragraph here."
  );
  // .wd is never scanned for prose — directive markup isn't worth stripping
  assert.equal(rssDescription({}, "/p.wd", "Lead paragraph here."), "");
});

// --- buildSitemap ----------------------------------------------------------

test("buildSitemap emits one <url> per entry with loc + lastmod, escaped", () => {
  const xml = buildSitemap([
    { loc: "https://x.com/", lastmod: "2026-06-28" },
    { loc: "https://x.com/a&b/", lastmod: "2026-06-01" }
  ]);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/x\.com\/<\/loc>\s*<lastmod>2026-06-28<\/lastmod>/);
  // ampersand in a loc is XML-escaped
  assert.match(xml, /<loc>https:\/\/x\.com\/a&amp;b\/<\/loc>/);
  // no priority/changefreq bloat
  assert.doesNotMatch(xml, /priority|changefreq/);
});

// --- buildRss --------------------------------------------------------------

test("buildRss renders channel + items, omitting an absent pubDate/description", () => {
  const xml = buildRss(
    {
      title: "My Blog",
      description: "Notes",
      siteUrl: "https://x.com",
      feedUrl: "https://x.com/rss.xml"
    },
    [
      {
        title: "Post A",
        link: "https://x.com/a/",
        pubDate: "Sun, 28 Jun 2026 00:00:00 GMT",
        description: "desc a"
      },
      { title: "Post B", link: "https://x.com/b/", pubDate: "", description: "" }
    ]
  );
  assert.match(xml, /<rss version="2\.0"/);
  assert.match(xml, /<title>My Blog<\/title>/);
  assert.match(xml, /<atom:link href="https:\/\/x\.com\/rss\.xml" rel="self"/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/x\.com\/a\/<\/guid>/);
  assert.match(xml, /<pubDate>Sun, 28 Jun 2026 00:00:00 GMT<\/pubDate>/);
  // Post B has no pubDate/description → those elements are omitted for it
  const bItem = xml.slice(xml.indexOf("Post B"));
  assert.doesNotMatch(bItem, /<pubDate>/);
  assert.doesNotMatch(bItem, /<description>/);
});

// --- buildRobots -----------------------------------------------------------

test("buildRobots always allows; the Sitemap line only appears with a site_url", () => {
  assert.equal(
    buildRobots("https://x.com"),
    "User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml\n"
  );
  assert.equal(buildRobots(""), "User-agent: *\nAllow: /\n");
  assert.equal(buildRobots(), "User-agent: *\nAllow: /\n");
});

// --- lastmodFor: git → mtime fallback --------------------------------------

test("lastmodFor returns the git committer date inside a repo", () => {
  const root = fixture();
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@t.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  const file = path.join(root, "post.md");
  fs.writeFileSync(file, "# Post");
  execFileSync("git", ["add", "post.md"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "add", "--date=2020-03-04T00:00:00"], {
    cwd: root,
    env: { ...process.env, GIT_COMMITTER_DATE: "2020-03-04T00:00:00" }
  });
  assert.equal(lastmodFor(file), "2020-03-04");
});

test("lastmodFor falls back to the file mtime when not in a git repo", () => {
  const root = fixture(); // a bare temp dir, no .git
  const file = path.join(root, "post.md");
  fs.writeFileSync(file, "# Post");
  const when = new Date("2019-05-06T10:00:00Z");
  fs.utimesSync(file, when, when);
  assert.equal(lastmodFor(file), "2019-05-06");
});

// --- BUILD INTEGRATION: the leak contract ----------------------------------

test("a draft with a date produces ZERO sitemap + ZERO rss entries in a production build", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/published.md",
    ["---", "title: Published", "date: 2026-06-20", "---", "", "Real post body."].join("\n")
  );
  write(
    root,
    "site/pages/secret.md",
    ["---", "title: Secret Draft", "date: 2026-06-21", "draft: true", "---", "", "Hidden."].join(
      "\n"
    )
  );

  const { distRoot, feeds } = buildSite(root);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");

  // The draft is absent from dist, routes.json, sitemap, AND rss.
  assert.equal(fs.existsSync(path.join(distRoot, "secret", "index.html")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "routes.json"), "utf8"));
  assert.equal(
    manifest.some((r) => r.route === "/secret/"),
    false
  );
  assert.doesNotMatch(sitemap, /secret/);
  assert.doesNotMatch(rss, /Secret Draft/);

  // The published post IS present in both.
  assert.match(sitemap, /<loc>https:\/\/example\.com\/published\/<\/loc>/);
  assert.match(rss, /<title>Published<\/title>/);
  // exactly one RSS post, and /404/ never appears in either feed
  assert.equal(feeds.rss, 1);
  assert.doesNotMatch(sitemap, /\/404\//);
  assert.doesNotMatch(rss, /\/404\//);
});

test("/404/ route is excluded from the sitemap and rss even when dated", () => {
  const root = fixture();
  siteWithUrl(root);
  // A dated 404 page (which would otherwise look like a post) plus a real post,
  // so rss.xml is actually emitted and we can assert the 404 is absent from it.
  write(
    root,
    "site/pages/404.md",
    ["---", "title: Not Found", "date: 2026-06-15", "---", "", "Gone."].join("\n")
  );
  write(
    root,
    "site/pages/real.md",
    ["---", "title: Real Post", "date: 2026-06-10", "---", "", "Body."].join("\n")
  );
  const { distRoot, feeds } = buildSite(root);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");
  // 404 is built (dist/404.html exists) but is never a feed entry, even dated.
  assert.equal(fs.existsSync(path.join(distRoot, "404.html")), true);
  assert.doesNotMatch(sitemap, /\/404\//);
  assert.doesNotMatch(rss, /Not Found/);
  // Only the real post is syndicated.
  assert.equal(feeds.rss, 1);
  assert.match(rss, /Real Post/);
});

test("--drafts / includeDrafts puts the draft back into dist, sitemap, and rss", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/secret.md",
    ["---", "title: Secret Draft", "date: 2026-06-21", "draft: true", "---", "", "Hidden."].join(
      "\n"
    )
  );
  const { distRoot, feeds } = buildSite(root, { includeDrafts: true });
  assert.equal(fs.existsSync(path.join(distRoot, "secret", "index.html")), true);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");
  assert.match(sitemap, /<loc>https:\/\/example\.com\/secret\/<\/loc>/);
  assert.match(rss, /<title>Secret Draft<\/title>/);
  assert.equal(feeds.rss, 1);
});

// --- BUILD INTEGRATION: lastmod sources ------------------------------------

test("sitemap <lastmod> uses frontmatter date when present, else the file fallback", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/dated.md",
    ["---", "title: Dated", "date: 2021-01-02", "---", "", "Body."].join("\n")
  );
  // A page with no `date:` — its lastmod comes from lastmodFor (mtime here, no .git)
  const undatedFile = path.join(root, "site/pages/plain.md");
  write(root, "site/pages/plain.md", ["---", "title: Plain", "---", "", "Body."].join("\n"));
  const when = new Date("2018-08-09T00:00:00Z");
  fs.utimesSync(undatedFile, when, when);

  const { distRoot } = buildSite(root);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  assert.match(
    sitemap,
    /<loc>https:\/\/example\.com\/dated\/<\/loc>\s*<lastmod>2021-01-02<\/lastmod>/
  );
  assert.match(
    sitemap,
    /<loc>https:\/\/example\.com\/plain\/<\/loc>\s*<lastmod>2018-08-09<\/lastmod>/
  );
});

// --- BUILD INTEGRATION: no site_url ----------------------------------------

test("without site_url: robots emits (no Sitemap line), feeds skipped with a hint", () => {
  const root = fixture();
  write(root, "site/pages/index.md", ["---", "title: No URL", "---", "", "# Home"].join("\n"));
  write(
    root,
    "site/pages/post.md",
    ["---", "title: Post", "date: 2026-06-10", "---", "", "Body."].join("\n")
  );

  /** @type {string[]} */
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let result;
  try {
    result = buildSite(root);
  } finally {
    console.warn = originalWarn;
  }

  const { distRoot, feeds } = result;
  assert.equal(fs.existsSync(path.join(distRoot, "sitemap.xml")), false);
  assert.equal(fs.existsSync(path.join(distRoot, "rss.xml")), false);
  assert.equal(feeds.sitemap, null);
  assert.equal(feeds.rss, null);
  // robots.txt is still written, without the Sitemap line
  const robots = fs.readFileSync(path.join(distRoot, "robots.txt"), "utf8");
  assert.equal(robots, "User-agent: *\nAllow: /\n");
  // a loud, actionable hint mentions site_url
  assert.ok(warnings.some((w) => /site_url/.test(w) && /sitemap\.xml \+ rss\.xml/.test(w)));
});

test("site_url set but NO dated post: sitemap emits, rss is skipped (no feed)", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/about.md",
    ["---", "title: About", "---", "", "No date here."].join("\n")
  );
  const { distRoot, feeds } = buildSite(root);
  // sitemap always emits with a site_url; rss only with a dated post
  assert.equal(fs.existsSync(path.join(distRoot, "sitemap.xml")), true);
  assert.ok(feeds.sitemap >= 2);
  // no dated post → rss is skipped entirely (null, not an empty 0-item feed)
  assert.equal(feeds.rss, null);
  assert.equal(fs.existsSync(path.join(distRoot, "rss.xml")), false);
  // with no rss.xml, pages do NOT advertise an alternate feed link
  const home = fs.readFileSync(path.join(distRoot, "index.html"), "utf8");
  assert.doesNotMatch(home, /rel="alternate"/);
});

// --- BUILD INTEGRATION: the discovery <link rel=alternate> -----------------

test("every page links the rss feed when one is emitted", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/post.md",
    ["---", "title: Post", "date: 2026-06-10", "---", "", "Body."].join("\n")
  );
  const { distRoot } = buildSite(root);
  for (const rel of ["index.html", path.join("post", "index.html")]) {
    const html = fs.readFileSync(path.join(distRoot, rel), "utf8");
    assert.match(
      html,
      /<link rel="alternate" type="application\/rss\+xml" title="My Blog" href="https:\/\/example\.com\/rss\.xml">/
    );
  }
});

// --- BUILD INTEGRATION: rss ordering, cap, and .wd vs .md description -------

test("rss orders posts newest-first, caps at the limit, and excludes undated pages", () => {
  const root = fixture();
  siteWithUrl(root);
  // Emit more dated posts than the cap, in non-sorted creation order.
  for (let i = 1; i <= RSS_ITEM_LIMIT + 5; i++) {
    const day = String(i).padStart(2, "0");
    write(
      root,
      `site/pages/p${day}.md`,
      ["---", `title: Post ${day}`, `date: 2026-05-${day}`, "---", "", `Body ${day}.`].join("\n")
    );
  }
  const { distRoot, feeds } = buildSite(root);
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");
  assert.equal(feeds.rss, RSS_ITEM_LIMIT);
  // newest first: the highest-numbered day appears before a lower one
  const titles = [...rss.matchAll(/<title>Post (\d+)<\/title>/g)].map((m) => Number(m[1]));
  assert.deepEqual(
    titles,
    [...titles].sort((a, b) => b - a)
  );
  assert.equal(titles[0], RSS_ITEM_LIMIT + 5);
});

test("a dated .wd post with no excerpt/description gets no rss description", () => {
  const root = fixture();
  siteWithUrl(root);
  write(
    root,
    "site/pages/widget.wd",
    ["---", "title: Widget", "date: 2026-06-09", "---", "", "Some prose."].join("\n")
  );
  const { distRoot } = buildSite(root);
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");
  const item = rss.slice(rss.indexOf("Widget"));
  // title/link/guid present, but no <description> synthesized from .wd prose
  assert.match(rss, /<title>Widget<\/title>/);
  assert.doesNotMatch(item.slice(0, item.indexOf("</item>")), /<description>/);
});

test("a dated post with no title falls back to Untitled", () => {
  const root = fixture();
  siteWithUrl(root);
  write(root, "site/pages/notitle.md", ["---", "date: 2026-06-08", "---", "", "Body."].join("\n"));
  const { distRoot } = buildSite(root);
  const rss = fs.readFileSync(path.join(distRoot, "rss.xml"), "utf8");
  assert.match(rss, /<title>Untitled<\/title>/);
});
