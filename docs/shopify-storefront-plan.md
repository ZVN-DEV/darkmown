# Darkmown × Shopify headless storefront — project plan

Status: planning (2026-06-14). Separate project (`darkmown-shopify-starter` +
`@darkmown/shop` package). This doc lives in the framework repo because it
defines the **core primitives** the storefront needs; everything above those
primitives ships in the storefront package.

## Governing principle (decided)

> **Primitives live in core Darkmown. Anything higher lives in the
> `@darkmown/shop` package.**

A "primitive" is a general framework capability any data-driven site would want
(dynamic routes, looping over fetched data, parametrized fetch). Shopify-shaped
logic (GraphQL, carts, variants, auth) is not a primitive and never enters core.
This keeps core honest to "one loop, one syntax" while giving the storefront
everything it needs.

---

## 1. Architecture: the BFF seam

```
Shopify Storefront API (GraphQL)
        ▲  GraphQL + Storefront token
        │
   Fastify BFF (@darkmown/shop adapter) ──── build-time catalog pull ──► compiler
        │  exposes GET→JSON + urlencoded/JSON POST→JSON                     │
        ▼                                                                   ▼
   Darkmown reactive islands  ◄───────────────────────────  dist/ static HTML
```

**Why the BFF is structural, not optional.** Darkmown's wire primitives speak
two shapes only: GET-returns-JSON (`:fetch`, `src/compiler.js:393`) and
POST-returns-JSON (`:form action`, `src/runtime.js:158`). Shopify speaks GraphQL
POST with auth headers and cursor pagination. The Fastify BFF translates between
them, holds tokens, owns the cart cookie, and does build-time catalog pulls.
This is the "adapter-style Tier 2" already committed to in
`docs/spec-alignment.md:42`. **Core Darkmown still owns no server** — Fastify is
the reference adapter, shipped in the package; the contract is
backend-agnostic.

---

## 2. Core primitives (land in Darkmown framework)

These are the gating framework changes. Each respects the invariants:
compile-time-validated whitelists, runtime stays under 5 KB gzipped, static
pages stay `runtime: false`. None mention Shopify.

### P1 — Dynamic routes (build-time fan-out) — **highest priority**

One template renders N static pages from a data source. Nothing else in the
storefront works without this; it is also broadly useful (blogs, docs, OKF).

- Convention: `site/pages/products/[handle].wd`. The `[handle]` segment is a
  parameter.
- A build-time data binding supplies the list of params + per-page scope (e.g.
  from a JSON file the BFF pulled into `site/_/shop/`).
- Output: one static `index.html` per param value, each `runtime: false` unless
  the page itself declares state.
- Touch points: `src/router.js` (`discoverRoutes`/`routeFromFile` learn the
  `[param]` shape and expand against the dataset), `src/builder.js` (loop over
  expansions), `src/compiler.js` (param exposed in static scope, resolvable by
  `{ handle }` and interpolation priority order).

### P2 — `@loop` over fetched sub-paths

Already a known gap (`docs/spec-alignment.md:52`). Needed to loop `cart.lines`
or `search.products` *inside* a fetched/stateful object rather than only
top-level state.

- `@loop cart.lines into line` where `cart` came from `:fetch` or `:form into`.
- Pure extension of the existing one-loop concept — keyed reconcile already
  exists in `src/runtime.js`; this teaches the loop source resolver to walk a
  dotted path into reactive state.

### P3 — Parametrized / reactive `:fetch` URLs

Let a fetch URL interpolate state so search and filtering refetch on change —
still GET-returns-JSON, still BFF-mediated, no GraphQL in the client.

- `:fetch results from "/api/search?q={ query }"` re-fires when `query` changes.
- Touch points: `handleFetch` (`src/compiler.js:393`) emits the URL template +
  its state deps; `src/runtime.js` re-fetches on dep change (debounced).
- Keep `when=visible` working alongside.

### P4 — `:form … as=json`

