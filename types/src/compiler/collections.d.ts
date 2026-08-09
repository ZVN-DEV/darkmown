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
 * @param {import("./reader.js").Reader} [reader] Source reader (fs-backed by
 *   default; pass an in-memory reader to build collections without a filesystem).
 * @returns {Map<string, CollectionRow[]>} Collection name → entry rows.
 */
export function buildCollections(routes: Route[], paths: Paths, reader?: import("./reader.js").Reader): Map<string, CollectionRow[]>;
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
 * @param {import("./reader.js").Reader} [reader] Source reader (fs-backed by default).
 * @returns {SchemaField[] | null}
 */
export function readSchema(name: string, paths: Paths, reader?: import("./reader.js").Reader): SchemaField[] | null;
/**
 * Parse a `_schema.wd` source into field rules. The schema fields live in the
 * frontmatter block; the body (if any) is ignored, so a schema file can carry a
 * prose note after its `---` fence. Each field line is `name: type` where type
 * is a closed token with an optional trailing `?`.
 * @param {string} raw `_schema.wd` file contents.
 * @param {string} file Absolute path, for `file:line` errors.
 * @returns {SchemaField[]}
 */
export function parseSchema(raw: string, file: string): SchemaField[];
/**
 * A parsed `_schema.wd` field rule.
 */
export type SchemaField = {
    /**
     * Field name.
     */
    name: string;
    /**
     * One of {@link SCHEMA_TYPES}.
     */
    type: string;
    /**
     * Whether the field may be absent (`?` modifier).
     */
    optional: boolean;
};
export type Paths = import("./context.js").Paths;
export type Meta = import("./context.js").Meta;
export type Route = import("../router.js").Route;
/**
 * A collection entry row: every frontmatter field, plus derived `url`/`slug`/
 * `excerpt`. Keyed loosely so authors' custom frontmatter keys pass through to
 * `{ post.whatever }` and `where`/`sort` without a closed schema here.
 */
export type CollectionRow = Record<string, unknown> & {
    url: string;
    slug: string;
    excerpt: string;
};
