// ---------------------------------------------------------------------------
// Technical SEO in the page shell: canonical URLs, og:url, and the opt-in
// `schema:` JSON-LD block (plus the automatic BreadcrumbList).
//
// The headline contracts:
//   * one canonical URL FORM, agreed on by the canonical tag, og:url, and the
//     sitemap. They are all built from the same route string, so they cannot
//     drift apart into the "every internal link redirects" state,
//   * a paginated page canonicalises to ITSELF, never to page one,
//   * structured data only ever states what the page actually carries, and
//   * none of it makes a static page reactive or adds a runtime byte.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-seo-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Frontmatter + body helper. */
function page(meta, body = "# Page\n") {
  return `---\n${meta.join("\n")}\n---\n\n${body}`;
}

/** Compile one page directly, with an optional `site` context. */
function compile(source, site) {
  const root = fixture();
  write(root, "site/pages/index.wd", source);
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), { site });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Parse the page's JSON-LD payload (asserts exactly one script is present). */
function jsonLd(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, `expected one JSON-LD block, saw ${matches.length}`);
  return JSON.parse(matches[0][1]);
}

// --- canonical + og:url ----------------------------------------------------

test("no site context means no canonical: a page never invents an origin", () => {
  const html = compile(page(["title: Solo", "description: A page"])).html;
  assert.doesNotMatch(html, /rel="canonical"/);
  assert.doesNotMatch(html, /og:url/);
});

test("a site context emits canonical and og:url from the same derivation", () => {
  const html = compile(page(["title: Docs", "description: Learn it"]), {
    url: "https://example.com",
    route: "/docs/"
  }).html;
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/docs\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/example\.com\/docs\/">/);
});

test("a trailing slash on site_url does not double up in the canonical", () => {
  const html = compile(page(["title: Home"]), { url: "https://example.com/", route: "/" }).html;
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/">/);
});

test("the canonical URL is HTML-escaped", () => {
  const html = compile(page(["title: Q"]), {
    url: "https://example.com",
    route: '/a"b/'
  }).html;
  assert.match(html, /href="https:\/\/example\.com\/a&quot;b\/"/);
});

test("a canonical alone is enough to emit a complete card (no description, no image)", () => {
  // Before, og:title was gated on description-or-image, so a titled page with
  // neither got no Open Graph title at all and shared as a bare URL.
  const html = compile(page(["title: Bare"]), { url: "https://x.com", route: "/bare/" }).html;
  assert.match(html, /<meta property="og:title" content="Bare">/);
  assert.match(html, /<meta name="twitter:card" content="summary">/);
});

test("og:type is article for a dated page and website otherwise", () => {
  const post = compile(page(["title: Post", "description: d", "date: 2026-08-09"])).html;
  assert.match(post, /<meta property="og:type" content="article">/);
  const plain = compile(page(["title: Plain", "description: d"])).html;
  assert.match(plain, /<meta property="og:type" content="website">/);
});

test("an article schema also makes og:type article, with no date", () => {
  const html = compile(page(["title: Ref", "description: d", "schema: TechArticle"])).html;
  assert.match(html, /<meta property="og:type" content="article">/);
});

test("no twitter:title or twitter:description: X falls back to the og tags", () => {
  const html = compile(page(["title: T", "description: D", "image: https://x.com/og.png"])).html;
  assert.doesNotMatch(html, /twitter:title/);
  assert.doesNotMatch(html, /twitter:description/);
  // twitter:card has no Open Graph equivalent, so it IS stated.
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
});

// --- structured data: only what the page contains --------------------------

test("no schema: frontmatter means no JSON-LD at all", () => {
  const html = compile(page(["title: Plain", "description: d"])).html;
  assert.doesNotMatch(html, /application\/ld\+json/);
});

