# OKF integration — plan & options

Status: **parked / decision pending** (2026-06-14). Research-verified; revisit when
we decide how far to take it. v0.8.0 (array frontmatter + readable `meta`) already
shipped the enabling groundwork.

## What OKF is (verified)

**Open Knowledge Format (OKF)** is real. Published **2026-06-12** by the Google Cloud
Data Analytics team (Sam McVeety, Amir Hormati).

- Announcement: <https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/>
- Spec: <https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md>
- Repo (Apache-2.0, `okf/` subdir): <https://github.com/GoogleCloudPlatform/knowledge-catalog>
- **Not** the Open Knowledge Foundation (unrelated nonprofit — do not conflate).

It is a **file format**, not a service: a directory of markdown "concept" files for
feeding organizational knowledge to AI agents. Each concept file has YAML frontmatter
where **`type` is the only required field**; `title`, `description`, `resource` (a URI
for the underlying asset), `tags` (a YAML list), and `timestamp` (ISO 8601) are
optional. Producers may add arbitrary keys; consumers must preserve unknown keys.

- **Cross-links** are ordinary markdown links between concept files (bundle-relative
  absolute like `/tables/customers.md` recommended). They are treated as **directed,
  untyped graph edges** — the relationship's meaning lives in surrounding prose.
- **Reserved files:** `index.md` (a directory listing for *progressive disclosure* — an
  agent navigates one level at a time) and `log.md` (chronological history). The root
  `index.md` frontmatter may declare `okf_version: "0.1"`.
- **Conformance is permissive:** consumers MUST tolerate broken links, unknown `type`
  values, unknown keys, and missing optional fields (so agent-generated, partial bundles
  still work).
- **Reference tooling (both labeled proof-of-concept):** a BigQuery *enrichment agent*
  that drafts OKF docs per table, and a *visualizer* — a `visualize` command that emits a
  single self-contained interactive HTML file (Cytoscape.js force-graph + marked.js body,
  no backend).
- **Sample bundles:** GA4 e-commerce, Stack Overflow, Bitcoin. ("BigQuery Table /
  Dataset / Metric" are concept *types inside* bundles, not separate samples.)

## Why it's interesting for Darkmown

OKF's entire surface — YAML frontmatter + a folder tree + relative markdown links →
static HTML — **is what Darkmown already does**. A `.md` tree with a `type:` field and
cross-links is *nearly an OKF bundle by accident*. Two directions:

1. **Darkmown as an OKF renderer.** Darkmown renders markdown bundles to static, zero-JS
   HTML — directly competitive with OKF's reference visualizer, which is OKF's weakest
   surface (a single JS-heavy HTML file).
2. **Every Darkmown site emits an OKF bundle.** Any docs/content site also becomes
   machine-readable agent context. No other markdown framework offers this.

## Why to be cautious

- **v0.1 "Draft," explicitly evolving.** Google's own blog: "a starting point, not a
  finished standard." Field names and required fields may change (minor versions promise
  backward-compatible additions only; breaking changes need a major bump).
- **Thin traction.** ~1.2k GitHub stars but ~8 issues, ~13 PRs, ~27 commits at launch.
  **No third-party adopters** — only Google's own Cloud Knowledge Catalog consumes it.
- **Governance unclear.** Lives under Google's repo with no foundation/working group.
- **Thin convention.** Net-new over "a markdown vault + Obsidian/Dataview" is small: one
  required field, two reserved filenames, link-as-edge semantics. Easy for others to
  ignore or fork.

## Decision (Kirby, 2026-06-14)

**Support OKF naturally; do not tie ourselves to it.** Treat it as a cheap, additive
interop convention, not a strategic bet or a core-model change.

## Options (revisit later)

### Option A — Do nothing more (status quo)
v0.8.0 array frontmatter already makes Darkmown frontmatter able to carry `tags` lists
and a `type` field. A Darkmown content tree with `type:` in frontmatter is already
~conformant. Cost: zero. Keep tracking adoption.

### Option B — Thin OKF emit (recommended first step if we act) — increment #3
A flag-gated export from a built site: `okf: true` in config or `--emit-okf`.
- During `buildSite` (`src/builder.js`), alongside `routes.json`, write `dist/okf/`.
- For each page, emit an OKF doc: frontmatter (`type` defaulting to `page`, `title` from
  meta, `tags` from meta, `timestamp` from file mtime/git) + the page's markdown body.
- Derive edges from internal links + `@include` edges (`resolveInclude`/`compileFile`
  already know these). Emit per-directory `index.md` for progressive disclosure.
- **Map at emit time** — do not restructure Darkmown's internal model around OKF.
- Effort: low; it hooks the existing route loop. Largely free.

### Option C — OKF render mode ("best OKF renderer") — increment #2
`darkmown build --okf ./bundle [--out dist-okf]`: walk an arbitrary bundle root, render
each doc (type-aware templates, generic fallback), rewrite `.md` cross-links to routes,
emit a static index/graph view. Reuse `parseFrontmatter`, markdown-it, `compileFile` —
do not fork the pipeline. Must stay `runtime: false`.
- **Gate this on OKF showing real external adoption.** Today you'd build a renderer for a
  format only Google uses. Higher effort, higher coupling risk.

### Sequencing if we proceed
1. (done) Array frontmatter + readable `meta` — v0.8.0.
2. Option B (emit) — additive, low-regret.
3. Option C (render) — only if the format gets stickier.

## Hard "avoid" list

- Don't hardcode Google/BigQuery `type` vocabularies (`BigQuery Table`, etc.) — `type` is
  uncentralized and producer-defined.
- Don't bet on v0.1 field names / required-field stability — map our frontmatter → OKF at
  emit time.
- Don't depend on OKF's reference enrichment agent or visualizer — both are proofs of
  concept. If we want a graph view, build our own; the format is trivial.
- Don't market "OKF-native" as a moat — it's a thin convention with thin adoption. A
  cheap interoperability checkbox, not a strategic bet.

## Invariants to respect (if/when we build)

- `.md` never gains directive behavior; OKF docs are content, rendered as content.
- No eval of bundle content; the `constructor`/`prototype`/`__proto__` rejection in
  `getPath` still applies.
- OKF render/emit are pure content transforms — `runtime: false` always.
- Compile/render errors include the offending file path and a corrective suggestion.

## Source

Full research briefing (cited): the research-investigator memory
`reference_okf_open_knowledge_format.md`, and `docs/spec-alignment.md` Stage 7.
