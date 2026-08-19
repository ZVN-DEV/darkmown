// ---------------------------------------------------------------------------
// Machine-readable directive catalog + llms.txt cheatsheet.
//
// `directiveCatalog()` returns a structured description of the whole `.wd`
// authoring surface — every public directive, `@loop` clause, loop row variable,
// button-action op, format pipe, and predicate operator — with a one-line syntax
// template, a one-line description, one CONCRETE compilable example, and whether
// it needs the reactive runtime. It is the single artifact an app stuffs into a
// small model's system prompt (via `llmsText()`), the source the GBNF grammar
// generator reads, and the thing the CLI's `catalog` command prints.
//
// Examples are sourced from the SAME `*_EXAMPLE` constants the compiler's error
// hints use, and the operator/formatter lists are read from the compiler's own
// tables (FORMATTER_NAMES, PREDICATE_OPS, LOOP_META) — so the catalog cannot
// drift from what actually compiles (drift-guarded in tests/catalog.test.js).
//
// The catalog also carries the stable compile-error codes (`errors`, from
// src/errors.js): an AI edit-loop that hits `[WD201] …` can look the code up in
// the same artifact it learned the syntax from, without parsing the prose.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { BUTTON_EXAMPLE, EFFECT_EXAMPLE, EVERY_EXAMPLE } from "./compiler/actions.js";
import { LOOP_META } from "./compiler/context.js";
import { FETCH_EXAMPLE } from "./compiler/fetch.js";
import { FORMATTER_NAMES } from "./compiler/format.js";
import {
  BIND_EXAMPLE,
  CHECKBOX_EXAMPLE,
  FORM_EXAMPLE,
  INPUT_EXAMPLE,
  RADIO_EXAMPLE,
  SELECT_EXAMPLE,
  SLIDER_EXAMPLE,
  SUBMIT_EXAMPLE,
  TEXTAREA_EXAMPLE
} from "./compiler/forms.js";
import { LOOP_EXAMPLE } from "./compiler/loops.js";
import { AUDIO_EXAMPLE, EMBED_EXAMPLE, VIDEO_EXAMPLE } from "./compiler/media.js";
import { PREDICATE_JOINERS, PREDICATE_OPS } from "./compiler/predicates.js";
import { SCHEMA_TYPES } from "./compiler/schema.js";
import { COMPUTED_EXAMPLE, STATE_EXAMPLE, STORE_EXAMPLE, THEME_EXAMPLE } from "./compiler/state.js";
import {
  CAROUSEL_EXAMPLE,
  CONTAINER_EXAMPLE,
  IF_EXAMPLE,
  INCLUDE_EXAMPLE
} from "./compiler/structure.js";
import { ERROR_AREAS, errorCatalog } from "./errors.js";

/**
 * @typedef {"static" | "reactive" | "either"} Reactivity Whether the directive
 *   ships zero JS (static), needs the reactive runtime (reactive), or can be
 *   either depending on whether it reads `:state`/`:store` (either).
 */

/**
 * @typedef {object} DirectiveEntry
 * @property {string} name The directive token (`@loop`, `:state`, `:::`, …).
 * @property {"line" | "block"} kind A single line, or an opener with a closer.
 * @property {string} syntax One-line schematic (`[…]` = optional, `<…>` = slot).
 * @property {string} description One-line, plain-language summary.
 * @property {string} example One concrete, compilable line.
 * @property {Reactivity} reactive
 */

/**
 * @typedef {object} CatalogEntry A clause / action-op / pipe / operator entry.
 * @property {string} name
 * @property {string} [syntax]
 * @property {string} description
 * @property {string} [example]
 */