JSON request body instead of urlencoded, for clean line-item mutations.

- Backward-compatible flag on the existing `:form action` path
  (`src/runtime.js:158-161` currently hard-codes urlencoded).
- Default stays urlencoded so the native-POST no-JS degradation is unchanged;
  `as=json` is opt-in and only affects the JS fetch path.

### P5 — `:select` bound to state (general form control)

A native `<select>` whose value writes state — a basic form control the
framework lacks. General-purpose (filters, sorts, any picker), not
Shopify-specific. The *variant* meaning is layered in the package.

- `:select size from sizes` (options from a state list) binds the chosen value.
- Compile-time whitelisted like other directives; emits a plain `<select>` with
  a `data-wd-bind`.

**Everything else is package-level.** If a proposed change names Shopify, carts,
GraphQL, or variants, it does not belong here.

---

## 3. Package: `@darkmown/shop` (the separate project)

Everything above the primitives. Ships independently of the framework version.

### 3a. Fastify BFF (reference adapter)

- **GraphQL client** to Storefront API with `@inContext(country, language)` for
  localization/markets; cursor-pagination helpers; colocated `.graphql` query
  modules.
- **REST facade** mapping Shopify GraphQL to Darkmown's two wire shapes:
  - `GET /api/collections/:handle?after=<cursor>&filter=…` → product-list JSON
    (consumed by `:fetch`).
  - `POST /api/cart/add|update|remove|note|discount` (urlencoded or, with P4,
    JSON) → updated cart JSON (consumed by `:form action into cart`).
  - `GET /api/search`, `GET /api/predictive`, `GET /api/recommendations/:id`.
- **Cart session:** BFF owns the Shopify `cartId` in an httpOnly cookie;
  Darkmown stays stateless and renders returned cart JSON. **This closes the
  "cart server sync is future work" gap** (`docs/spec-alignment.md:51`) by
  putting sync in the adapter, not the framework.
- **Build-time catalog pull** (`build/pull-catalog.js`): paginate all
  products/collections/content into JSON under `site/_/shop/` (for P1 dynamic
  routes + static rendering) and publish client-needed slices to the
  `/__wd/data/` shelf (the mechanism `:fetch` already reads,
  `site/pages/data.wd:17`).
- **Webhooks** → cache invalidation / incremental rebuild trigger.
- **Checkout:** never reimplemented — return `cart.checkoutUrl`, redirect to
  Shopify-hosted checkout (modern, PCI-offloaded path).

### 3b. Storefront authoring kit (Darkmown includes + colocated JS)

- Includes under `site/_/`: `product-card.wd`, `cart-drawer.wd`, `money.wd`
  (currency formatting via `:computed`), `variant-picker.wd` (built on P5),
  `pagination.wd` (built on P2/P3).
- Colocated `.js` via the `window.wd` escape hatch (`site/pages/data.wd:90`) for
  the genuinely interactive 30%: variant resolution, predictive-search
  debouncing, account-gated views.
- Customer Account API (OAuth2, the modern path) auth flow + order/address
  views.
- Selling-plan / subscription line-item helpers.

### 3c. Backend-agnostic contract

`docs/storefront-contract.md` (in the package): documents every endpoint, its
request shape (GET query / urlencoded / JSON body), and its JSON response shape.
Fastify is the reference; Hono/Express/Go can reimplement against the contract.
**This is the highest-leverage first artifact** — write it before code.

---

## 4. Static / reactive split (the differentiator)

| Surface | Tier | Mechanism |
|---|---|---|
| Product detail page | Static + tiny island | P1 static body/SEO; variant-picker (P5) + add-to-cart (`:form`) reactive |
| Collection page | Static + filter island | P1 grid; faceted filter via P3 |
| Home, blog, pages, policies, metaobjects | Static, zero JS | build pull → `.wd`/`.md` |
| Cart drawer / page | Reactive | `:state` + `:form action` to BFF; loop via P2 |
| Search (predictive + results) | Reactive | P3 + island JS; results page also static-renderable for SEO |
| Account | Reactive, auth-gated | Customer Account API via BFF |

