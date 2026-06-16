# Design — Global state, fetch lifecycle, and loop ergonomics

**Date:** 2026-06-16
**Status:** Approved for planning
**Scope:** Three user-facing `.wd` capabilities plus two shared internals.

## Summary

Close the three gaps surfaced in the capability audit:

1. **Global state (`:store`)** — durable, cross-page, cross-tab shared state, plus a complete action vocabulary for both `:store` and `:state`.
2. **Fetch lifecycle** — `name_loading` / `name_empty` states, dynamic state-interpolated URLs with auto-refetch, `timeout` / `retry`, a `refetch` action, full HTTP (`method` / `headers` / `body`), and dotted loop sources over fetched data.
3. **Loop ergonomics** — `sort by`, `limit`, `offset`, `reverse`, per-row meta vars (`$index`, `$number`, `$first`, `$last`, `$count`), and an `@empty` branch.

All three lean on two shared internals introduced here: a **safe `setPath`** (mirror of the existing `getPath`) and an **expanded action handler**.

## Hard constraints (do not break)

- **`.md` never gets directive behavior.** Everything here is `.wd`-only.
- **One loop, one interpolation syntax.** We extend `@loop` and `{ … }`; we never add alternates.
- **Whitelisted grammar, no raw eval.** Sort keys, clause args, action operands, and URL interpolations all validate against explicit whitelists at compile time. `new Function` runs only on already-validated, compiled expressions (as `:computed`/`where` do today).
- **Prototype-pollution guards.** `getPath` already rejects `constructor`/`prototype`/`__proto__`; the new `setPath` must reject the same segments, in compiler AND runtime.
- **Static stays static.** A page that uses these features only over *static* sources (frontmatter, include args, JSON files, literal clause args) must still emit `runtime: false` in `dist/routes.json`. Reactivity is triggered only by touching `:state` / `:store` / `:fetch` data. This is a regression gate.
- **Runtime budget: < 5 KB gzipped (CI-enforced).** Currently ~3.2 KB. This is the dominant constraint for all three features. Every runtime addition must be measured; prefer terse, shared helpers over per-feature code. If the budget is threatened, we cut scope (see Budget strategy) rather than raise the limit.
- **Compile errors** include the file path and a corrective suggestion.

## Shared internals

### `setPath(obj, path, value)` — safe nested write

Mirror of `getPath` (`src/runtime.js:46`) and its compiler twin. Walks all but the last segment (creating plain objects for missing intermediate keys), rejecting `constructor`/`prototype`/`__proto__` at every segment, then assigns the final key. Used by every action whose target is a dotted path (`cart.count++`, `user.profile.name = "x"`). One implementation in the runtime; the compiler validates the path shape at compile time.

### Expanded action handler

Today actions are a flat `if (op === …)` chain in the runtime click handler (`src/runtime.js:266`) with ops `inc/dec/add/append/set/remove/append-row`, and `parseAction` validates the source forms in the compiler (`src/compiler.js:1419`). We extend both, keeping the data-attribute contract (`data-wd-action`, `data-wd-target`, `data-wd-value`).

**Targets become dotted-path aware.** Any action target may be `a.b.c`; the runtime reads via `getPath` and writes via `setPath`. A bare name is just a one-segment path.

**Action vocabulary** (applies to `:state` and `:store` identically):

| Category | Source form (after `->`) | op |
|---|---|---|
| Number | `n++` | `inc` |
| Number | `n--` | `dec` |
| Number | `n += k` | `add` |
| Number | `n -= k` | `sub` |
| Scalar/any | `name = v` | `set` |
| Boolean | `flag toggle` | `toggle` |
| Array | `list append v` / `list += v` | `append` |
| Array | `list prepend v` | `prepend` |
| Array | `list toggle v` | `member-toggle` (add if absent, else remove by value) |
| Array | `list remove item` (loop row) | `remove` (existing) |
| Array | `list remove v` (value) | `remove-value` |
| Array | `list clear` | `clear` (also empties objects) |
| Array (loop) | `cart += item` | `append-row` (existing) |
| Object | `obj.key = v` | `set` (dotted target) |
| Object | `obj merge other` | `merge` (shallow; `other` = state/store key or inline JSON) |
| Object | `obj delete key` | `delete` |
| Universal | `name reset` | `reset` (restore declared initial) |