/**
 * @typedef {object} DirectiveCatalog
 * @property {string} version The installed Darkmown version.
 * @property {string} format Always `.wd` — the file extension that gates directives.
 * @property {DirectiveEntry[]} directives
 * @property {CatalogEntry[]} loopClauses Clauses of the `@loop` header (fixed order).
 * @property {CatalogEntry[]} loopVariables Per-row meta variables valid in a loop body.
 * @property {CatalogEntry[]} actionOps The `:button`/`:effect`/`:every` action vocabulary.
 * @property {CatalogEntry[]} formatPipes The `{ value | pipe }` formatter whitelist.
 * @property {CatalogEntry[]} predicateOps Comparison operators for `where`/`:if`/`when`.
 * @property {string[]} predicateJoiners Logical joiners (`and`/`or`/`not`).
 * @property {CatalogEntry[]} frontmatterKeys Frontmatter keys the framework reads.
 * @property {string[]} schemaTypes The `schema:` JSON-LD types the compiler can populate.
 * @property {import("./errors.js").ErrorArea[]} errorAreas The `WDxxx` code blocks.
 * @property {import("./errors.js").ErrorEntry[]} errors Every stable compile-error
 *   code, with its cause and fix. A thrown error's message starts with its code
 *   (`[WD201] …`) and mirrors it on `err.wd.code`.
 */

/** The directive surface. `example` is drawn from the compiler's own constants. */
/** @type {DirectiveEntry[]} */
const DIRECTIVES = [
  {
    name: "@include",
    kind: "line",
    syntax: '@include /partial.wd [with key="value" …]',
    description:
      "Inline another .wd/.md file from site/pages or site/_, passing optional scope args.",
    example: INCLUDE_EXAMPLE,
    reactive: "static"
  },
  {
    name: "@loop",
    kind: "block",
    syntax:
      "@loop <src> into <item> [where …] [sort by …] [reverse] [offset N] [limit N] [paginate N] [sortable] … @endloop",
    description: "Iterate a JSON file, an in-scope value, or a :state/:store list.",
    example: LOOP_EXAMPLE,
    reactive: "either"
  },
  {
    name: ":::",
    kind: "block",
    syntax: "::: [tag] [.class …] [#id] [.class when <pred>] … :::",
    description: "Group content in a section/div/nav/main with classes, ids, and reactive classes.",
    example: CONTAINER_EXAMPLE,
    reactive: "either"
  },
  {
    name: ":if",
    kind: "block",
    syntax: ":if <name> | :if <a> <op> <b> [and|or|not …] … [:else if …] [:else] :endif",
    description: "Render a region only when a state/loop-item condition holds.",
    example: IF_EXAMPLE,
    reactive: "either"
  },
  {
    name: ":state",
    kind: "line",
    syntax: ":state name = value [persist|ephemeral]",
    description:
      "Declare page-scoped reactive state. Ephemeral by default; persist keeps it across reloads.",
    example: STATE_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":store",
    kind: "line",
    syntax: ":store name = value [persist|ephemeral]",
    description: "Declare a page-global store. Persisted by default; ephemeral opts out.",
    example: STORE_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":computed",
    kind: "line",
    syntax: ":computed name = <expression>",
    description: "Derive state from other state (numbers, comparisons, sum/avg/min/max/count).",
    example: COMPUTED_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":fetch",
    kind: "line",
    syntax:
      ':fetch name from "url" [method=…] [when=visible] [timeout=ms] [retry=N] [headers=key] [body=key]',
    description: "Load remote JSON with auto loading/error/empty lifecycle state.",
    example: FETCH_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":effect",
    kind: "line",
    syntax: ":effect watched -> action[; action…]",
    description: "Run button-vocabulary actions whenever the watched state changes.",
    example: EFFECT_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":every",
    kind: "line",
    syntax: ":every <duration> -> action[; action…]",
    description: "Run actions on a timer (5s/500ms/2m); auto-pauses while the tab is hidden.",
    example: EVERY_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":theme",
    kind: "line",
    syntax: ':theme [name] [= "auto"]',
    description: "Add a light/dark theme store reflected onto <html data-theme>.",
    example: THEME_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":button",
    kind: "line",
    syntax: ':button "Label" -> action[; action…]',
    description: "A button that runs one or more state actions on click.",
    example: BUTTON_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":form",
    kind: "block",
    syntax: ':form [into name] [action="/url"] [method="post"] … :endform',
    description: "A form: client state (into), native post (action), or fetch round-trip (both).",
    example: FORM_EXAMPLE,
    reactive: "either"
  },
  {
    name: ":input",
    kind: "line",
    syntax: ':input name [type=…] [placeholder="…"] [required]',
    description: "A single-line form input (auto aria-label).",
    example: INPUT_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":textarea",
    kind: "line",
    syntax: ':textarea name [placeholder="…"] [rows=N] [required]',
    description: "A multi-line form input.",
    example: TEXTAREA_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":select",
    kind: "block",
    syntax: ':select name [required]  then "- Label" lines',
    description: "A dropdown; one <option> per following - Label line.",
    example: SELECT_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":checkbox",
    kind: "block",
    syntax: ':checkbox name [required]  then "- Label" lines',
    description: "A checkbox group that captures every checked value.",
    example: CHECKBOX_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":radio",
    kind: "block",
    syntax: ':radio name [required]  then "- Label" lines',
    description: "A radio group that captures a single value.",
    example: RADIO_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":submit",
    kind: "line",
    syntax: ':submit "Label"',
    description: "A form submit button.",
    example: SUBMIT_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":bind",
    kind: "line",
    syntax: ':bind state [placeholder="…"] [type=…]',
    description: "A two-way text input bound to a declared :state.",
    example: BIND_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":slider",
    kind: "line",
    syntax: ":slider name [= value] [min=N] [max=N] [step=N] [persist]",
    description: "A range input two-way bound to a number :state.",
    example: SLIDER_EXAMPLE,
    reactive: "reactive"
  },
  {
    name: ":video",
    kind: "line",
    syntax: ":video /clip.mp4 [poster=…] [width=…] [height=…] [controls] [autoplay] [loop] [muted]",
    description: "A hardened HTML5 <video> (zero runtime).",
    example: VIDEO_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":audio",
    kind: "line",
    syntax: ":audio /clip.mp3 [preload=…] [controls] [autoplay] [loop] [muted]",
    description: "A hardened HTML5 <audio> player (zero runtime).",
    example: AUDIO_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":embed",
    kind: "line",
    syntax: ':embed <url> [title="…"]',
    description: "A lazy, privacy-friendly YouTube/Vimeo/iframe embed.",
    example: EMBED_EXAMPLE,
    reactive: "static"
  },
  {
    name: ":carousel",
    kind: "block",
    syntax: ":carousel [autoplay=N] … :endcarousel",
    description: "A scroll-snapping carousel; each direct child block is one slide.",
    example: CAROUSEL_EXAMPLE,
    reactive: "either"
  }
];

