# OKF integration spec

Status: proposed (2026-06-14). Tracks Google Cloud's Open Knowledge Format (OKF
v0.1, published 2026-06-12).

## Why

OKF is, almost line for line, Darkmown's own substrate pointed at a different
consumer. An OKF bundle is:

- a **directory of markdown files** with **YAML frontmatter** (`type` required;
  `title`, `description`, `resource`, `tags`, `timestamp` optional),
- **markdown cross-links** forming a knowledge graph,
- optional `index.md` (progressive disclosure) and `log.md` (chronological
  history),
- rendered by a **static HTML visualizer with no backend**.

Darkmown already is "markdown + frontmatter + folder router -> static HTML, zero
JS." The audiences differ — OKF feeds AI agents org knowledge; Darkmown
publishes pages — but the format is the same. That overlap is the opportunity:
Darkmown can be the best OKF renderer *and* every Darkmown site can emit an OKF
bundle for agents, with very little new code.

This spec covers three increments, smallest first. #1 is a standalone
correctness fix and a prerequisite for the rest.

---

## 1. Array frontmatter (prerequisite, ships alone)

### Problem

`parseFrontmatter` (`src/compiler.js:89-101`) is line-based and scalar-only.
Today `tags: [sales, revenue]` is stored as the literal **string**
`"[sales, revenue]"`. OKF's `tags` is an array, so clean interop needs real
array parsing. This is worth doing regardless of OKF — it is a genuine gap in
the frontmatter parser.

### Change

In `parseFrontmatter`, after the `key: value` match, detect and parse inline
flow arrays:

- `tags: [a, b, c]` -> `["a", "b", "c"]`
- `tags: []` -> `[]`
- quoted items honored: `tags: ["a, b", c]` -> `["a, b", "c"]`
- non-array values keep current scalar behavior (`stripQuotes`)

Scope deliberately narrow:

- **Inline flow arrays only.** No multi-line block sequences (`- item` on
  following lines) in this pass — keep the parser single-pass and line-based.
- No nested objects, no numbers/booleans coercion beyond what `stripQuotes`
  already does. Values stay strings unless explicitly quoted-array items.
- Backward compatible: any frontmatter without `[` after the colon is unchanged.

### Touch points

- `src/compiler.js` — `parseFrontmatter`, plus a small `parseInlineArray` helper.
- Interpolation: `{ meta.tags }` should render arrays sensibly (join with `, `);
  `@loop meta.tags into tag` should iterate. Verify the loop source resolver
  accepts a frontmatter array the same way it accepts a JSON-file array.

### Tests (`tests/compiler.test.js`)

- `tags: [a, b]` parses to a 2-element array.
- Empty array, single element, quoted-item-with-comma.
- A scalar field next to an array field both parse correctly.
- `@loop` over a frontmatter array unrolls at build time (static, `runtime:
  false` preserved).

### Acceptance

`parseFrontmatter("---\ntags: [x, y]\n---\n")` returns
`{ meta: { tags: ["x", "y"] }, body: "" }`; a static page that loops over a
frontmatter array still emits `runtime: false` in `routes.json`.

---

## 2. OKF render mode — `darkmown build --okf <bundle>`

Treat an OKF directory as a content root and render it to static, zero-JS HTML.
This is the launch-worthy piece: OKF is days old and has no polished renderer
ecosystem; rendering markdown folders to static HTML *is* Darkmown's core
competency.

### Behavior

`darkmown build --okf ./bundle [--out dist-okf]`:

1. Walk the bundle directory (reuse the `discoverRoutes` walk shape from
   `src/router.js`, but without the `site/pages` assumption — accept an
   arbitrary root and `.md`/`.wd` files).
2. For each doc: parse frontmatter (now array-aware), render the markdown body
   through the existing markdown-it pipeline.
