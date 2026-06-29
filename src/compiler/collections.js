// ---------------------------------------------------------------------------
// Typed content collections. ANY `site/pages/<name>/` subdirectory is a
// queryable collection, referenced by its bare name in `@loop` (no `content/`
// root, no marker file). The index is built from the router's already-parsed
// `route.meta` — frontmatter is never re-parsed here — and each entry becomes a
// row the existing where/sort/format-pipe/`:if`/`:every` machinery consumes
// UNCHANGED: every frontmatter field plus the derived `url` (entry route),
// `slug` (filename stem), and an `excerpt` (frontmatter `excerpt:` → first
// paragraph of a `.md` body).
//
// An optional `_schema.wd` at the collection root opts the collection into
// build-time validation: every entry's frontmatter is checked against a small,
// closed type DSL (`field: string|number|boolean|date|string[]`, `?` = optional)
// with `file:line` errors. No `_schema.wd` = no validation (opt-in, like
// `scoped`/`draft`).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { firstParagraph } from "../feeds.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("../router.js").Route} Route
 */

/**
 * A collection entry row: every frontmatter field, plus derived `url`/`slug`/
 * `excerpt`. Keyed loosely so authors' custom frontmatter keys pass through to
 * `{ post.whatever }` and `where`/`sort` without a closed schema here.
 * @typedef {Record<string, unknown> & { url: string, slug: string, excerpt: string }} CollectionRow
 */

/** The closed type vocabulary for `_schema.wd`. `?` (optional) is a modifier. */
const SCHEMA_TYPES = new Set(["string", "number", "boolean", "date", "string[]"]);

/**
 * Build the collection index from the router's discovered routes: one entry per
 * `site/pages/<name>/…` route, grouped under the FIRST path segment (the
 * collection name). The home route, top-level pages, and the synthetic `/404/`
 * route are not entries. Reuses each route's already-parsed `meta` (no re-parse)
 * and reads the `.md` body only for the excerpt fallback. When a collection has
 * a `_schema.wd`, every entry is validated against it here (throwing on the
 * first violation), so a malformed entry fails the build with a `file:line`.
 *
 * @param {Route[]} routes Post-draft-filter routes from `discoverRoutes`.
 * @param {Paths} paths Resolved project paths (`routesRoot` for `_schema.wd`).
 * @returns {Map<string, CollectionRow[]>} Collection name → entry rows.
 */
export function buildCollections(routes, paths) {
  /** @type {Map<string, CollectionRow[]>} */
  const collections = new Map();
  for (const route of routes) {
    const name = collectionNameOf(route.route);
    if (!name) continue;
    const rows = collections.get(name) || [];
    rows.push(rowFor(route));
    collections.set(name, rows);
  }
  for (const [name, rows] of collections) {
    const schema = readSchema(name, paths);
    if (schema) validateRows(rows, schema, name);
  }
  return collections;
}

/**
 * The collection name a route belongs to: the first path segment of a nested
 * route (`/blog/hello/` → `blog`), or null for the home page, a top-level page
 * (`/about/` → no nesting), or the `/404/` route (never a collection entry).
 * @param {string} route Public route path (trailing-slashed).
 * @returns {string | null}
 */
function collectionNameOf(route) {
  if (route === "/" || route === "/404/") return null;
  const parts = route.replace(/^\/|\/$/g, "").split("/");
  return parts.length >= 2 ? parts[0] : null;
}

/**
 * Build one collection row from a route: spread its frontmatter, then add the
 * derived `url` (the route path), `slug` (filename stem), and `excerpt`
 * (frontmatter `excerpt:` wins; else the first paragraph of a `.md` body; `.wd`
 * bodies are not scanned — directive markup isn't clean prose). The derived keys
 * are added AFTER the spread so a stray frontmatter `url:`/`slug:` can't shadow
 * the real route data the loop relies on.
 * @param {Route} route
 * @returns {CollectionRow}
 */