/** The `@loop` header clauses, in the fixed order the parser accepts them. */
/** @type {CatalogEntry[]} */
const LOOP_CLAUSES = [
  {
    name: "where",
    syntax: "where <item>.field <op> value [and|or …]",
    description: "Keep only rows matching a predicate.",
    example: "where p.price < 50"
  },
  {
    name: "sort by",
    syntax: "sort by <item>.field [asc|desc]",
    description: "Order rows by a field (or a { state } for clickable-header sort).",
    example: "sort by p.price asc"
  },
  { name: "reverse", syntax: "reverse", description: "Reverse the row order.", example: "reverse" },
  {
    name: "offset",
    syntax: "offset N",
    description: "Skip the first N rows.",
    example: "offset 2"
  },
  { name: "limit", syntax: "limit N", description: "Keep at most N rows.", example: "limit 5" },
  {
    name: "paginate",
    syntax: "paginate N",
    description: "Split a collection listing into static pages of N.",
    example: "paginate 10"
  },
  {
    name: "sortable",
    syntax: "sortable",
    description: "Let the user drag-reorder a :state/:store list.",
    example: "sortable"
  }
];

/** Per-row meta variables valid inside a loop body, read from LOOP_META. */
/** @type {Record<string, string>} */
const LOOP_VAR_DESC = {
  $index: "Zero-based row index.",
  $number: "One-based row number.",
  $first: "True on the first row.",
  $last: "True on the last row.",
  $count: "Total row count."
};

/** The button-action vocabulary. `token` is the distinguishing keyword the drift
 * test checks against actions.js's ACTION_USE string. */
