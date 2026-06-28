// ---------------------------------------------------------------------------
// Feeds & crawler files: sitemap.xml, rss.xml, robots.txt. All build-time only
// (zero runtime, zero client JS) and emitted from the post-draft-filter route
// list, so a `draft: true` page never reaches a feed. Site identity (origin,
// channel title/description) lives in the HOME page frontmatter (`site_url` +
// the existing `title`/`description`) — there is no config loader this cycle.
//
// Mirrors `src/highlight.js`: this module owns the strings; `src/builder.js`
// owns the emission. Pure string builders + a `lastmodFor(file)` with a
// git → mtime fallback so scaffolded apps / tarballs (no git repo) still date.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Join the site origin and a route path into one absolute URL, collapsing the
 * boundary slash so `https://x.com` + `/about/` → `https://x.com/about/` (the
 * home route `/` → `https://x.com/`). `siteUrl` is expected without a trailing
 * slash (the documented contract); a stray one is tolerated.
 * @param {string} siteUrl Absolute origin, e.g. `https://example.com`.
 * @param {string} route Route path (always trailing-slashed, e.g. `/about/`).
 * @returns {string}
 */
export function absoluteUrl(siteUrl, route) {
  return `${siteUrl.replace(/\/$/, "")}${route}`;
}

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
export function lastmodFor(file) {
  try {
    // `%cs` is the committer date in strict ISO short form (yyyy-mm-dd). `-1`
    // limits to the most recent commit touching this file. A file that is
    // tracked but never committed (or outside a repo) yields empty stdout.
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", path.basename(file)], {
      cwd: path.dirname(file),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (out) return out;
  } catch {
    /* not a git repo, or git unavailable — fall through to mtime */
  }
  return isoDate(fs.statSync(file).mtime);
}

/**
 * Format a `Date` as an ISO `yyyy-mm-dd` string (sitemap `<lastmod>` form).
 * @param {Date} date
 * @returns {string}
 */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

const RFC822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC822_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

/**
 * Format a frontmatter `date:` value as an RFC-822 date for an RSS `<pubDate>`
 * (e.g. `Sat, 28 Jun 2026 00:00:00 GMT`). Accepts anything `new Date` parses
 * (an ISO `yyyy-mm-dd`, a full timestamp); an unparseable value returns "" so
 * the caller can omit the element rather than emit `Invalid Date`.
 * @param {string} value Raw frontmatter date string.
 * @returns {string} RFC-822 date in GMT, or "" when unparseable.
 */
export function rfc822(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const day = RFC822_DAYS[date.getUTCDay()];
  const month = RFC822_MONTHS[date.getUTCMonth()];
  return (
    `${day}, ${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT`
  );
}

/**
 * Read a frontmatter field as a trimmed string, or "" when absent/non-string
 * (arrays, numbers, booleans don't belong in these single-value feed fields).
 * @param {import("./compiler.js").Meta} meta
 * @param {string} key
 * @returns {string}
 */
function metaString(meta, key) {
  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

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
export function firstParagraph(body) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  // A heading or fenced block isn't a description paragraph — bail to the
  // caller's next fallback rather than emit "# Title" or code as the summary.
  if (i >= lines.length || /^(#{1,6}\s|```|~~~|>|[-*+]\s|\d+\.\s)/.test(lines[i].trim())) return "";
  /** @type {string[]} */
  const collected = [];
  for (let j = i; j < lines.length && lines[j].trim(); j++) collected.push(lines[j].trim());
  return collected
    .join(" ")
    .replace(/`([^`]+)`/g, "$1") // inline code → its text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italic
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\s+/g, " ")
    .trim();
}

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
export function rssDescription(meta, file, body) {
  const excerpt = metaString(meta, "excerpt");
  if (excerpt) return excerpt;
  const description = metaString(meta, "description");
  if (description) return description;
  if (path.extname(file) === ".md") return firstParagraph(body);
  return "";
}

/**
 * Build `sitemap.xml` from the emitted (post-draft-filter) routes. One `<url>`
 * per route — reactive pages included (they're indexable HTML) — with `<loc>` =
 * `site_url` + path and `<lastmod>` from the supplied date. The `/404/` route is
 * excluded by the caller before this point. No `<priority>`/`<changefreq>` —
 * Google ignores them and they invite bit-rot.
 * @param {DatedRoute[]} entries Absolute loc + ISO lastmod, in route order.
 * @returns {string} The full XML document (trailing newline).
 */
export function buildSitemap(entries) {
  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n` +
        `    <lastmod>${entry.lastmod}</lastmod>\n  </url>`
    )
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n</urlset>\n`
  );
}

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
export function buildRss(channel, items) {
  const entries = items.map((item) => {
    const parts = [
      `      <title>${escapeXml(item.title)}</title>`,
      `      <link>${escapeXml(item.link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`
    ];
    if (item.pubDate) parts.push(`      <pubDate>${item.pubDate}</pubDate>`);
    if (item.description)
      parts.push(`      <description>${escapeXml(item.description)}</description>`);
    return `    <item>\n${parts.join("\n")}\n    </item>`;
  });
  const channelLines = [
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(channel.siteUrl)}</link>`,
    `    <description>${escapeXml(channel.description)}</description>`,
    `    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...entries
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    "  <channel>\n" +
    `${channelLines.join("\n")}\n` +
    "  </channel>\n</rss>\n"
  );
}

/**
 * Build `robots.txt`. Always allows everything (hidden/draft routes are never
 * built, so there's nothing to `Disallow`). The `Sitemap:` line is included
 * ONLY when `siteUrl` is set — a sitemap URL is only meaningful with an origin.
 * @param {string} [siteUrl] Absolute origin, or "" / undefined to omit the line.
 * @returns {string} The robots.txt body (trailing newline).
 */
export function buildRobots(siteUrl) {
  const lines = ["User-agent: *", "Allow: /"];
  if (siteUrl) lines.push(`Sitemap: ${absoluteUrl(siteUrl, "/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
}

/** Most-recent-first RSS post cap — a feed is a recent window, not an archive. */
export const RSS_ITEM_LIMIT = 20;
