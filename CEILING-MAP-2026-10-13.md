# Darkmown Ceiling Map

**Date:** 2026-10-13
**Basis:** Darkmown 2.8.0, the ToothDocs rebuild (67 routes of a real production marketing site), the friction report (FRICTION-REPORT-2026-10-13.md), the performance comparison against the live Next.js site, and the product review (PRODUCT-REVIEW-2026-10-12.md).

Darkmown's pitch is a floor: 0 KB of JS for a static page, 6.6 KB for a reactive one, no component framework. Every floor has a ceiling. This document maps exactly where the ceiling is, what kind of wall each part is, what you do when you hit it today, and whether the framework should grow, document, or permanently refuse each one.

The three wall types:

- **Grammar wall:** the whitelisted directive/action vocabulary cannot express it. Deliberate; this constraint is what makes pages compile-checkable and AI-authorable.
- **Architecture wall:** the build-time-only, no-server model cannot express it. Deliberate; this is what makes output static and cheap.
- **Ecosystem wall:** the thing exists but only as yours; no plugins, themes, or marketplace. A maturity wall, not a design wall.

---

## 1. Interactivity and logic

**Where the wall is:** the `:button`/`:effect`/`:every` action vocabulary is closed (`n++`, `list append v`, `obj merge`, `refetch`, etc.), predicates are comparisons only, and `:computed` is arithmetic plus five aggregates. No arbitrary expressions, no string composition, no branching logic beyond `:if`.

**Hit during the rebuild:** the booking page's intent composer (turn `?service=teeth-whitening&office=roslyn` into a pre-filled message sentence) cannot be expressed in the grammar. It went to a colocated `index.js` with `wd.subscribe`, about 40 lines.

**Escape hatch:** colocated `.js` with `window.wd` (`get`/`set`/`subscribe`). Works well; the discovery of bound inputs via `data-wd-bind-input` is now documented as of 2.8.0.

**Verdict: document, do not grow.** Every loosening of the action grammar spends the compile-validated property that makes the framework agent-authorable. The recipe docs (2.8.0) cover the canonical cases. Revisit only if a second client rebuild needs imperative logic for the same shape of problem.

## 2. Components and composition

**Where the wall is:** `@include` is a macro: static args, no children, no slots, no default values, no dynamic path. There is no component model and no layout inheritance; every page includes its own nav and footer.

**Hit during the rebuild:** service/doctor/legal pages share layout via includes with `with` args, which covers repeated shells but not true composition (a card that wraps arbitrary children cannot exist). The duplicated interior CSS problem was real enough to become 2.8.0's `skins:` frontmatter.

**Escape hatch:** includes with args, shared skins (2.8.0), generator scripts for repeated page families (the sync pipeline generates 41 pages from data).

**Verdict: grow, compile-time only (revised after owner review).** The include system IS Darkmown's component model, and it is the right one: macro expansion at build time costs zero runtime bytes and keeps the grammar closed. What it lacks is default argument values and children/slots, and both can be added as compile-time expansion without touching the runtime or opening the React-shaped door (the door is runtime components: props, lifecycle, hydration; none of that is on the table). Candidates for 2.9: `default:` values for include args, and a single-slot `children` expansion. Anything beyond that (nested reactive components, client-side composition) stays refused.

## 3. Server-side rendering and dynamic routes

**Where the wall is:** none. All HTML is build-time. Dynamic behavior is `api/` serverless functions plus client `:fetch`.

**Hit during the rebuild:** not hit. The ToothDocs site is static-shaped; its only server bits (lead endpoint, revalidate webhook) mapped directly onto `api/` functions.

**Verdict: refuse permanently.** SSR is the architecture wall that defines the product. The README Limits section already says so. The moment Darkmown renders on a server, it competes with Next.js on Next's terms and loses.

## 4. Content at scale and CMS

**Where the wall was, now moved:** before the rebuild the assumed wall was "content must live in the repo as Markdown." The rebuild proved the headless pattern: Capa CMS snapshot/API → `sync-cms.mjs` → generated `.wd` collections → build. 41 managed pages regenerate byte-identically in 0.05s off the snapshot, 1.4s against the live CDN.

**Remaining walls:** collections are folders of files, so a 10,000-entry collection means 10,000 files (fine for git, fine for the compiler at ~500 pages/sec, but editorially odd); no pagination beyond collection `paginate N`; no content drafts workflow beyond `draft: true`.

**Verdict: document the sync pattern as the official CMS story.** A `docs/content-from-cms` recipe (snapshot + sync + `--check` in CI + webhook to deploy hook, exactly what the demo repo does) turns an assumed ceiling into a feature. No framework change needed.

## 5. Assets: images and fonts

**Where the wall is:** Darkmown has no asset pipeline. It cannot resize images or subset fonts; 2.8.0 wires author-provided `name@640.ext` variants into srcset and documents the woff2/subset recipe, but the author (or a script) produces the variants.