test("an article node is built from the page's own frontmatter", () => {
  const html = compile(
    page([
      "title: Shipping feeds",
      "description: One field turns on the feeds.",
      "image: https://example.com/og.png",
      "date: 2026-06-28",
      "updated: 2026-08-01",
      "author: Ada Lovelace",
      "lang: en-GB",
      "schema: BlogPosting"
    ]),
    { url: "https://example.com", route: "/blog/feeds/" }
  ).html;
  assert.deepEqual(jsonLd(html), {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Shipping feeds",
    description: "One field turns on the feeds.",
    image: "https://example.com/og.png",
    datePublished: "2026-06-28",
    dateModified: "2026-08-01",
    author: { "@type": "Person", name: "Ada Lovelace" },
    inLanguage: "en-GB",
    url: "https://example.com/blog/feeds/",
    mainEntityOfPage: "https://example.com/blog/feeds/"
  });
});

test("dateModified falls back to the publication date, never to 'now'", () => {
  const node = jsonLd(compile(page(["title: P", "date: 2026-01-02", "schema: Article"])).html);
  assert.equal(node.dateModified, "2026-01-02");
});

test("absent frontmatter produces absent properties, not empty ones", () => {
  const node = jsonLd(compile(page(["title: Minimal", "schema: Article"])).html);
  assert.deepEqual(Object.keys(node), ["@context", "@type", "headline", "inLanguage"]);
});

test("a list of authors becomes a list of Persons; a blank list is omitted", () => {
  const many = jsonLd(compile(page(["title: P", "schema: Article", "author: [Ada, Grace]"])).html);
  assert.deepEqual(many.author, [
    { "@type": "Person", name: "Ada" },
    { "@type": "Person", name: "Grace" }
  ]);
  const none = jsonLd(compile(page(["title: P", "schema: Article", "author: []"])).html);
  assert.equal("author" in none, false);
});

test("WebSite and Organization describe a home page, as one array in one script", () => {
  const html = compile(
    page([
      "title: Darkmown",
      "description: Markdown that runs.",
      "organization: ZVN",
      "logo: https://example.com/logo.png",
      "schema: [WebSite, Organization]"
    ]),
    { url: "https://example.com", route: "/" }
  ).html;
  assert.deepEqual(jsonLd(html), [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Darkmown",
      description: "Markdown that runs.",
      inLanguage: "en",
      url: "https://example.com/"
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "ZVN",
      description: "Markdown that runs.",
      logo: "https://example.com/logo.png",
      url: "https://example.com/"
    }
  ]);
});

test("an Organization with no `organization:` falls back to the page title", () => {
  const node = jsonLd(compile(page(["title: Acme", "schema: Organization"])).html);
  assert.equal(node.name, "Acme");
});

test("no rating, review, or offer markup is reachable from any schema type", () => {
  // Fabricated social proof is a documented manual-action risk, so there is
  // deliberately no frontmatter key that can produce it. This is the guard that
  // keeps a future well-meaning addition honest.
  for (const type of ["Article", "BlogPosting", "TechArticle", "WebSite", "Organization"]) {
    const html = compile(
      page([
        "title: T",
        "description: D",
        `schema: ${type}`,
        // Keys that would be the obvious hooks for fabricated markup.
        "rating: 5",
        "aggregateRating: 4.9",
        "reviewCount: 1200",
        "price: 0"
      ])
    ).html;
    assert.doesNotMatch(html, /aggregateRating|"review"|ratingValue|"offers"/i, `${type} leaked`);
  }
});

test("an unknown schema type is a compile error that names every valid type", () => {
  let err;
  try {
    compile(page(["title: T", "schema: Recipe"]));
  } catch (e) {
    err = e;
  }
  assert.ok(err, "an unknown schema type must not be silently ignored");
  assert.equal(err.wd.code, "WD016");
  assert.match(err.message, /Unknown schema type "Recipe"/);
  assert.match(err.message, /Article, BlogPosting, TechArticle, WebSite, Organization/);
  assert.match(err.message, /index\.wd/);
});

