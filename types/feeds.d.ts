/**
 * @typedef {import("./router.js").Route} Route
 */
/**
 * A route paired with its source file's last-modified date (ISO yyyy-mm-dd),
 * ready for a sitemap `<lastmod>`.
 * @typedef {object} DatedRoute
 * @property {string} loc Absolute URL (`site_url` + route path).
 * @property {string} lastmod ISO date (`yyyy-mm-dd`).
 */
/**
 * XML-escape a text value for use inside an element or attribute. Covers the
 * five predefined XML entities — the same set RSS/sitemap consumers expect.
 * @param {string} value
 * @returns {string}
 */
export function escapeXml(value: string): string;
/**
 * Join the site origin and a route path into one absolute URL, collapsing the
 * boundary slash so `https://x.com` + `/about/` → `https://x.com/about/` (the
 * home route `/` → `https://x.com/`). `siteUrl` is expected without a trailing
 * slash (the documented contract); a stray one is tolerated.
 * @param {string} siteUrl Absolute origin, e.g. `https://example.com`.
 * @param {string} route Route path (always trailing-slashed, e.g. `/about/`).
 * @returns {string}
 */
export function absoluteUrl(siteUrl: string, route: string): string;
/**
 * The last-modified date for a source file, as an ISO `yyyy-mm-dd` string.
 * Resolution order: the file's frontmatter `date:` is handled by the caller
 * (it wins); this helper covers the fallback chain — the git last-commit date
 * of the file, else the filesystem mtime. Git is wrapped in try/catch so a
 * scaffolded app or an extracted tarball (no `.git`) degrades to mtime instead
 * of crashing the build.
 * @param {string} file Absolute path to the source file.
 * @returns {string} ISO date (`yyyy-mm-dd`).
 */
export function lastmodFor(file: string): string;
/**
 * Format a `Date` as an ISO `yyyy-mm-dd` string (sitemap `<lastmod>` form).
 * @param {Date} date
 * @returns {string}
 */
export function isoDate(date: Date): string;
/**
 * Format a frontmatter `date:` value as an RFC-822 date for an RSS `<pubDate>`
 * (e.g. `Sat, 28 Jun 2026 00:00:00 GMT`). Accepts anything `new Date` parses
 * (an ISO `yyyy-mm-dd`, a full timestamp); an unparseable value returns "" so
 * the caller can omit the element rather than emit `Invalid Date`.
 * @param {string} value Raw frontmatter date string.
 * @returns {string} RFC-822 date in GMT, or "" when unparseable.
 */
export function rfc822(value: string): string;
/**
 * Extract the first paragraph of a plain-`.md` body as a single-line snippet —
 * the RSS description fallback when a `.md` post has neither `excerpt:` nor
 * `description:`. Deliberately dumb: skip leading blank/frontmatter-less lines,
 * take the first run of non-blank prose, strip the most common inline markdown
 * (heading marks, emphasis, inline-code, links → their text), and collapse
 * whitespace. Returns "" when the body is empty or starts with a non-prose
 * block (a fence/heading-only doc) — the caller then falls back further.
 * @param {string} body The post-frontmatter markdown body.
 * @returns {string}
 */
export function firstParagraph(body: string): string;
/**
 * The RSS `<description>` for a post: explicit `excerpt:` wins, else the source
 * `description:`, else (plain `.md` only) the first rendered paragraph. `.wd`
 * bodies are NOT scanned for a first paragraph — stripping reactive/directive
 * markup back to clean prose is not worth the fragility, so a `.wd` post without
 * `excerpt`/`description` simply gets no description.
 * @param {import("./compiler.js").Meta} meta
 * @param {string} file Absolute source path (its extension gates `.md` scanning).
 * @param {string} body The post-frontmatter body.
 * @returns {string}
 */