const ACTION_OPS = [
  {
    name: "increment",
    token: "++",
    syntax: "name++",
    description: "Increment a number.",
    example: "count++"
  },
  {
    name: "decrement",
    token: "--",
    syntax: "name--",
    description: "Decrement a number.",
    example: "count--"
  },
  {
    name: "add",
    token: "+=",
    syntax: "n += k",
    description: "Add to a number.",
    example: "count += 5"
  },
  {
    name: "subtract",
    token: "-=",
    syntax: "n -= k",
    description: "Subtract from a number.",
    example: "count -= 5"
  },
  {
    name: "set",
    token: "=",
    syntax: "name = v",
    description: "Assign a value.",
    example: "open = true"
  },
  {
    name: "toggle",
    token: "toggle",
    syntax: "flag toggle",
    description: "Flip a boolean (or toggle a list member with `list toggle v`).",
    example: "open toggle"
  },
  {
    name: "append",
    token: "append",
    syntax: "list append v",
    description: "Append a value to a list.",
    example: 'items append "x"'
  },
  {
    name: "prepend",
    token: "prepend",
    syntax: "list prepend v",
    description: "Prepend a value to a list.",
    example: 'items prepend "x"'
  },
  {
    name: "remove",
    token: "remove",
    syntax: "list remove v",
    description: "Remove a value from a list (or the current loop row).",
    example: 'items remove "x"'
  },
  {
    name: "clear",
    token: "clear",
    syntax: "x clear",
    description: "Empty a list or reset a value to null.",
    example: "items clear"
  },
  {
    name: "merge",
    token: "merge",
    syntax: "obj merge other",
    description: "Shallow-merge another object/state key.",
    example: "settings merge patch"
  },
  {
    name: "delete",
    token: "delete",
    syntax: "obj delete key",
    description: "Delete a key from an object.",
    example: 'settings delete "beta"'
  },
  {
    name: "reset",
    token: "reset",
    syntax: "name reset",
    description: "Reset a state key to its initial value.",
    example: "form reset"
  }
];

/** Hand metadata for each formatter, keyed by name; keys are drift-checked to
 * equal FORMATTER_NAMES exactly (tests/catalog.test.js). */
/** @type {Record<string, { description: string, example: string }>} */
const PIPE_META = {
  money: { description: "Currency format.", example: "{ p.price | money }" },
  number: { description: "Number with optional fixed decimals.", example: "{ p.qty | number:2 }" },
  percent: { description: "Percentage format.", example: "{ p.rate | percent }" },
  round: { description: "Round to N decimals.", example: "{ p.score | round:1 }" },
  date: { description: "Localized date.", example: "{ p.published | date }" },
  time: { description: "Localized time.", example: "{ p.published | time }" },
  datetime: { description: "Localized date + time.", example: "{ p.published | datetime }" },
  upper: { description: "UPPERCASE.", example: "{ p.name | upper }" },
  lower: { description: "lowercase.", example: "{ p.name | lower }" },
  capitalize: { description: "Capitalize the first letter.", example: "{ p.name | capitalize }" },
  truncate: { description: "Cut to length with an ellipsis.", example: "{ p.bio | truncate:80 }" },
  trim: { description: "Trim surrounding whitespace.", example: "{ p.name | trim }" },
  pluralize: {
    description: "Count + singular/plural word.",
    example: '{ p.qty | pluralize:"item" }'
  },
  default: {
    description: "Fallback when empty/null.",
    example: '{ p.nickname | default:"friend" }'
  },
  sum: { description: "Sum a list (optionally a field).", example: '{ cart | sum:"price" }' },
  avg: { description: "Average a list.", example: "{ scores | avg }" },
  min: { description: "Minimum of a list.", example: "{ prices | min }" },
  max: { description: "Maximum of a list.", example: "{ prices | max }" },
  count: { description: "Item count of a list.", example: "{ cart | count }" },
  join: { description: "Join a list into a string.", example: '{ tags | join:", " }' }
};

/**
 * The frontmatter keys the framework itself reads: page identity, the shell's
 * head, the feeds, and the opt-in structured data. Author-invented keys are
 * still free (they read back as `{ meta.anything }`); these are the ones with
 * BEHAVIOR attached, which is exactly what an AI author needs told.
 *
 * Every name here is drift-guarded in tests/catalog.test.js against the source
 * that consumes it, so a renamed key cannot leave a stale entry behind.
 * @type {CatalogEntry[]}
 */