**Hit during the rebuild, measured:** fonts cost 1.07 MB as raw TTFs vs 158 KB as subset woff2 (7x); headshots cost 1,045 KB vs 147 KB of CDN width variants (7x). Both are now half-solved: the demo generates variants with `cwebp` and the framework wires them.

**Verdict: grow, now approved for implementation.** Build-time image variant generation is the most valuable pipeline feature remaining, and the 2.8.0 `@width` convention plus srcset wiring is already the emission half; the missing half is generating the variants. Design constraint: the zero-dependency runtime stays. Generation rides an optional dependency (sharp), lazily loaded: present, the build emits variants automatically; absent, the build behaves exactly as 2.8.0 and prints one hint listing what it would have generated. Fonts stay a documented recipe for now (subsetting needs a font toolchain; revisit if the image path proves the pattern).

## 6. SEO and publishing surface

**Where the wall is:** mostly absent. Sitemap with sharding, RSS, robots with AI-crawler groups, llms.txt, JSON-LD whitelist, canonical/OG, and (2.8.0) `noindex` cover the marketing-site surface. Missing: i18n (hreflang, localized routes), docs versioning, built-in search, custom JSON-LD types beyond the five.

**Hit during the rebuild:** the client's 21 geo SEO pages (`/dentist/<area>`) were skipped as scope, not ceiling; they are a generator-script afternoon. The `/ai-disclaimer` page was a content gap, not a framework gap.

**Verdict: document geo-page generation (the sync pipeline already demonstrates it); refuse i18n for now.** i18n is a genuinely large feature that doubles the route tree's complexity; the answer today is "one site per locale" and that is fine at this stage.

## 7. State and data on the client

**Where the wall is:** `:state`/`:store`/`:fetch` cover page-level interactivity and cross-tab persistence. There is no offline sync, no optimistic mutation protocol, no realtime subscription, no client router (it's MPA by design; view transitions soften this).

**Hit during the rebuild:** never. Booking, forms, gallery wipes, carousels, filtering, URL state all fit. The slot-picker simplification was an app-logic call, not a state limitation.

**Verdict: refuse.** Realtime/offline is application architecture, and the framework's answer (point `:fetch`/forms at your own API) is the correct permanent answer.

## 8. Tooling and authoring experience

**Where the wall is:** errors arrive at build time, not keystroke time; the playground is single-file; the unpublished VS Code extension is highlight-only.

**Verdict: agent-first, editors deprioritized (revised after owner review).** Authoring now happens through coding agents, and Darkmown already leads there: the GBNF grammar, `catalog --llms-full`, the tools API, and `darkmown validate` are the authoring surface that matters, and they are exactly what an agent needs to write and repair pages reliably. The VS Code extension becomes "publish as-is if the Marketplace step is cheap, never build an LSP." If anything grows here, it is the agent surface: richer tools, better error-to-repair loops, playground share links.

## 9. Ecosystem

**Where the wall is:** no plugins, no themes, no community components, no hiring pool. The five templates and the agent-tool surface are the whole ecosystem today.

**Verdict: refuse to fake it, grow it only through real sites.** The ToothDocs demo repo (once public) is the template for this: real client site, real CMS pipeline, honest README. Ten of those is an ecosystem strategy; a plugin API before there are plugin authors is not.

---

## The one-line map

| Zone | Wall type | Hit on ToothDocs? | Verdict |
|---|---|---|---|
| Logic beyond the grammar | Grammar | Yes (booking intents) | Document |
| Component composition | Grammar | Partly (macros sufficed) | Grow, compile-time only (defaults, slots) |
| SSR / dynamic rendering | Architecture | No | Refuse permanently |
| CMS / content at scale | Assumed, now disproven | Yes, solved | Document the sync pattern |
| Image/font pipeline | Architecture (dependency rule) | Yes, measured 7x | Approved: optional-sharp build step (2.9) |
| SEO surface | None material | No | Document geo generation |
| Client state/realtime | Architecture | No | Refuse |
| Tooling surface | Maturity | Daily papercut | Agent-first; VS Code publish-only-if-cheap |
| Ecosystem | Maturity | N/A | Real sites, not plugin APIs |

**The ceiling is the product, and the map is the strategy.** The point of the refusals was never avoiding Next.js feature-for-feature; it is protecting the three properties that make Darkmown win its category (compile-checked closed grammar, 6.6 KB runtime, agent-authorable source). Everything else is in scope when it matters to a real site: the asset pipeline got approved because a 7x font/image tax is a real-world problem, and components grow where they stay compile-time. The test for any future ceiling question is one sentence: does this feature cost the grammar, the runtime budget, or the agent surface? If not, it is a candidate, not a refusal.
