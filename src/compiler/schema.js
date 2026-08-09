// ---------------------------------------------------------------------------
// Structured data (JSON-LD): the opt-in `schema:` frontmatter key that emits a
// `<script type="application/ld+json">` block into the page head.
//
// WHAT THIS IS FOR. Ordinary indexing hygiene, so a page is eligible for the
// conventional rich results Google Search has always offered. It is NOT an
// AI-citation lever: Google's own generative-search guidance is explicit that
// "there's no special schema.org markup you need to add" and "structured data
// isn't required for generative AI search", while still recommending it as part
// of normal SEO for rich-result eligibility. That is the claim this feature
// makes, and the only one.
//
// Why frontmatter and not a directive: JSON-LD describes the DOCUMENT, not a
// region of the body, and everything else the head is built from (title,
// description, image, lang, transitions) already comes from frontmatter. It also
// keeps the feature available to plain `.md` pages without breaking the "`.md`
// never gets directive behavior" invariant, and lets a page like the site home
// (`html: false`, zero raw HTML) describe itself.
//
// HONESTY RULE, and why the type list is short. Every emitted property is read
// from the page's own frontmatter or from the site identity the build already
// resolved. Nothing is invented, defaulted to a flattering value, or synthesised.
// Deliberately absent, because Darkmown cannot know them truthfully:
//   * `aggregateRating` / `review`: fabricated social proof, and a documented
//     manual-action risk. There is no frontmatter key for these on purpose.
//   * `FAQPage`: would have to be harvested from prose and guessed at, and
//     Google retired the FAQ rich result for most sites anyway.
//   * `SoftwareApplication`: its useful shape needs offers/ratings we would be
//     making up; `Organization` + `WebSite` describe a project page honestly.
// Compile-time only: zero runtime bytes, and a static page stays static.
// ---------------------------------------------------------------------------

import { wdError } from "./context.js";
import { safeScriptJson } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Meta} Meta
 */

/**
 * The `schema:` types Darkmown knows how to populate from real page data:
 * article-family types from a page's title/description/date/author, and the two
 * site-identity types from what a home page already declares. Anything else is
 * a compile error rather than a guess. `BreadcrumbList` is not listed because it
 * is never opted into: it is derived automatically from routes that exist.
 * @type {string[]}
 */
export const SCHEMA_TYPES = ["Article", "BlogPosting", "TechArticle", "WebSite", "Organization"];

/** The article-family types, which share one builder and imply `og:type=article`. */
const ARTICLE_TYPES = new Set(["Article", "BlogPosting", "TechArticle"]);

/** A concrete, copyable `schema:` frontmatter line for docs and error hints. */
export const SCHEMA_EXAMPLE = "schema: BlogPosting";

/**
 * The declared `schema:` types, as a list. `schema:` accepts one type or an
 * inline array (`schema: [WebSite, Organization]`), since a home page honestly
 * is both a site and the organisation behind it.
 * @param {Meta} meta
 * @returns {string[]}
 */