export function rssDescription(meta: import("./compiler.js").Meta, file: string, body: string): string;
/**
 * Validate a frontmatter `date:` into a sitemap `<lastmod>` value, or "" when it
 * is not one.
 *
 * This is the only feed value that used to be neither validated nor escaped, and
 * both halves mattered: `date: 2026<bad&"q"` made the whole document
 * unparseable, so NOTHING got indexed, and the far likelier `date: Jan 5, 2026`
 * was silently truncated to `Jan 5, 202` by a blind 10-character slice. Returning
 * "" (rather than guessing) lets the caller omit the element and say so — a
 * sitemap entry with no `<lastmod>` is valid; one with a bogus date is not.
 * @param {string} raw Trimmed frontmatter `date:` value.
 * @returns {string} `yyyy-mm-dd`, or "" when `raw` is not a real calendar date.
 */
export function sitemapDate(raw: string): string;
/**
 * Build `sitemap.xml` from the emitted (post-draft-filter) routes. One `<url>`
 * per route — reactive pages included (they're indexable HTML) — with `<loc>` =
 * `site_url` + path and `<lastmod>` from the supplied date. An empty `lastmod`
 * omits the element rather than emitting a blank one. The `/404/` route is
 * excluded by the caller before this point. No `<priority>`/`<changefreq>` —
 * Google ignores them and they invite bit-rot.
 * @param {DatedRoute[]} entries Absolute loc + ISO lastmod, in route order.
 * @returns {string} The full XML document (trailing newline).
 */
export function buildSitemap(entries: DatedRoute[]): string;
/**
 * Build a `<sitemapindex>` — the document that points at the numbered sitemap
 * shards. No `<lastmod>` per shard: it would have to be the max over the shard's
 * entries, which is a number nobody consumes and one more thing to keep true.
 * @param {string[]} locs Absolute URLs of the shard files, in order.
 * @returns {string} The full XML document (trailing newline).
 */
export function buildSitemapIndex(locs: string[]): string;
/**
 * Plan the sitemap file(s) a set of entries needs.
 *
 * At or under {@link SITEMAP_URL_LIMIT} that is one `sitemap.xml`, byte-identical
 * to what every site got before. Over it, the entries shard into
 * `sitemap-1.xml`, `sitemap-2.xml`, … and `sitemap.xml` becomes the
 * `<sitemapindex>` pointing at them — so `robots.txt` keeps naming
 * `/sitemap.xml` and every existing submission stays valid.
 *
 * Returned rather than written so the split is a pure function the tests can
 * drive with 50,001 synthetic entries without building 50,001 pages.
 * @param {DatedRoute[]} entries
 * @param {string} siteUrl Absolute origin, for the index's shard URLs.
 * @returns {{ file: string, xml: string }[]} Shards first, `sitemap.xml` last.
 */
export function sitemapDocuments(entries: DatedRoute[], siteUrl: string): {
    file: string;
    xml: string;
}[];
/**
 * An RSS item — a dated post in feed order.
 * @typedef {object} RssItem
 * @property {string} title
 * @property {string} link Absolute URL (also used as the `<guid>`).
 * @property {string} pubDate RFC-822 date, or "" to omit.
 * @property {string} description
 */
/**
 * Build `rss.xml` (RSS 2.0) for the dated posts. The caller selects, sorts
 * (date desc), and caps the items; this builder just renders. Channel `<title>`
 * / `<description>` come from the home frontmatter; `<link>` is the site origin
 * and the `<atom:link rel="self">` points at the feed itself (RSS best practice).
 * @param {{ title: string, description: string, siteUrl: string, feedUrl: string }} channel
 * @param {RssItem[]} items
 * @returns {string} The full XML document (trailing newline).
 */
export function buildRss(channel: {
    title: string;
    description: string;
    siteUrl: string;
    feedUrl: string;
}, items: RssItem[]): string;
/**
 * Build `robots.txt`. The wildcard group always allows everything (hidden/draft
 * routes are never built, so there's nothing to `Disallow`), then every
 * {@link AI_CRAWLERS} token is named explicitly with the site's declared policy.
 * The `Sitemap:` line is included ONLY when `siteUrl` is set: a sitemap URL is
 * only meaningful with an origin.
 * @param {string} [siteUrl] Absolute origin, or "" / undefined to omit the line.
 * @param {string} [policy] `"allow"` (default) or `"deny"`, from the home page's
 *   `ai_crawlers:` frontmatter. Validated by the caller ({@link aiCrawlerPolicy}).
 * @returns {string} The robots.txt body (trailing newline).
 */