const FRONTMATTER_KEYS = [
  { name: "title", description: "Page title (<title>, og:title).", example: "title: My Page" },
  {
    name: "description",
    description: "Meta description, og:description, RSS fallback.",
    example: "description: What this page is about."
  },
  {
    name: "image",
    description: "Absolute URL of the social share image.",
    example: "image: https://example.com/og.png"
  },
  { name: "lang", description: "Document language for <html lang>.", example: "lang: en" },
  {
    name: "site_url",
    description:
      "HOME PAGE ONLY: the site origin. Turns on sitemap.xml, rss.xml, and canonical URLs.",
    example: "site_url: https://example.com"
  },
  {
    name: "ai_crawlers",
    description: "HOME PAGE ONLY: allow (default) or deny the AI crawlers named in robots.txt.",
    example: "ai_crawlers: deny"
  },
  {
    name: "date",
    description: "Marks the page a post: RSS item, sitemap lastmod, og:type=article.",
    example: "date: 2026-08-09"
  },
  {
    name: "updated",
    description: "Last revision date, for structured data.",
    example: "updated: 2026-08-09"
  },
  {
    name: "excerpt",
    description: "Explicit RSS <description> for a post.",
    example: "excerpt: A short summary."
  },
  {
    name: "draft",
    description: "Excluded from builds and feeds until published.",
    example: "draft: true"
  },
  {
    name: "html",
    description: "Allow raw HTML in the markdown body (default false).",
    example: "html: true"
  },
  {
    name: "transitions",
    description: "Opt into cross-document view transitions and link prerendering.",
    example: "transitions: true"
  },
  {
    name: "schema",
    description: `Emit JSON-LD structured data. One, or a list, of: ${SCHEMA_TYPES.join(", ")}.`,
    example: "schema: BlogPosting"
  },
  {
    name: "author",
    description: "Author name (or a list) for an article schema.",
    example: "author: Ada Lovelace"
  },
  {
    name: "organization",
    description: "Organisation name for an Organization schema (defaults to the page title).",
    example: "organization: Acme Inc"
  },
  {
    name: "logo",
    description: "Absolute logo URL for an Organization schema.",
    example: "logo: https://example.com/logo.png"
  }
];

/** One-line description per comparison operator. */
/** @type {Record<string, string>} */
const OP_DESC = {
  contains: "List/string membership.",
  "==": "Equal.",
  "!=": "Not equal.",
  ">=": "Greater than or equal.",
  "<=": "Less than or equal.",
  ">": "Greater than.",
  "<": "Less than."
};

/** Read the installed version from package.json (always shipped beside src/). */
function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(pkg.version || "0.0.0");
}

/**
 * The structured, machine-readable catalog of the whole `.wd` authoring surface.
 * @returns {DirectiveCatalog}
 */
export function directiveCatalog() {
  return {
    version: readVersion(),
    format: ".wd",
    directives: DIRECTIVES.map((d) => ({ ...d })),
    loopClauses: LOOP_CLAUSES.map((c) => ({ ...c })),
    loopVariables: Object.keys(LOOP_META).map((name) => ({
      name,
      description: LOOP_VAR_DESC[name],
      example: `{ ${name} }`
    })),
    actionOps: ACTION_OPS.map((a) => ({
      name: a.name,
      syntax: a.syntax,
      description: a.description,
      example: a.example
    })),
    formatPipes: FORMATTER_NAMES.map((name) => ({
      name,
      syntax: `{ value | ${name} }`,
      description: PIPE_META[name].description,
      example: PIPE_META[name].example
    })),
    predicateOps: PREDICATE_OPS.map((op) => ({
      name: op,
      description: OP_DESC[op],
      example: op === "contains" ? 'p.tags contains "sale"' : `p.price ${op} 50`
    })),
    predicateJoiners: [...PREDICATE_JOINERS],
    frontmatterKeys: FRONTMATTER_KEYS.map((key) => ({ ...key })),
    schemaTypes: [...SCHEMA_TYPES],
    errorAreas: ERROR_AREAS.map((area) => ({ ...area })),
    errors: errorCatalog()
  };
}

/** The action tokens the catalog exposes — used by the drift guard. */
export const CATALOG_ACTION_TOKENS = ACTION_OPS.map((a) => a.token);