function rowFor(route) {
  const slug = path.basename(route.file, path.extname(route.file));
  /** @type {Record<string, unknown>} */
  const fields = {};
  for (const [key, value] of Object.entries(route.meta)) fields[key] = coerceScalar(value);
  return {
    ...fields,
    url: route.route,
    slug: slug === "index" ? path.basename(path.dirname(route.file)) : slug,
    excerpt: excerptFor(route)
  };
}

/**
 * Coerce a frontmatter scalar to its natural type for querying. The frontmatter
 * parser yields scalars as STRINGS (`true`, `42` arrive as `"true"`, `"42"`), but
 * a collection loop should behave like a JSON loop, where `where p.featured ==
 * true` and numeric `sort`/comparisons just work. So a bare `true`/`false` becomes
 * a boolean and a numeric string becomes a number; quoted/other strings and
 * arrays pass through untouched. This coercion is scoped to collection rows only —
 * it never touches the global frontmatter parser (a `:state`/`{ meta.x }` value
 * keeps its existing string form).
 * @param {unknown} value
 * @returns {unknown}
 */
function coerceScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * The excerpt for an entry: the frontmatter `excerpt:` string if present, else
 * (plain `.md` only) the first paragraph of its body, else "". Mirrors the RSS
 * description fallback so a collection card and the feed read the same snippet.
 * @param {Route} route
 * @returns {string}
 */
function excerptFor(route) {
  const fromMeta = route.meta.excerpt;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  if (path.extname(route.file) !== ".md") return "";
  const { body } = parseFrontmatter(fs.readFileSync(route.file, "utf8"), route.file);
  return firstParagraph(body);
}

/**
 * A parsed `_schema.wd` field rule.
 * @typedef {object} SchemaField
 * @property {string} name Field name.
 * @property {string} type One of {@link SCHEMA_TYPES}.
 * @property {boolean} optional Whether the field may be absent (`?` modifier).
 */

/**
 * Read + parse a collection's `_schema.wd`, or null when the file is absent
 * (validation is opt-in). The schema is frontmatter-shaped — one `field: type`
 * line per rule inside the `---` block — so authors write it exactly like the
 * frontmatter it validates. Each type must be in the closed {@link SCHEMA_TYPES}
 * vocabulary (`?` suffix = optional); an unknown token is a compile error in the
 * schema file itself, pointing at the offending line.
 * @param {string} name Collection name.
 * @param {Paths} paths
 * @returns {SchemaField[] | null}
 */
export function readSchema(name, paths) {
  const file = path.join(paths.routesRoot, name, "_schema.wd");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8");
  return parseSchema(raw, file);
}

/**
 * Parse a `_schema.wd` source into field rules. The schema fields live in the
 * frontmatter block; the body (if any) is ignored, so a schema file can carry a
 * prose note after its `---` fence. Each field line is `name: type` where type
 * is a closed token with an optional trailing `?`.
 * @param {string} raw `_schema.wd` file contents.
 * @param {string} file Absolute path, for `file:line` errors.
 * @returns {SchemaField[]}
 */
export function parseSchema(raw, file) {
  // Use the same `---` extraction as page frontmatter so the schema block is
  // delimited identically. A schema with no fence is read as bare lines.
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  /** @type {SchemaField[]} */
  const fields = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "---") {
      // First `---` opens the block; the second closes it and ends the schema.
      if (!fenced && fields.length === 0) {
        fenced = true;
        continue;
      }
      if (fenced) break; // closing fence — rest of the file is prose, ignore it
    }
    if (!trimmed || trimmed.startsWith("#")) continue; // blank line or comment
    const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) {
      throw new Error(
        `Malformed schema line in ${file}:${i + 1}: "${trimmed}". Use: field: type (e.g. \`title: string\`, \`tags: string[]\`, \`featured: boolean?\`).`
      );
    }
    fields.push(parseSchemaField(match[1], match[2].trim(), file, i + 1));
  }
  return fields;
}

/**
 * Parse one `name: type` schema rule, validating the type against the closed
 * vocabulary and peeling the optional `?` modifier.
 * @param {string} name
 * @param {string} rawType Type token (may end in `?`).
 * @param {string} file
 * @param {number} lineNo 1-based line number for the error.
 * @returns {SchemaField}
 */