test("FAQPage is rejected: Darkmown will not guess a Q&A structure out of prose", () => {
  let err;
  try {
    compile(page(["title: T", "schema: FAQPage"], "## Is this a question?\n\nYes.\n"));
  } catch (e) {
    err = e;
  }
  assert.ok(err, "FAQPage must not be silently accepted");
  assert.equal(err.wd.code, "WD016");
});

test("a `</script>` in frontmatter cannot break out of the JSON-LD block", () => {
  const html = compile(page(["title: Bad </script><script>x", "schema: Article"])).html;
  assert.doesNotMatch(html, /<\/script><script>x/);
  assert.equal(jsonLd(html).headline, "Bad </script><script>x");
});

// --- breadcrumbs: derived from routes that exist ---------------------------

/** A site with a nested route whose intermediate directory has no page. */
function nestedSite(root) {
  write(
    root,
    "site/pages/index.md",
    page(["title: Home", "description: Root", "site_url: https://example.com"])
  );
  write(root, "site/pages/docs/index.md", page(["title: Docs"]));
  write(root, "site/pages/docs/api/index.md", page(["title: API reference"]));
  // `/vs/` has no page of its own: only `/vs/markdoc/` exists.
  write(root, "site/pages/vs/markdoc.md", page(["title: vs Markdoc"]));
}