/**
 * One page of a built site, as it appears in the generated `llms.txt` index and
 * `llms-full.txt` corpus.
 * @typedef {object} SitePage
 * @property {string} title
 * @property {string} url Absolute URL when the site declared `site_url`, else the route path.
 * @property {string} description "" when the page has no `description:`.
 * @property {string} [body] The page's source body (frontmatter stripped). Only
 *   the corpus carries it; the index omits it.
 */

/**
 * The site a generated llms file describes. Plain data, passed in by the builder
 * (the only layer that knows the routes), so this module stays a pure renderer.
 * @typedef {object} SiteCorpus
 * @property {string} title
 * @property {string} description
 * @property {string} url Site origin, or "" when the home page set no `site_url`.
 * @property {SitePage[]} pages Every emitted route, in route order.
 */

/**
 * Render the catalog as a compact llms.txt-style markdown cheatsheet — the
 * artifact an app pastes into a small model's system prompt. Generated entirely
 * from {@link directiveCatalog}, so it can never disagree with what compiles.
 *
 * When a `site` is supplied (the build always supplies one) the cheatsheet is
 * followed by an INDEX of the site's pages and a pointer to `llms-full.txt`,
 * which is the llms.txt convention: a short index, with the complete corpus one
 * fetch away.
 * @param {SiteCorpus} [site] The built site to index.
 * @returns {string}
 */
export function llmsText(site) {
  const cat = directiveCatalog();
  const out = [];
  out.push(`# Darkmown .wd cheatsheet (v${cat.version})`);
  out.push("");
  out.push("Darkmown compiles Markdown. A plain `.md` file stays plain; rename it to `.wd`");
  out.push("to unlock the directives below. Static pages ship ZERO JavaScript; only pages");
  out.push("that use :state/:store/:fetch/:button (reactive) load the ~8 KB runtime. Copy an");
  out.push("example verbatim — every one compiles. Interpolate values with `{ path }`.");
  out.push("");

  out.push("## Directives");
  for (const d of cat.directives) {
    out.push(`- \`${d.name}\` (${d.reactive}) — ${d.description} e.g. \`${d.example}\``);
  }
  out.push("");

  out.push("## @loop clauses (this fixed order, all optional)");
  for (const c of cat.loopClauses) {
    out.push(`- \`${c.syntax}\` — ${c.description} e.g. \`${c.example}\``);
  }
  out.push("");

  out.push("## Loop row variables (inside a loop body)");
  out.push(
    `- ${cat.loopVariables.map((v) => `\`${v.name}\``).join(", ")} — ${cat.loopVariables
      .map((v) => `${v.name} = ${v.description.toLowerCase().replace(/\.$/, "")}`)
      .join("; ")}.`
  );
  out.push("");

  out.push("## Button / :effect / :every actions (chain with `;`)");
  for (const a of cat.actionOps) {
    out.push(`- \`${a.syntax}\` — ${a.description} e.g. \`${a.example}\``);
  }
  out.push("");

  out.push("## Format pipes  `{ value | name:arg }`");
  for (const p of cat.formatPipes) {
    out.push(`- \`${p.name}\` — ${p.description} e.g. \`${p.example}\``);
  }
  out.push("");

  out.push("## Predicate operators (where / :if / `.class when`)");
  out.push(
    `- ${cat.predicateOps.map((o) => `\`${o.name}\``).join(", ")} — join conditions with ${cat.predicateJoiners
      .map((j) => `\`${j}\``)
      .join(" / ")}. e.g. \`${cat.predicateOps[0].example}\``
  );
  out.push("");

  out.push("## Page frontmatter");
  for (const key of cat.frontmatterKeys) {
    out.push(`- \`${key.name}\`: ${key.description} e.g. \`${key.example}\``);
  }
  out.push("");

  out.push("## Rules");
  out.push("- `.md` never gets directives — the `.wd` extension is the feature gate.");
  out.push("- One loop syntax (`@loop … into … @endloop`), one interpolation syntax (`{ name }`).");
  out.push("- Actions and predicates are a fixed whitelist — no JavaScript, no `x.filter(...)`.");
  out.push("- Close every block: `@endloop`, `:endif`, `:endform`, `:endcarousel`, `:::`.");
  out.push(
    "- Compile errors start with a stable code (`[WD201] …`) and always name the file," +
      " the line, and a fix. Read the message; it tells you exactly what to write."
  );
  out.push("");

  if (site) {
    out.push(`## ${site.title}`);
    if (site.description) {
      out.push("");
      out.push(`> ${site.description}`);
    }
    out.push("");
    out.push("### Pages");
    for (const page of site.pages) {
      out.push(`- [${page.title}](${page.url})${page.description ? `: ${page.description}` : ""}`);
    }
    out.push("");
    out.push(
      "The full text of every page above, plus the complete Darkmown authoring reference " +
        "and every compile-error code, is at /llms-full.txt."
    );
    out.push("");
  }
  return out.join("\n");
}