export function buildRobots(siteUrl?: string, policy?: string): string;
/**
 * Validate the home page's `ai_crawlers:` frontmatter into a policy string.
 * Absent means `allow` (the status quo the wildcard group already grants). A
 * value that is neither `allow` nor `deny` throws rather than defaulting: the
 * likely intent behind a typo like `ai_crawlers: block` is to opt OUT, and
 * silently allowing instead would be exactly the wrong failure direction.
 * @param {import("./compiler.js").Meta} meta Home page frontmatter.
 * @param {string} [file] Home page source path, for the error message.
 * @returns {string} One of {@link AI_CRAWLER_POLICIES}.
 */
export function aiCrawlerPolicy(meta: import("./compiler.js").Meta, file?: string): string;
/**
 * Resolve the site's RSS item cap from the HOME page's `rss_limit:` frontmatter.
 *
 * Darkmown has no config file by design: site-wide settings live in the home
 * page's frontmatter next to `site_url` / `ai_crawlers`, and this is one of them.
 * Absent means {@link RSS_ITEM_LIMIT}. A value that is not a positive integer
 * THROWS rather than silently falling back, for the same reason `ai_crawlers`
 * does: `rss_limit: 0` and `rss_limit: all` are both attempts to state a policy,
 * and quietly publishing 20 items instead is the wrong failure direction.
 * @param {import("./compiler.js").Meta} meta Home page frontmatter.
 * @param {string} [file] Home page source path, for the error message.
 * @returns {number} A positive integer.
 */
export function rssItemLimit(meta: import("./compiler.js").Meta, file?: string): number;
/**
 * The sitemap protocol's hard cap: 50,000 `<url>` entries per sitemap file. Over
 * it, Google rejects the document outright — so a large site must split into
 * numbered sitemaps behind a `<sitemapindex>`.
 */
export const SITEMAP_URL_LIMIT: 50000;
/**
 * The AI crawler and answer-engine robots.txt tokens Darkmown names explicitly.
 *
 * EVERY token here is copied from its own operator's published documentation
 * (checked 2026-08-09): none are guessed, inferred from a log, or carried over
 * from a third-party list. A wrong token is worse than a missing one: it looks
 * like a policy the site is stating and is silently ignored by everybody.
 *
 * `Allow: /` for these is not a permission change (the `User-agent: *` group
 * already allows them); it is an explicit, machine-readable statement of intent,
 * which is what a publisher wants when the goal is to BE cited by answer engines.
 * The same list is what `ai_crawlers: deny` turns into `Disallow: /`, which is
 * the only form that actually changes anything.
 *
 * The `note` is written into the generated file next to the group. Search
 * crawling, model training, and live user-triggered fetches are DIFFERENT
 * permissions from the same operator, and a future reader editing robots.txt by
 * hand needs to see that before collapsing a group.
 * @type {{ operator: string, docs: string, note: string, agents: string[] }[]}
 */
export const AI_CRAWLERS: {
    operator: string;
    docs: string;
    note: string;
    agents: string[];
}[];
/** The accepted `ai_crawlers:` frontmatter values. */
export const AI_CRAWLER_POLICIES: string[];
/**
 * The DEFAULT most-recent-first RSS post cap — a feed is a recent window, not an
 * archive. Overridable per site with `rss_limit:` on the home page
 * ({@link rssItemLimit}).
 */
export const RSS_ITEM_LIMIT: 20;
export type Route = import("./router.js").Route;
/**
 * A route paired with its source file's last-modified date (ISO yyyy-mm-dd),
 * ready for a sitemap `<lastmod>`.
 */
export type DatedRoute = {
    /**
     * Absolute URL (`site_url` + route path).
     */
    loc: string;
    /**
     * ISO date (`yyyy-mm-dd`).
     */
    lastmod: string;
};
/**
 * An RSS item — a dated post in feed order.
 */
export type RssItem = {
    title: string;
    /**
     * Absolute URL (also used as the `<guid>`).
     */
    link: string;
    /**
     * RFC-822 date, or "" to omit.
     */
    pubDate: string;
    description: string;
};
