# State, Fetch & Loop Upgrades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three `.wd` capabilities — global `:store` state, a real fetch lifecycle, and full loop ergonomics — plus the two shared internals they ride on, without breaking the < 5 KB gzip runtime budget or the `runtime: false` static guarantee.

**Architecture:** Two shared internals land first (a safe `setPath` and an expanded action handler), then three features build on them. Compile-time validation + data-attribute emission in `src/compiler.js`; reactive behavior in `src/runtime.js`. Spec: `docs/superpowers/specs/2026-06-16-state-fetch-loop-upgrades-design.md`.

**Tech Stack:** Vanilla JS (no deps), `node --test`, Playwright (`tests/e2e/`), markdown-it. Runtime is browser-only, hand-written, size-budgeted.

---

## Dependency graph & concurrency

```
Task 0 (Foundation: setPath + actions)  ── BLOCKING, merge to base first
        │
        ├── Task 1 (Store)     ┐
        ├── Task 2 (Loops)     ├─ run concurrently in 3 worktrees off the Task-0 base
        └── Task 3 (Fetch)     ┘   (Fetch's dotted-loop-source overlaps Loops — see Task 3 note)
        │
Task 4 (Integration: merge, test, budget gate) ── serial, in main repo
Task 5 (Docs + demos per feature)             ── can run concurrently with Task 4 reviews
```

**Merge order into the integration branch:** Task 0 → Task 2 (Loops, establishes dotted loop-source resolution) → Task 3 (Fetch, consumes it) → Task 1 (Store). Run `npm test` after each merge.

## File structure (what each touched file owns)

- `src/runtime.js` — all reactive behavior. Add: `setPath`, expanded action `op` branches, `storeKeys`/store hydration + write-back + `storage` listener, `startFetch` rewrite (loading/empty/timeout/retry/dynamic/refetch), loop pipeline (sort/reverse/offset/limit) + per-row meta in `fillItem` + `@empty`. **Budget-critical — keep terse.**
- `src/compiler.js` — all compile-time parsing/validation/emission. Add: `setPath` path validation, `parseAction` new forms, `declareStore`, `:fetch` keyword-arg parser, `@loop` clause parser + `@empty` scan + dotted source resolution, `$`-meta recognition.
- `tests/unit-grammar.test.js` / `tests/unit-*.test.js` — runtime-grammar + compiler unit tests.
- `tests/compiler.test.js`, `tests/filter.test.js` — integration compile assertions.
- `tests/e2e/*.spec.js` — Playwright behavior tests (new files per feature).
- `site/pages/` — one live demo page per feature.
- `README.md`, `site/pages/docs/index.wd`, `docs/spec-alignment.md` — docs.

## Global rules for every task

- **TDD:** failing test → run (see it fail) → minimal impl → run (pass) → commit.
- **No raw eval.** New expressions validate to a whitelist at compile time before any `new Function`.
- **Proto guards** on every path read/write (`constructor`/`prototype`/`__proto__`).
- **Static stays static:** if a feature is used only over static sources, the page must still emit `runtime: false`. Add a regression test asserting this for each feature.
- **Budget:** after any `src/runtime.js` change, run the gzip-size check (see Task 4 for the command) and keep it < 5 KB.
- **Errors** include file path + a corrective `Use: …` suggestion.
- Run the **full** `npm test` before declaring a task done, not just the new test.

---

## Task 0 — Foundation: `setPath` + expanded action handler  *(BLOCKING)*

**Files:**
- Modify: `src/runtime.js` (add `setPath` near `getPath` at :46; extend the click handler at :258-287)
- Modify: `src/compiler.js` (extend `parseAction` at :1419-1469; add shared path-validation helper)
- Test: `tests/unit-grammar.test.js` (runtime-level op + setPath tests), `tests/compiler.test.js` (parseAction validation)

