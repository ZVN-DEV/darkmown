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
import { wdError } from "./compiler/context.js";

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
 * The `<lastmod>` form the sitemap protocol accepts: W3C Datetime, of which
 * `yyyy-mm-dd` is the shortest legal spelling. Anchored at the start so a full
 * ISO timestamp (`2026-01-05T10:00:00Z`) matches on its date half.
 */
const W3C_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
export function sitemapDate(raw) {
  const day = String(raw ?? "")
    .trim()
    .slice(0, 10);
  if (!W3C_DATE.test(day)) return "";
  // The shape is right; is it a real day? `new Date("2026-02-30")` does NOT
  // throw — V8 rolls it forward to March 2 — so the only honest check is a round
  // trip: a genuine calendar date formats back to the string it came from.
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
}

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
export function buildSitemap(entries) {
  const urls = entries
    .map((entry) => {
      const lines = ["  <url>", `    <loc>${escapeXml(entry.loc)}</loc>`];
      // Escaped even though `sitemapDate` already guarantees a safe value:
      // this builder is exported and called directly, so the guarantee has to
      // live where the string is written, not only in one caller.
      if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      lines.push("  </url>");
      return lines.join("\n");
    })
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n</urlset>\n`
  );
}

/**
 * The sitemap protocol's hard cap: 50,000 `<url>` entries per sitemap file. Over
 * it, Google rejects the document outright — so a large site must split into
 * numbered sitemaps behind a `<sitemapindex>`.
 */
export const SITEMAP_URL_LIMIT = 50000;

/**
 * Build a `<sitemapindex>` — the document that points at the numbered sitemap
 * shards. No `<lastmod>` per shard: it would have to be the max over the shard's
 * entries, which is a number nobody consumes and one more thing to keep true.
 * @param {string[]} locs Absolute URLs of the shard files, in order.
 * @returns {string} The full XML document (trailing newline).
 */
export function buildSitemapIndex(locs) {
  const entries = locs
    .map((loc) => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries}\n</sitemapindex>\n`
  );
}

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
export function sitemapDocuments(entries, siteUrl) {
  if (entries.length <= SITEMAP_URL_LIMIT) {
    return [{ file: "sitemap.xml", xml: buildSitemap(entries) }];
  }
  /** @type {{ file: string, xml: string }[]} */
  const shards = [];
  for (let i = 0; i < entries.length; i += SITEMAP_URL_LIMIT) {
    shards.push({
      file: `sitemap-${shards.length + 1}.xml`,
      xml: buildSitemap(entries.slice(i, i + SITEMAP_URL_LIMIT))
    });
  }
  return [
    ...shards,
    {
      file: "sitemap.xml",
      xml: buildSitemapIndex(shards.map((shard) => absoluteUrl(siteUrl, `/${shard.file}`)))
    }
  ];
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
export const AI_CRAWLERS = [
  {
    operator: "OpenAI",
    docs: "https://developers.openai.com/api/docs/bots",
    // Three DIFFERENT crawlers, and collapsing them loses the distinction that
    // matters: OAI-SearchBot is the one that decides whether pages can be
    // crawled for ChatGPT Search summaries and citations, GPTBot governs
    // potential model-training access, and ChatGPT-User is a live fetch made
    // because a user asked. A publisher who wants citations but not training
    // allows OAI-SearchBot and disallows GPTBot.
    note: "OAI-SearchBot = ChatGPT Search crawling and citations. GPTBot = potential model training. ChatGPT-User = a live fetch on a user's request. Different crawlers, different purposes.",
    agents: ["OAI-SearchBot", "GPTBot", "ChatGPT-User"]
  },
  {
    operator: "Anthropic",
    docs: "https://support.claude.com/en/articles/8896518",
    note: "Claude-SearchBot = search indexing. ClaudeBot = training. Claude-User = a live fetch on a user's request.",
    agents: ["Claude-SearchBot", "ClaudeBot", "Claude-User"]
  },
  {
    operator: "Google",
    docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
    note: "A control token, not a crawler: it governs Gemini training and grounding only, and never affects Google Search ranking or inclusion.",
    agents: ["Google-Extended"]
  },
  {
    operator: "Apple",
    docs: "https://support.apple.com/en-us/119829",
    note: "A control token, not a crawler: it governs Apple foundation-model training only. Applebot itself is covered by the wildcard group above.",
    agents: ["Applebot-Extended"]
  },
  {
    operator: "Perplexity",
    docs: "https://docs.perplexity.ai/guides/bots",
    note: "PerplexityBot is a search-index crawler that Perplexity states is not used for foundation-model training. Perplexity-User is a live fetch on a user's request.",
    agents: ["PerplexityBot", "Perplexity-User"]
  },
  {
    operator: "Meta",
    docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/",
    note: "Crawls for Meta AI training.",
    agents: ["meta-externalagent"]
  },
  {
    operator: "Mistral",
    docs: "https://docs.mistral.ai/robots/",
    note: "MistralAI-Index = search indexing. MistralAI-Training = model training. MistralAI-User = a live fetch on a user's request.",
    agents: ["MistralAI-Index", "MistralAI-Training", "MistralAI-User"]
  },
  {
    operator: "Amazon",
    docs: "https://developer.amazon.com/amazonbot",
    note: "Crawls to improve Alexa and Amazon services.",
    agents: ["Amazonbot"]
  },
  {
    operator: "Common Crawl",
    docs: "https://commoncrawl.org/ccbot",
    note: "Builds the open web corpus most public model training starts from.",
    agents: ["CCBot"]
  }
];

/** The accepted `ai_crawlers:` frontmatter values. */
export const AI_CRAWLER_POLICIES = ["allow", "deny"];

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
export function buildRobots(siteUrl, policy = "allow") {
  const rule = policy === "deny" ? "Disallow: /" : "Allow: /";
  const lines = ["User-agent: *", "Allow: /"];
  for (const crawler of AI_CRAWLERS) {
    lines.push("", `# ${crawler.operator}: ${crawler.docs}`);
    lines.push(`# ${crawler.note}`);
    for (const agent of crawler.agents) lines.push(`User-agent: ${agent}`);
    lines.push(rule);
  }
  if (siteUrl) lines.push("", `Sitemap: ${absoluteUrl(siteUrl, "/sitemap.xml")}`);
  return `${lines.join("\n")}\n`;
}

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
export function aiCrawlerPolicy(meta, file) {
  const raw = meta.ai_crawlers;
  if (raw === undefined) return "allow";
  const value = String(raw).trim().toLowerCase();
  if (AI_CRAWLER_POLICIES.includes(value)) return value;
  const hint = `ai_crawlers: ${AI_CRAWLER_POLICIES.join(" or ")}`;
  throw wdError(
    `Unknown ai_crawlers value "${String(raw).trim()}"${file ? ` in ${file}` : ""}. Use: ${hint}.`,
    { code: "WD907", file, hint }
  );
}

/**
 * The DEFAULT most-recent-first RSS post cap — a feed is a recent window, not an
 * archive. Overridable per site with `rss_limit:` on the home page
 * ({@link rssItemLimit}).
 */
export const RSS_ITEM_LIMIT = 20;

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
export function rssItemLimit(meta, file) {
  const raw = meta.rss_limit;
  if (raw === undefined) return RSS_ITEM_LIMIT;
  const text = String(raw).trim();
  // `Number("")` is 0 and `Number("12px")` is NaN — both fail the guard below,
  // so an empty or non-numeric value lands on the same actionable error.
  // Digits only: `Number()` would also accept "1e3", "0x10" and "7.0", none
  // of which is the "positive whole number" the error promises.
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (Number.isInteger(value) && value > 0) return value;
  const hint = "rss_limit: 20";
  throw wdError(
    `Invalid rss_limit "${text}"${file ? ` in ${file}` : ""}. ` +
      `Use a positive whole number of items: ${hint}.`,
    { code: "WD950", file, hint }
  );
}