function parseSchemaField(name, rawType, file, lineNo) {
  const optional = rawType.endsWith("?");
  const type = optional ? rawType.slice(0, -1).trim() : rawType;
  if (!SCHEMA_TYPES.has(type)) {
    throw new Error(
      `Unknown schema type "${rawType}" for field "${name}" in ${file}:${lineNo}. Use one of: ${[...SCHEMA_TYPES].join(", ")} (append "?" to make a field optional).`
    );
  }
  return { name, type, optional };
}

/**
 * Validate every collection row against the schema, throwing on the first
 * violation with a `file:line` (the entry's own path) and the offending field.
 * A missing required field, a wrong type, or an unknown extra field all fail —
 * unknown keys are rejected so a typo'd frontmatter key (`titel:`) is caught
 * rather than silently dropped.
 * @param {CollectionRow[]} rows
 * @param {SchemaField[]} schema
 * @param {string} name Collection name, for the error message.
 * @returns {void}
 */
function validateRows(rows, schema, name) {
  const allowed = new Set(schema.map((field) => field.name));
  // Framework-recognized keys never need a schema declaration: `url`/`slug`/
  // `excerpt` are derived (always present), and `draft` is the routing gate
  // (present on `--drafts` builds). Allow them implicitly so they don't trip the
  // unknown-key check.
  for (const reserved of ["url", "slug", "excerpt", "draft"]) allowed.add(reserved);
  for (const row of rows) {
    const where = `${String(row.url)} (collection "${name}")`;
    for (const field of schema) validateField(row, field, where);
    for (const key of Object.keys(row)) {
      if (allowed.has(key)) continue;
      throw new Error(
        `Unknown frontmatter field "${key}" in ${where}: it is not declared in _schema.wd. Add \`${key}: <type>\` to the schema, or remove the field.`
      );
    }
  }
}

/**
 * Validate one field of one row against its schema rule.
 * @param {CollectionRow} row
 * @param {SchemaField} field
 * @param {string} where Human-readable entry location for the error.
 * @returns {void}
 */
function validateField(row, field, where) {
  const present = field.name in row && row[field.name] !== null && row[field.name] !== "";
  if (!present) {
    if (field.optional) return;
    throw new Error(
      `Missing required field "${field.name}" (${field.type}) in ${where}. Add \`${field.name}: …\` to the entry's frontmatter, or mark it optional with "${field.name}: ${field.type}?" in _schema.wd.`
    );
  }
  const value = row[field.name];
  if (!matchesType(value, field.type)) {
    throw new Error(
      `Field "${field.name}" in ${where} should be ${field.type} but is "${describe(value)}". Fix the entry's frontmatter or the schema.`
    );
  }
}

/**
 * Whether a frontmatter value satisfies a schema type. Frontmatter scalars are
 * already strings/numbers/booleans/arrays (the parser produces no Date object),
 * so `date` is "a string that `Date` can parse" and `number` accepts a numeric
 * string too (frontmatter `42` parses to a number, but a quoted `"42"` stays a
 * string — both are acceptable for a `number` field). The `type` is always one of
 * {@link SCHEMA_TYPES} (parseSchemaField rejected anything else), so a missing
 * checker can't occur — every {@link SCHEMA_TYPES} member has an entry below.
 * @param {unknown} value
 * @param {string} type
 * @returns {boolean}
 */
function matchesType(value, type) {
  return TYPE_CHECKS[type](value);
}

/**
 * The per-type value checker for each closed schema type. Keyed exactly by
 * {@link SCHEMA_TYPES}, so the indexed call in {@link matchesType} always lands on
 * a real checker (no unreachable fallback branch to cover).
 * @type {Record<string, (value: unknown) => boolean>}
 */
const TYPE_CHECKS = {
  string: (value) => typeof value === "string",
  number: (value) =>
    typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)),
  boolean: (value) => typeof value === "boolean" || value === "true" || value === "false",
  date: (value) => typeof value === "string" && !Number.isNaN(new Date(value).getTime()),
  "string[]": (value) => Array.isArray(value) && value.every((item) => typeof item === "string")
};

/**
 * A short, safe description of a value for a validation error message.
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  return String(value);
}