3. **Type-aware templates.** The required `type` field selects a render
   template. Ship a small built-in set keyed by common OKF types
   (`BigQuery Table`, `Dataset`, `Metric`, generic fallback). A
   `BigQuery Table` renders its `# Schema` table and `# Joins` link list with
   table-specific affordances; a `Metric` foregrounds its definition. Unknown
   types use the generic template. Templates are overridable from the bundle (a
   `_okf/templates/` convention) but built-ins cover the samples Google ships
   (GA4, Stack Overflow, Bitcoin).
4. **Cross-link graph.** OKF docs link with relative markdown links
   (`[customers](/tables/customers.md)`). Rewrite `.md`/`.wd` link targets to
   their output routes, and collect the edge list.
5. **Index / graph view.** Emit an `index.html` graph/overview from the
   collected edges + `index.md` files (progressive disclosure). Static HTML +
   CSS only — no backend, matching OKF's own visualizer constraint but
   zero-JS by default.
6. **Static invariant holds.** OKF render mode is a pure content transform; it
   MUST emit `runtime: false`. No directive may flip an OKF page reactive.

### Touch points

- New `src/okf.js` (render-mode entry: walk + template select + link rewrite +
  graph emit), wired into `src/cli.js` as a `--okf` flag / subcommand.
- Reuse `parseFrontmatter`, the markdown-it instance, and `compileFile` for the
  `.wd`/`.md` body. Do **not** fork the markdown pipeline.
- Link rewriter: small module mapping bundle-relative `.md` paths to routes.

### Tests

- A fixture bundle (a trimmed copy of an OKF sample) renders N HTML files.
- `type`-based template selection (table vs metric vs fallback).
- Cross-links rewrite to valid routes; the emitted graph has the right edges.
- Every output page is `runtime: false` (static invariant).

### Open questions

- OKF is v0.1 and explicitly evolving — track the spec, do **not** hard-code
  field assumptions beyond `type` required. Keep a `docs/spec-alignment` style
  note of which OKF version we target.
- Graph view richness: start with a static adjacency list + per-doc backlinks;
  an interactive force-graph is a later, opt-in island (would ship JS, so it is
  out of the zero-JS default).

---

## 3. OKF bundle emit — every Darkmown site becomes agent context

The inverse of #2: emit an OKF-compatible bundle *from* a built Darkmown site,
so any docs/content site is also a machine-readable knowledge base for agents.
No other markdown framework offers this.

### Behavior

During `buildSite` (`src/builder.js`), alongside `routes.json`, optionally emit
`dist/okf/` when configured (`okf: true` in config or `--emit-okf`):

- For each page, write an OKF doc: frontmatter (`type` defaulting to `page`,
  `title` from existing meta, `timestamp` from file mtime or git, `tags` from
  frontmatter) + the page's markdown body.
- Derive the link graph from the site's internal links and `@include` edges
  (the include resolver in `resolveInclude`/`compileFile` already knows these).
- Emit `index.md` files per directory for progressive disclosure.

`buildSite` already walks every page and writes a manifest
(`src/builder.js:21-44`); the emitter hooks the same loop. Largely free.

### Touch points

- `src/builder.js` — second emitter in the existing route loop; gather frontmatter
  + body + link edges already in hand.
- `src/config.js` — `okf` flag.

### Tests

- Built site produces a `dist/okf/` whose docs have valid frontmatter (`type`
  required) and whose links resolve within the bundle.
- Round-trip sanity: `--okf` render of an emitted bundle reproduces the pages.

---

## Sequencing

1. **Array frontmatter (#1)** — standalone, also a correctness fix. Merge first.
2. **OKF render mode (#2)** — depends on #1; the headline feature.
3. **OKF emit (#3)** — falls out of #2's plumbing.

## Invariants to respect throughout

- `.md` never gains directive behavior; OKF docs are content, rendered as
  content.
- No eval of bundle content; the `constructor`/`prototype`/`__proto__` path
  rejection in `getPath` and the compiler still apply.
- OKF render/emit are pure content transforms — `runtime: false` always.
- Compile/render errors include the offending file path and a corrective
  suggestion, matching existing compiler-error style.