- [ ] **Step 1: Write failing tests for `setPath`.** Cover: nested create (`setPath({}, "a.b", 1)` → `{a:{b:1}}`), overwrite, and that `__proto__`/`constructor`/`prototype` segments are rejected (no pollution; `({}).polluted` stays undefined). Mirror `getPath`'s existing guard test style.
- [ ] **Step 2: Run, see fail.** `node --test tests/unit-grammar.test.js`
- [ ] **Step 3: Implement `setPath(obj, path, value)`** in `src/runtime.js`: split path; for each non-final segment reject the three poison keys and descend (creating `{}` when missing/non-object); reject poison final key; assign. Keep it ~8 lines.
- [ ] **Step 4: Run, see pass.**
- [ ] **Step 5: Write failing tests for new action ops** at the runtime level (simulate `state` + an `op`/`target`/`value` and assert the mutation): `sub`, `toggle` (boolean), `prepend`, `member-toggle` (add-then-remove same value), `remove-value`, `clear` (array→[], object→{}), `merge` (shallow), `delete` (object key), `reset` (restores seed from `initials`), and dotted targets for `inc`/`set` (`cart.count++`, `user.name = "x"`).
- [ ] **Step 6: Run, see fail.**
- [ ] **Step 7: Implement the ops.** Extend the click handler `if (op === …)` chain. Route reads through `getPath`/writes through `setPath` so any target may be dotted. Add an `initials` frozen snapshot captured at hydration (declared seeds, pre-localStorage) for `reset`. Keep branches one-liners; reuse helpers.
- [ ] **Step 8: Run, see pass.**
- [ ] **Step 9: Write failing compiler tests for `parseAction`.** Valid forms compile to the right `{op,target,value}`; invalid operands (non-whitelist chars) throw with a path + `Use: …` suggestion; `;`-separated sequences parse into an ordered list; dotted targets validated for poison segments.
- [ ] **Step 10: Run, see fail.**
- [ ] **Step 11: Implement `parseAction` extensions** + a shared `validatePath` used by actions/loops/fetch. Emit a sequence of `{op,target,value}` (array) when `;` present; otherwise single.
- [ ] **Step 12: Run, see pass. Then run full `npm test`.**
- [ ] **Step 13: Gzip budget check (Task 4 command). Commit.** `feat(actions): safe dotted-path setPath + full action vocabulary`

**Acceptance:** all new + existing tests green; budget < 5 KB; no behavior change to existing `inc/dec/add/append/set/remove/append-row`.

---

## Task 1 — Global state (`:store`)

**Depends on:** Task 0 (actions operate on store keys too).

**Files:**
- Modify: `src/compiler.js` (add `declareStore` near `declareState` :637; store emission; collision check)
- Modify: `src/runtime.js` (generalize hydration :18-32 + `savePersisted` :34; add `storeKeys`; `storage` listener)
- Test: `tests/compiler.test.js` (declaration/emission/collision), `tests/e2e/store.spec.js` (new)

- [ ] **Step 1: Failing compiler test** — `:store cart = []` registers a store, emits `<script type="application/json" data-wd-store="cart">[]</script>`, sets `runtime: true`. `:store x = 1 ephemeral` adds `data-wd-store-ephemeral`. `{ cart.items }` / `:if cart` / `@loop cart into i` resolve the store key.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement `declareStore`** + emission + register store names as resolvable declared keys (so interpolation/loops/conditionals see them). Page-global bare name even inside `:::`.
- [ ] **Step 4: Run, see pass.**
- [ ] **Step 5: Failing compiler test for errors** — duplicate `:store`, `:store`+`:state` same-name collision, invalid name → throw with path + `Use: :store name = value` suggestion.
- [ ] **Step 6: Run, see fail. Step 7: Implement validation. Step 8: Run, see pass.**
- [ ] **Step 9: Implement runtime hydration/persist** — generalize the persist loop to also read `wd:store:<name>` (seed + write if absent), collect non-ephemeral names into `storeKeys`, and make `savePersisted` write stores too. Capture seeds into `initials` (shared with Task 0 `reset`) BEFORE localStorage override.
- [ ] **Step 10: Implement `storage` listener** — on `wd:store:<name>` change for a known store, parse, deep-equal guard, write `state[name]`, `render()`. ~10 lines.
- [ ] **Step 11: Write `tests/e2e/store.spec.js`** — (a) mutate store, reload, value persists; (b) two browser contexts on same origin: mutate in A, assert B updates via storage event; (c) `ephemeral` store does NOT persist across reload; (d) `reset` action returns store to seed.
- [ ] **Step 12: Run e2e + full `npm test`. Step 13: Gzip check. Commit.** `feat(store): durable cross-tab :store directive`

**Acceptance:** store persists + syncs cross-tab; ephemeral doesn't persist; reset→seed; budget < 5 KB.

---

## Task 2 — Loop ergonomics