Result: a 10k-SKU catalog ships as SEO-perfect static pages with framework JS
only on cart/search islands. No markdown framework does this.

---

## 5. Storefront API feature coverage

Legend: ✅ primitives + BFF · 🟡 `window.wd` island · 🔧 needs a core primitive (P#)

| Feature | Approach | Status |
|---|---|---|
| Products / variants / options | P1 static PDP + variant picker | 🔧 P5, 🟡 resolution |
| Product media / images | static `<img srcset>` at build | ✅ |
| Collections + cursor pagination | P1 grid + load-more | 🔧 P2/P3 |
| Faceted filtering / sorting | filter state → P3 refetch | 🔧 P3 |
| Predictive search (as-you-type) | island, P3 + debounce | 🔧 P3, 🟡 |
| Full search results page | static-renderable + refine | ✅ |
| Cart (add/update/remove/notes/attrs) | `:form action` into `cart` | ✅ (🔧 P4 for JSON) |
| Discount codes / gift cards | cart mutation endpoints | ✅ |
| Buyer identity / delivery / localization | `@inContext` in BFF | ✅ |
| Checkout | redirect to `cart.checkoutUrl` | ✅ |
| Customer accounts | Customer Account API OAuth via BFF | 🟡 |
| Selling plans / subscriptions | selling-plan in cart mutation | 🟡 |
| Product recommendations | `:fetch /api/recommendations/:id` | ✅ |
| Metaobjects / metafields content | build pull → static `.wd` | ✅ |
| Blog / articles / pages / policies | build pull → static markdown | ✅ |
| Menus / navigation | build pull → static include | ✅ |
| Inventory / availability | build pull + PDP recheck | ✅ |
| Markets / multi-currency | `@inContext` + `money.wd` | ✅ |

~70% is static or covered by existing `:fetch`/`:form`/`:state`. The
interactive remainder is unlocked by primitives P2–P5 plus the package's island
JS.

---

## 6. Phased roadmap

- **Phase 0 — Contract & spike (1 wk):** write `storefront-contract.md`; Fastify
  + Storefront client; one product end-to-end (build pull → static PDP →
  add-to-cart → checkout redirect). Proves the seam. Requires **P1**.
- **Phase 1 — Catalog (static core):** P1 + build pull. All PDPs, collections,
  content, menus, policies as static zero-JS pages. SEO, sitemap, structured
  data.
- **Phase 2 — Cart & checkout:** cart endpoints, cookie session, reactive cart
  drawer/page (P2, optionally P4), discounts, checkout redirect. Closes the
  cart-sync gap.
- **Phase 3 — Discovery:** search (predictive + results), faceted filtering,
  pagination (P2/P3), recommendations.
- **Phase 4 — Customer & markets:** Customer Account API auth, orders/addresses,
  localization/`@inContext`, multi-currency, subscriptions.
- **Phase 5 — Hardening:** webhook-driven incremental rebuilds, caching/ISR,
  rate-limit handling, perf-budget CI (extend the runtime-size test ethos),
  starter-template polish.

Core primitive sequencing: **P1 first** (gates everything), then P2/P3 for
Phase 2–3, P4/P5 alongside as their surfaces land.

---

## 7. Open decisions

- **Auth model:** Customer Account API (OAuth, modern, recommended) vs. legacy
  `customerAccessToken`. Recommend Customer Account API.
- **Rebuild strategy at scale:** full static rebuild (simple) vs. webhook-driven
  incremental (Phase 5) for large catalogs.
- **Token exposure:** Storefront tokens are public-scoped, but keep cart and
  customer flows behind the BFF regardless.
- **Primitive graduation:** P1 and P2 are general enough to live in core
  permanently; confirm P5 (`:select`) belongs in core vs. package before
  building — it is the most borderline.