Disambiguation rules:
- `toggle` with no operand → boolean `toggle`; with an operand → array `member-toggle`.
- `remove <token>`: if `<token>` is the active loop item name → `remove` (current row); otherwise → `remove-value`.
- `+= ` keeps existing runtime behavior: numeric target → `add`, array target → `append`/`append-row`.

`reset` requires the runtime to know each key's declared initial value. The runtime snapshots the **declared seeds** — the JSON parsed from `data-wd-state` / `data-wd-store` scripts **before** localStorage hydration overrides them — into a frozen `initials` map. `reset` deep-clones from `initials[name]`, so a persisted store resets to its declared seed (not its last persisted value), then write-back/render run as usual.

**Operand grammar** (compile-validated): number / string / boolean / null literal; a state/store/loop dotted path; or — for `merge` only — an inline JSON object literal. No other characters permitted (same whitelist discipline as `:computed`).

**Multiple actions per button:** `->` may carry a `;`-separated sequence (e.g. `cart append item; cart_count++`). Each is parsed/validated independently; the runtime applies them in order, then renders once. (If the current grammar already forbids `;`, this is purely additive.)

---

## Feature 1 — Global state (`:store`)

### Directive

```
:store <name> = <value> [ephemeral]
```

- `<name>`: identifier `[A-Za-z_$][\w$]*`. Page-global (never section-scoped, even inside `:::`). Declare at page top level by convention.
- `<value>`: same literal grammar as `:state` (string / number / bool / null / JSON array / object).
- `ephemeral`: opt out of persistence — in-memory for the page session only, no localStorage, no cross-tab sync.
- **Durable by default.** Persisted to `localStorage["wd:store:<name>"]`.

Compile-time: `declareStore` parallels `declareState` (`src/compiler.js:637`). Registers in a `comp.stores` map. **Errors:** declaring the same store twice; declaring a `:store` and `:state` with the same name on one page (collision); reserved/invalid name. Each error includes path + suggestion.

Emission: a `<script type="application/json" data-wd-store="<name>" [data-wd-store-ephemeral]>` carrying the seed value. Sets `comp.assets.runtime = true`.

### Runtime

- **Hydration:** generalize the existing persist block (`src/runtime.js:18`). For each `data-wd-store` script: if `wd:store:<name>` exists in localStorage, use it; else seed with the declared value and write it. Non-ephemeral store names go into a `storeKeys` set.
- **Write-back:** generalize `savePersisted` (`src/runtime.js:34`) so it also writes `wd:store:<name>` for every store key after each mutation. (Existing `persist` keys keep the `wd:<key>` prefix.)
- **Cross-tab sync:** one `window.addEventListener("storage", …)` listener. On a `wd:store:<name>` change for a known store key, parse the new value, write `state[name]`, and `render()`. Echo guard: skip if the parsed value deep-equals current (JSON compare) — the `storage` event already doesn't fire in the writing tab, so this is just belt-and-suspenders.

### Reads

Stores register as declared keys, so `{ cart.items }`, `:if cart`, `@loop cart into …`, `:computed`, and all actions resolve them with no interpolation changes. The store and state namespaces share the runtime `state` object; the compile-time collision check keeps them disjoint.

### Initial-value semantics

The declared value is a **seed**, applied only when the store is absent from storage. First write wins thereafter. Different pages declaring different seeds for one store is the author's responsibility (document in README; a dev-mode console warning is a possible later add, not in scope).

---

## Feature 2 — Fetch lifecycle

### Directive

```
:fetch <name> from "<url>" [method=GET] [when=load|visible] [timeout=<ms>] [retry=<N>] [headers=<key>] [body=<key>]
```