**Depends on:** Task 0 (light). Establishes dotted loop-source resolution that Task 3 reuses.

**Files:**
- Modify: `src/compiler.js` (`@loop` clause parser ~:910-1029; `scanLoop` for `@empty`; `$`-meta recognition; dotted source)
- Modify: `src/runtime.js` (loop region in `renderNow` :167-213 — pipeline + `@empty`; `fillItem` :130 — per-row meta)
- Test: `tests/filter.test.js` / `tests/compiler.test.js`, `tests/e2e/loops.spec.js` (new)

- [ ] **Step 1: Failing compiler tests** — parse `@loop xs into x where … sort by x.age desc reverse offset 1 limit 2`; emit `data-wd-loop-sort`, `-sort-dir`, `-reverse`, `-offset`, `-limit` (literal or `key:<name>`). Wrong clause order → error with `Use: @loop src into item [where …] [sort by …] [reverse] [offset N] [limit N]`.
- [ ] **Step 2: Run, see fail. Step 3: Implement clause parser. Step 4: Run, see pass.**
- [ ] **Step 5: Failing test for `@empty`** — `@loop … @empty … @endloop` emits an `[data-wd-loop-empty]` template; missing `@endloop` errors.
- [ ] **Step 6: Run, see fail. Step 7: Implement `scanLoop` split. Step 8: pass.**
- [ ] **Step 9: Failing tests for meta vars** — `{ $index }`, `{ $number }`, `:if $first`, `:if $last`, `{ $count }` inside a loop body compile to per-row markers; `$`-names outside a loop error.
- [ ] **Step 10: Run, see fail. Step 11: Implement meta recognition + emission. Step 12: pass.**
- [ ] **Step 13: Failing test — static loop stays `runtime: false`** — `@loop /data.json into x sort by x.n limit 2` over a JSON file resolves at build time, output contains the sorted/limited rows inline, `routes.json` says `runtime: false`.
- [ ] **Step 14: Run, see fail. Step 15: Implement build-time pipeline + dotted static source. Step 16: pass.**
- [ ] **Step 17: Implement reactive runtime pipeline** — in `renderNow` loop block apply order filter→sort→reverse→offset→limit (read limit/offset from literal or `state[key]`); compute `$index/$number/$first/$last/$count` per row; render `@empty` template when final list empty. Extend `fillItem` to fill meta markers.
- [ ] **Step 18: Write `tests/e2e/loops.spec.js`** — sort asc/desc order; limit/offset slice; reverse; `$index`/`$first`/`$last` correctness; `@empty` shows when filtered to zero; reactive limit via a `:state pageSize` button.
- [ ] **Step 19: Run e2e + full `npm test`. Step 20: Gzip check. Commit.** `feat(loop): sort/limit/offset/reverse + meta vars + @empty`

**Acceptance:** all clauses + meta + `@empty` work reactively and statically; static usage stays `runtime:false`; budget < 5 KB.

---

## Task 3 — Fetch lifecycle

**Depends on:** Task 0 (refetch action), Task 2 (dotted loop sources for `@loop fetched.items`).

**Files:**
- Modify: `src/compiler.js` (`:fetch` keyword-arg parser ~:652-671; auto-declare 4 keys; emit deps)
- Modify: `src/runtime.js` (`startFetch` rewrite :333-349; auto-refetch; `refetch` op; URL interpolation)
- Test: `tests/compiler.test.js`, `tests/e2e/fetch.spec.js` (new)