/**
 * Render `llms-full.txt`: the COMPLETE corpus that `llms.txt` indexes. Where the
 * cheatsheet is one line per directive, this carries the full syntax template,
 * description, example, and reactivity for every one, plus every compile-error
 * code with its cause and fix: and then the full source text of every page on
 * the site. Same generator, same catalog, so index and corpus cannot disagree.
 * @param {SiteCorpus} [site] The built site whose pages form the corpus.
 * @returns {string}
 */
export function llmsFullText(site) {
  const cat = directiveCatalog();
  const out = [];
  out.push(`# Darkmown ${site ? `${site.title} ` : ""}full reference (v${cat.version})`);
  out.push("");
  out.push("The complete corpus indexed by /llms.txt: every `.wd` directive with its full");
  out.push("syntax, every clause, action, format pipe and operator, every stable compile-error");
  out.push("code, and the full source text of every page on this site. Every example compiles.");
  out.push("");

  out.push("## Directives");
  for (const d of cat.directives) {
    out.push("");
    out.push(`### ${d.name} (${d.kind}, ${d.reactive})`);
    out.push(d.description);
    out.push("");
    out.push("```");
    out.push(d.syntax);
    out.push(d.example);
    out.push("```");
  }
  out.push("");

  out.push("## @loop clauses (this fixed order, all optional)");
  for (const c of cat.loopClauses) {
    out.push(`- \`${c.syntax}\`: ${c.description} e.g. \`${c.example}\``);
  }
  out.push("");

  out.push("## Loop row variables (inside a loop body)");
  for (const v of cat.loopVariables) {
    out.push(`- \`${v.name}\`: ${v.description}`);
  }
  out.push("");

  out.push("## Button / :effect / :every actions (chain with `;`)");
  for (const a of cat.actionOps) {
    out.push(`- \`${a.syntax}\`: ${a.description} e.g. \`${a.example}\``);
  }
  out.push("");

  out.push("## Format pipes  `{ value | name:arg }`");
  for (const p of cat.formatPipes) {
    out.push(`- \`${p.name}\`: ${p.description} e.g. \`${p.example}\``);
  }
  out.push("");

  out.push("## Predicate operators (where / :if / `.class when`)");
  for (const o of cat.predicateOps) {
    out.push(`- \`${o.name}\`: ${o.description} e.g. \`${o.example}\``);
  }
  out.push(`Join conditions with ${cat.predicateJoiners.map((j) => `\`${j}\``).join(" / ")}.`);
  out.push("");

  out.push("## Page frontmatter");
  for (const key of cat.frontmatterKeys) {
    out.push(`- \`${key.name}\`: ${key.description} e.g. \`${key.example}\``);
  }
  out.push("");

  out.push("## Compile error codes");
  for (const area of cat.errorAreas) {
    out.push(`### ${area.range} ${area.title}`);
    for (const err of cat.errors.filter((e) => e.area === area.name)) {
      out.push(`- **${err.code} ${err.title}**: ${err.cause} Fix: ${err.fix}`);
    }
    out.push("");
  }

  if (site) {
    out.push(`## ${site.title}: full page text`);
    for (const page of site.pages) {
      out.push("");
      out.push(`### ${page.title}`);
      out.push(`URL: ${page.url}`);
      if (page.description) out.push(`Description: ${page.description}`);
      out.push("");
      out.push((page.body || "").trim());
    }
    out.push("");
  }
  return out.join("\n");
}