function schemaTypesOf(meta) {
  const value = meta.schema;
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

/**
 * Whether a page's frontmatter declares an article-family `schema:` type. Used
 * by the page shell to pick `og:type` (`article` vs `website`).
 * @param {Meta} meta
 * @returns {boolean}
 */
export function isArticleSchema(meta) {
  return schemaTypesOf(meta).some((type) => ARTICLE_TYPES.has(type));
}

/**
 * Read a frontmatter field as a trimmed string, or "" when absent/non-string.
 * @param {Meta} meta
 * @param {string} key
 * @returns {string}
 */
function str(meta, key) {
  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Assign `key` on `node` only when `value` is a non-empty string. The single
 * gate that keeps invented or blank properties out of the emitted graph.
 * @param {Record<string, unknown>} node
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function put(node, key, value) {
  if (value) node[key] = value;
}

/**
 * The `author` value for an article node: one Person, a list of Persons for an
 * array frontmatter value, or undefined when there is no `author:`.
 * @param {Meta} meta
 * @returns {object | object[] | undefined}
 */
function authorOf(meta) {
  const value = meta.author;
  if (Array.isArray(value)) {
    const people = value
      .map((name) => String(name).trim())
      .filter(Boolean)
      .map((name) => ({ "@type": "Person", name }));
    return people.length > 0 ? people : undefined;
  }
  const single = str(meta, "author");
  return single ? { "@type": "Person", name: single } : undefined;
}

/**
 * Build the article-family node (`Article`/`BlogPosting`/`TechArticle`).
 * `datePublished` is the existing `date:` frontmatter (the framework's "this is
 * a post" signal, already used by RSS); `dateModified` is an optional `updated:`
 * and falls back to the publication date rather than inventing a revision.
 * @param {string} type
 * @param {SchemaInput} input
 * @returns {Record<string, unknown>}
 */
function articleNode(type, input) {
  /** @type {Record<string, unknown>} */
  const node = { "@context": "https://schema.org", "@type": type, headline: input.title };
  put(node, "description", input.description);
  put(node, "image", input.image);
  put(node, "datePublished", str(input.meta, "date"));
  put(node, "dateModified", str(input.meta, "updated") || str(input.meta, "date"));
  const author = authorOf(input.meta);
  if (author) node.author = author;
  put(node, "inLanguage", input.lang);
  put(node, "url", input.canonical);
  put(node, "mainEntityOfPage", input.canonical);
  return node;
}

/**
 * Build the `WebSite` node: the site-identity type for a home page.
 * @param {SchemaInput} input
 * @returns {Record<string, unknown>}
 */
function webSiteNode(input) {
  /** @type {Record<string, unknown>} */
  const node = { "@context": "https://schema.org", "@type": "WebSite", name: input.title };
  put(node, "description", input.description);
  put(node, "inLanguage", input.lang);
  put(node, "url", input.canonical);
  return node;
}

/**
 * Build the `Organization` node. `name` is an explicit `organization:` when the
 * page has one (the site title is rarely the organisation's name) and the page
 * title otherwise; `logo` is an optional absolute URL. No employee counts, no
 * addresses, no ratings: only what the frontmatter actually states.
 * @param {SchemaInput} input
 * @returns {Record<string, unknown>}
 */
function organizationNode(input) {
  /** @type {Record<string, unknown>} */
  const node = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: str(input.meta, "organization") || input.title
  };
  put(node, "description", input.description);
  put(node, "logo", str(input.meta, "logo"));
  put(node, "url", input.canonical);
  return node;
}

/**
 * Build a `BreadcrumbList` node from a resolved trail. The trail is supplied by
 * the builder (the only place that knows every route's real title), and only
 * ever contains routes that were actually emitted, so a crumb can never name or
 * link a page that does not exist.
 * @param {{ name: string, url: string }[]} trail
 * @returns {Record<string, unknown>}
 */
function breadcrumbNode(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url
    }))
  };
}

/**
 * Everything the JSON-LD builders may read. Only page-derived facts: the shell's
 * already-resolved title/description/image/lang, the page's frontmatter, and the
 * absolute URL the builder resolved for it.
 * @typedef {object} SchemaInput
 * @property {Meta} meta Page frontmatter.
 * @property {string} file Source path, for compile errors.
 * @property {string} title Resolved page title.
 * @property {string} description Resolved page description ("" when absent).
 * @property {string} image Absolute social image URL ("" when absent).
 * @property {string} lang Document language.
 * @property {string} canonical Absolute canonical URL ("" when no `site_url`).
 * @property {{ name: string, url: string }[]} breadcrumbs Resolved crumb trail.
 */

/**
 * Build the page's `<script type="application/ld+json">` block, or "" when the
 * page opts into nothing. Two independent inputs feed it: the `schema:`
 * frontmatter type (or types), and a breadcrumb trail the builder resolved for a
 * nested route. Two or more nodes are emitted as a JSON array in one script,
 * which is valid JSON-LD and one fewer tag in the head.
 * @param {SchemaInput} input
 * @returns {string} The script tag, or "" when there is nothing to say.
 */
export function buildJsonLd(input) {
  /** @type {Record<string, unknown>[]} */
  const nodes = [];
  for (const type of schemaTypesOf(input.meta)) {
    if (!SCHEMA_TYPES.includes(type)) {
      const hint = `schema: <type>, one of ${SCHEMA_TYPES.join(", ")}`;
      throw wdError(
        `Unknown schema type "${type}" in ${input.file}. Use: ${hint} (for example, "${SCHEMA_EXAMPLE}").`,
        { code: "WD016", file: input.file, hint }
      );
    }
    nodes.push(nodeFor(type, input));
  }
  if (input.breadcrumbs.length > 0) nodes.push(breadcrumbNode(input.breadcrumbs));
  if (nodes.length === 0) return "";
  const payload = nodes.length === 1 ? nodes[0] : nodes;
  return `<script type="application/ld+json">${safeScriptJson(payload)}</script>`;
}

/**
 * Dispatch a validated `schema:` type to its node builder.
 * @param {string} type A member of {@link SCHEMA_TYPES}.
 * @param {SchemaInput} input
 * @returns {Record<string, unknown>}
 */
function nodeFor(type, input) {
  if (ARTICLE_TYPES.has(type)) return articleNode(type, input);
  if (type === "WebSite") return webSiteNode(input);
  return organizationNode(input);
}