- [ ] **Step 1: Failing compiler test** — `:fetch team from "/x.json"` auto-declares `team`(null), `team_error`(null), `team_loading`(false), `team_empty`(false); emits marker with `data-wd-fetch-url/-method/-when/-timeout/-retry/-headers/-body/-deps`. Options validated; unknown option errors with `Use: :fetch name from "url" [method=…] [timeout=ms] [retry=N] [when=visible] [headers=key] [body=key]`.
- [ ] **Step 2: Run, see fail. Step 3: Implement parser + emission + dep extraction from `{ }` in URL. Step 4: pass.**
- [ ] **Step 5: Failing test — dynamic URL deps** — `:fetch user from "/u/{ userId }"` records `userId` in `-deps`.
- [ ] **Step 6: Run, see fail. Step 7: Implement. Step 8: pass.**
- [ ] **Step 9: Rewrite `startFetch`** — interpolate URL from state; skip if any dep var empty; set `*_loading=true`, `*_error=null`, render; `fetch(url,{method,headers,body,signal})` with AbortController timeout; retry N on network/5xx with backoff; on fail set `*_error`, `*_loading=false`, render; on ok parse JSON, set value, `*_empty=isEmpty(value)`, `*_error=null`, `*_loading=false`, render. Add shared `isEmpty`.
- [ ] **Step 10: Implement auto-refetch** — after mutation renders, if any fetch's dep snapshot changed, debounce ~150ms and re-run `startFetch`. Implement `refetch` action op (`<name> refetch`) that re-runs the matching fetch node.
- [ ] **Step 11: Write `tests/e2e/fetch.spec.js`** — loading→data (assert loading flips); non-2xx → `*_error` shown; timeout → error (route a hung response); empty `[]` → `*_empty` branch; dynamic URL refetch when a `:bind` field changes; `refetch` button re-loads; `@loop fetched.items into i` over a nested array.
- [ ] **Step 12: Run e2e + full `npm test`. Step 13: Gzip check. Commit.** `feat(fetch): loading/empty/timeout/retry/dynamic-url/refetch + dotted sources`

**Acceptance:** four-state lifecycle works; timeout/retry/method/headers/body honored; dynamic URL auto-refetches; dotted loop source resolves; budget < 5 KB.

---

## Task 4 — Integration, full test, budget gate  *(serial, main repo)*

**Files:** none new — merges + verification.

- [ ] **Step 1:** Merge feature branches into the integration branch in order Task 0 → 2 → 3 → 1; after EACH merge run `npm test` and resolve conflicts (the conflict surface is `src/compiler.js` + `src/runtime.js`; prefer keeping both features' branches — the tasks were scoped to different functions/regions).
- [ ] **Step 2:** Run full suite: `npm test`. All green.
- [ ] **Step 3:** Run E2E: the project's Playwright command (e.g. `npm run test:e2e` if present; otherwise `npx playwright test`). All green.
- [ ] **Step 4: Budget gate.** Run the repo's gzip-size check. If no script exists, measure: `npx esbuild src/runtime.js --bundle --minify | gzip -c | wc -c` and assert < 5120. Record the number in the PR.
- [ ] **Step 5: Static-guarantee regression.** Build the demo site (`npm run build` or equivalent) and assert every page that uses these features only over static sources still has `runtime: false` in `dist/routes.json`.
- [ ] **Step 6:** Regenerate `.d.ts` if the project ships types (recent commit history does). Commit.

**Acceptance:** unit + integration + e2e green; gzip < 5 KB recorded; static pages `runtime:false`; types regenerated.

---

## Task 5 — Docs + demos  *(per feature; can overlap Task 4 reviews)*

**Files:**
- Modify: `README.md` (sections for `:store`, fetch lifecycle, loop clauses)
- Modify: `site/pages/docs/index.wd` (entries for each)
- Create: `site/pages/store.wd` (+ optional `.skin`), `site/pages/loops.wd`, extend `site/pages/data.wd` for new fetch states
- Modify: `docs/spec-alignment.md` (flip the `:70` dotted-fetch-loop gap to supported; add the three features)

- [ ] **Step 1:** README sections with copy-paste examples for each feature (the four-state fetch pattern, a `:store` cart, a sorted/limited list with `@empty`).
- [ ] **Step 2:** Live demo pages exercising each feature; verify they render via `npm run dev`.
- [ ] **Step 3:** `docs/spec-alignment.md` updated. Commit.

**Acceptance:** docs match implementation; demos render; spec-alignment reflects new support.

---

## Self-review notes

- **Spec coverage:** Foundation→Task 0; `:store`→Task 1; loop clauses/meta/`@empty`→Task 2; fetch lifecycle/dynamic/options/refetch + dotted sources→Task 3; budget + static guarantee→Tasks 0-4 gates; docs→Task 5. No gaps.
- **Type consistency:** op names fixed as `sub/toggle/prepend/member-toggle/remove-value/clear/merge/delete/reset`; data attrs fixed as listed; `initials` map shared by Task 0 (`reset`) and Task 1 (store seeds); `isEmpty` shared by Task 3 (and reusable by loops `@empty`). `setPath`/`validatePath` shared across tasks.
- **Overlap risk:** dotted loop-source resolution is owned by Task 2 and consumed by Task 3 — enforced by merge order (2 before 3).