- `<url>`: quoted string; may contain `{ <path> }` interpolations resolving against state/store (same resolver as text interpolation, restricted to the safe-path whitelist).
- `method`: `GET` (default) / `POST` / `PUT` / `PATCH` / `DELETE`.
- `when`: `load` (default) or `visible` (existing IntersectionObserver path).
- `timeout`: integer ms → AbortController; on abort, set `name_error`.
- `retry`: integer; retry on network error / 5xx with simple backoff before surfacing the error.
- `headers`: a state/store key holding an object (sent as request headers).
- `body`: a state/store key (JSON-serialized as the request body for non-GET).

Compile-time (`src/compiler.js:652`): extend the `:fetch` parser to a keyword-args grammar. Validate each option; unknown options error with a suggestion. Auto-declare four state keys: `name` (null), `name_error` (null), `name_loading` (false), `name_empty` (false). Record URL/header/body interpolation dependency keys for auto-refetch. Emit them on the marker: `data-wd-fetch-url`, `-method`, `-when`, `-timeout`, `-retry`, `-headers`, `-body`, `-deps`.

### Runtime — `startFetch`

Rewrite `startFetch` (`src/runtime.js:333`):

1. Interpolate the URL from current state. If any required interpolation var is empty/null/undefined → set `name_loading = false` and **skip** (don't fire). 
2. Set `name_loading = true`, `name_error = null`, `render()`.
3. Build `fetch(url, { method, headers, body, signal })` with an AbortController armed to `timeout`.
4. On `!response.ok` or network error → if attempts remain (`retry`), back off and retry; else set `name_error = String(err)`, `name_loading = false`, `render()`.
5. On success → parse JSON; set `name = value`; `name_empty = isEmpty(value)` (true for `null`, `[]`, `{}`); `name_error = null`; `name_loading = false`; `render()`.

`isEmpty` is a tiny shared helper.

### Auto-refetch

For each fetch with non-empty `-deps`, when any dependency key changes the runtime debounces (~150 ms) and re-runs `startFetch`. Implementation: after every action/bind/store mutation render, compare dependency snapshots; on change, schedule the debounced refetch. (Hook into the existing mutation paths rather than a global proxy, to stay terse and budget-safe.)

### `refetch` action

New action op: `<name> refetch` re-invokes `startFetch` for that fetch node. Lets `:button "Reload" -> team refetch` or any action sequence re-trigger a load.

### Dotted loop sources

`@loop team.members into m` — resolve the loop source as a dotted path against state/store/fetched data (compiler validates the path; runtime reads via `getPath`). Closes `docs/spec-alignment.md:70`. Static dotted sources (e.g. over a JSON file's nested array) resolve at build time and stay zero-JS.

### Recommended four-state pattern (docs)

```
:if team_loading
  Loading…
:else
  :if team_error
    Failed: { team_error }
  :else
    @loop team into m
      …
    @empty
      No members yet.
    @endloop
  :endif
:endif
```

(`@empty` from Feature 3 absorbs the empty case, so `name_empty` is mainly for non-loop fetched values.)

---

## Feature 3 — Loop ergonomics

### Clause grammar

```
@loop <src> into <item> [where <P>] [sort by <key> [asc|desc]] [reverse] [offset <N>] [limit <N>]
  …body…   ({ $index } { $number } { $first } { $last } { $count } available)
@empty
  …shown when the rendered set is empty…
@endloop
```

- **Fixed clause order** for a simple parser: `where` → `sort by` → `reverse` → `offset` → `limit`.
- **Pipeline order** (applied in the runtime / at build time): filter (`where`) → sort → reverse → offset → limit → render.
- `sort by <key> [asc|desc]`: `<key>` is `item` or `item.<path>` (validated). Comparator: numeric when both values are numbers, else `String(...).localeCompare`. Stable. `asc` default.
- `reverse`: reverse the (possibly sorted) order. With no `sort by`, reverses source order.
- `offset <N>` / `limit <N>`: `<N>` is a non-negative integer literal **or** a state/store key (enables reactive pagination, e.g. `limit pageSize`).

### Meta variables

Available inside the loop body, relative to the **rendered** slice (post-pipeline):

- `$index` — 0-based position.
- `$number` — 1-based (`$index + 1`).
- `$first` — boolean, `$index === 0`.
- `$last` — boolean, `$index === count - 1`.
- `$count` — number of rendered rows.

Usable in interpolation (`{ $index }`) and in `:if` (`:if $first`). Compiler recognizes the `$`-prefixed reserved names; they never collide with user identifiers (which can't be these exact reserved words inside a loop). Build-time loops compute them during unroll; reactive loops inject them per row during reconcile (`fillItem`, `src/runtime.js:130`).

### `@empty`

A branch inside the loop, rendered when the final (post-pipeline) row count is 0. Compiler `scanLoop` splits body vs empty branch. Runtime: when the reconciled list is empty, render the empty template into the loop's output; otherwise render rows as today. Static loops resolve the branch at build time.

### Static vs reactive

All clauses are build-time when the source and every clause argument are static → `runtime: false` preserved. The loop becomes reactive only if the source is `:state`/`:store`/fetched, or any clause arg (`limit pageSize`, a `where` touching state) references reactive data. Emit clause config as `data-wd-loop-sort`, `-sort-dir`, `-reverse`, `-offset`, `-limit` (literal or `key:<name>`), and an `[data-wd-loop-empty]` template.

---

## Testing strategy

Every feature follows the project's full pyramid (per `CLAUDE.md` workflow):

- **Unit (compiler):** directive parsing, validation errors (with path + suggestion), correct data-attribute emission, static-vs-reactive determination, `runtime: false` preservation for static usages.
- **Unit (runtime grammar):** `setPath` proto-guards; each new action op; clause pipeline order; meta-var values; `isEmpty`.
- **Integration:** compile a `.wd` fixture per feature and assert HTML/attribute output.
- **E2E (Playwright, `tests/e2e/`):** store persistence across reload; cross-tab sync (two contexts sharing one origin); fetch loading→data, loading→error (timeout + non-2xx), empty; dynamic-URL refetch on state change; `refetch` button; sort/limit/offset/reverse render order; `$index`/`$first`/`$last`; `@empty` rendering.
- **Regression gate:** a static page exercising sort/limit/`@empty`/dotted-source over a JSON file must report `runtime: false`.
- **Budget gate:** the existing gzip-size CI check must still pass (< 5 KB).

## Budget strategy (runtime < 5 KB gzip)

Order of implementation is chosen so the cheapest, highest-value runtime code lands first and we measure continuously:

1. Shared `setPath` + expanded actions (small, high leverage).
2. `:store` hydration/persist/cross-tab (reuses persist machinery).
3. Loop clauses + meta + `@empty` (mostly compiler; runtime adds a sort/slice + per-row meta).
4. Fetch lifecycle (largest runtime cost: timeout/retry/dynamic/refetch).

After each step, run the gzip check. If approaching 5 KB, cut in this order: (a) drop `retry` backoff sophistication to a flat retry; (b) gate cross-tab sync behind presence of any non-ephemeral store (already the case); (c) move auto-refetch dependency tracking to compile-time-emitted explicit dep lists (already the plan) to avoid runtime bookkeeping. Raising the 5 KB limit is not an option.

## Documentation deliverables (per `CLAUDE.md`)

For each feature: `README.md` section, `site/pages/docs/index.wd` entry, a live demo under `site/pages/`, and a `docs/spec-alignment.md` update (notably flipping the `:70` dotted-fetch-loop gap to supported).

## Out of scope (YAGNI)

- Dedicated `.store` file format / cross-page store imports (chose the `:store` directive instead).
- Multi-key / secondary sort; grouped/`group by` iteration; object-entry (`key,value`) iteration.
- `:if` expression operators (route through `:computed`, unchanged).
- `$total` (pre-limit count) meta var — `$count` is the rendered count; revisit if demand appears.
- Streaming/SSE/websocket fetch; request cancellation API beyond `timeout`.