test("a nested route gets a BreadcrumbList of routes that actually exist", () => {
  const root = fixture();
  nestedSite(root);
  const { distRoot } = buildSite(root);
  const node = jsonLd(fs.readFileSync(path.join(distRoot, "docs/api/index.html"), "utf8"));
  assert.deepEqual(node, {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
      { "@type": "ListItem", position: 2, name: "Docs", item: "https://example.com/docs/" },
      {
        "@type": "ListItem",
        position: 3,
        name: "API reference",
        item: "https://example.com/docs/api/"
      }
    ]
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("an intermediate route with no page is skipped, never linked into a 404", () => {
  const root = fixture();
  nestedSite(root);
  const { distRoot } = buildSite(root);
  const node = jsonLd(fs.readFileSync(path.join(distRoot, "vs/markdoc/index.html"), "utf8"));
  assert.deepEqual(
    node.itemListElement.map((item) => item.item),
    ["https://example.com/", "https://example.com/vs/markdoc/"]
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("a top-level page gets no breadcrumbs (Home > this page restates the page)", () => {
  const root = fixture();
  nestedSite(root);
  const { distRoot } = buildSite(root);
  const html = fs.readFileSync(path.join(distRoot, "docs/index.html"), "utf8");
  assert.doesNotMatch(html, /BreadcrumbList/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("with no site_url there are no breadcrumbs: a crumb needs an absolute URL", () => {
  const root = fixture();
  write(root, "site/pages/index.md", page(["title: Home"]));
  write(root, "site/pages/docs/api/index.md", page(["title: API"]));
  const { distRoot } = buildSite(root);
  const html = fs.readFileSync(path.join(distRoot, "docs/api/index.html"), "utf8");
  assert.doesNotMatch(html, /application\/ld\+json/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a page schema and breadcrumbs share one script, as a JSON array", () => {
  const root = fixture();
  nestedSite(root);
  write(
    root,
    "site/pages/docs/api/index.md",
    page(["title: API reference", "schema: TechArticle"])
  );
  const { distRoot } = buildSite(root);
  const nodes = jsonLd(fs.readFileSync(path.join(distRoot, "docs/api/index.html"), "utf8"));
  assert.deepEqual(
    nodes.map((node) => node["@type"]),
    ["TechArticle", "BreadcrumbList"]
  );
  fs.rmSync(root, { recursive: true, force: true });
});

// --- the whole-site contract -----------------------------------------------

test("canonical, og:url, and the sitemap agree on one URL form for every route", () => {
  // This is the bug the trailing-slash decision exists to prevent: a sitemap
  // advertising `/docs/` while the canonical tag claims `/docs` (or the reverse)
  // asks the crawler to resolve a contradiction on every page of the site.
  const root = fixture();
  nestedSite(root);
  const { distRoot, routes } = buildSite(root);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  for (const route of routes) {
    const html = fs.readFileSync(path.join(distRoot, route.route.slice(1), "index.html"), "utf8");
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
    assert.ok(canonical, `${route.route} has no canonical URL`);
    assert.equal(
      html.match(/<meta property="og:url" content="([^"]+)">/)?.[1],
      canonical,
      `${route.route}: og:url disagrees with the canonical tag`
    );
    assert.ok(locs.includes(canonical), `${route.route}: the sitemap does not list ${canonical}`);
  }
  assert.equal(locs.length, routes.length);
  fs.rmSync(root, { recursive: true, force: true });
});

test("every canonical URL is trailing-slashed, matching the routes the build writes", () => {
  const root = fixture();
  nestedSite(root);
  const { distRoot } = buildSite(root);
  const sitemap = fs.readFileSync(path.join(distRoot, "sitemap.xml"), "utf8");
  for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    assert.match(loc, /\/$/, `${loc} is not trailing-slashed`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("a paginated page canonicalises to itself, not to page one", () => {
  // Pointing pages 2..N at page 1 would ask Google to drop them from the index,
  // taking every post they link with them.
  const root = fixture();
  write(
    root,
    "site/pages/index.md",
    page(["title: Home", "site_url: https://example.com", "description: Root"])
  );
  for (const n of [1, 2, 3, 4]) {
    write(root, `site/pages/posts/post-${n}.md`, page([`title: Post ${n}`, `date: 2026-0${n}-01`]));
  }
  write(
    root,
    "site/pages/posts/index.wd",
    "---\ntitle: Posts\n---\n\n@loop posts into p paginate 2\n- { p.title }\n@endloop\n"
  );
  const { distRoot } = buildSite(root);

  const first = fs.readFileSync(path.join(distRoot, "posts/index.html"), "utf8");
  const second = fs.readFileSync(path.join(distRoot, "posts/page/2/index.html"), "utf8");
  assert.match(first, /<link rel="canonical" href="https:\/\/example\.com\/posts\/">/);
  assert.match(second, /<link rel="canonical" href="https:\/\/example\.com\/posts\/page\/2\/">/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("none of the SEO layer makes a static page reactive or ships a byte of JS", () => {
  const root = fixture();
  nestedSite(root);
  write(
    root,
    "site/pages/docs/api/index.md",
    page(["title: API reference", "schema: TechArticle", "author: Ada"])
  );
  const { distRoot, routes } = buildSite(root);
  for (const route of routes) {
    assert.equal(route.assets.runtime, false, `${route.route} went reactive`);
    assert.deepEqual(route.assets.scripts, [], `${route.route} ships a script`);
  }
  const html = fs.readFileSync(path.join(distRoot, "docs/api/index.html"), "utf8");
  // The only <script> on the page is the inert JSON-LD data block.
  const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, [' type="application/ld+json"']);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a .md page gets the full SEO shell without gaining directive behavior", () => {
  // The `.md` gate is about DIRECTIVES. Frontmatter-driven head metadata has
  // always applied to both formats, and structured data is head metadata.
  const root = fixture();
  write(
    root,
    "site/pages/index.md",
    page(["title: Home", "site_url: https://example.com", "description: Root"])
  );
  write(
    root,
    "site/pages/note/index.md",
    page(["title: Note", "schema: Article"], ":state count = 0\n\nBody.\n")
  );
  const { distRoot } = buildSite(root);
  const html = fs.readFileSync(path.join(distRoot, "note/index.html"), "utf8");
  assert.equal(jsonLd(html)["@type"], "Article");
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/note\/">/);
  // The directive stayed inert text, exactly as in any other .md file.
  assert.match(html, /:state count = 0/);
  fs.rmSync(root, { recursive: true, force: true });
});
