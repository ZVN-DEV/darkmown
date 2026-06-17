# Sprint Plan — Darkmown
Generated: 2026-06-17
Based on: AUDIT-REPORT.md and current-thread product-review findings

## Sprint Goal
Make Darkmown more trustworthy for a launch reader by fixing visible demo/copy drift, hardening preview/server security edges, closing release-gate gaps, and improving accessibility/test proof without changing the core product model.

## Success Criteria
- [ ] All P1 issues resolved
- [ ] Security audit findings addressed or explicitly documented/deferred
- [ ] Runtime-size claims match measured artifact and remain under 5 KB gzipped
- [ ] `/app/` demo no longer renders blank bullets
- [ ] Malformed preview URLs do not throw/crash
- [ ] Release workflow runs CI-equivalent quality gates before publish
- [ ] Accessibility affordances improve without new dependencies
- [ ] Unit, typecheck, build, e2e, smoke, audit, extension tests pass

## Triage Summary
- P0: 0
- P1: 4
- P2: 6
- P3/deferred: 3

## Dev Tracks

### Track 1: Public Demo & Copy Truth — UX/Product Agent
**Files touched:** `README.md`, `CHANGELOG.md` if needed, `docs/spec-alignment.md`, `site/pages/index.wd`, `site/pages/app.wd`, `site/pages/docs/index.wd`, selected `.skin` files only if needed.
**Tasks:**
- [ ] TASK-01 (P1): Fix `/app/` feature loop field mismatch: use `feature.title` and `feature.body`, or update JSON consistently.
- [ ] TASK-02 (P1): Replace stale runtime-size copy with "~4.7 KB gzipped, CI-enforced under 5 KB" wherever current docs/site claim ~2 KB or ~3.2 KB.
- [ ] TASK-03 (P2): Add or preserve docs description frontmatter where missing, especially `site/pages/docs/index.wd`.
- [ ] TASK-04 (P2): Remove or reduce internal-process homepage copy if it distracts from user-facing proof; do not alter core examples.

### Track 2: Preview Server Hardening — Security/Backend Agent
**Files touched:** `src/statics.js`, `src/cli.js`, `tests/server.test.js`, `tests/cli.test.js`, `docs/cli.md` if CLI host docs change.
**Tasks:**
- [ ] TASK-05 (P1): Catch malformed percent-encoded request URLs in `resolvePublicFile()` and return `null` instead of throwing.
- [ ] TASK-06 (P1): Ensure `darkmown serve` handles resolver failures with generic 400/404 behavior instead of process crash/stack leak.
- [ ] TASK-07 (P2): Bind `dev` and `serve` to `127.0.0.1` by default, with `HOST` env override for intentional LAN exposure; update log output.
- [ ] TASK-08 (P2): Add regression tests for malformed URL handling and host/default CLI behavior where practical.

### Track 3: Release Gates & Deployment Honesty — CI/Release Agent
**Files touched:** `.github/workflows/release.yml`, `package.json`, `wrangler.toml`, `docs/cli.md` or deployment docs if needed, `tests/docs-snippets.test.js` if script docs are validated.
**Tasks:**
- [ ] TASK-09 (P1): Make tag release run CI-equivalent gates before publish: typecheck, coverage gate, e2e, build/runtime size, high audit, extension grammar, smoke.
- [ ] TASK-10 (P1): Strengthen local `prepublishOnly` or add a `prepublish:check` script so npm publish does more than `npm test`.
- [ ] TASK-11 (P2): Document or configure Cloudflare demo behavior for `/__wd/echo`; avoid implying the server form works on Cloudflare without a function route.

### Track 4: Compiler UX & Directive Safety — Compiler Agent
**Files touched:** `src/compiler.js`, `tests/unit-pipeline.test.js`, `tests/compiler.test.js`, `tests/unit-grammar.test.js`, `tests/docs-snippets.test.js` if needed.
**Tasks:**
- [ ] TASK-12 (P2): Add safe support for `aria-label` / `aria-describedby` on `:input` and `:bind`, preserving current whitelist style.
- [ ] TASK-13 (P2): Validate and escape demo-only `:try` hrefs; allow relative paths and `http:`, `https:`, `mailto:` only; reject `javascript:`.
- [ ] TASK-14 (P2): Add regression tests for the new accessibility attributes and unsafe `:try` href rejection.

## Conflict Plan
Estimated file conflicts: **zero** by track ownership. Track 1 owns public content. Track 2 owns server/static serving. Track 3 owns release/deploy config. Track 4 owns compiler grammar. If docs test expectations overlap, Track 3 owns script docs and Track 1 owns product copy.

## Intentionally Deferred
- First-party server runtime and HTML-fragment swaps: strategic feature work, not a trust-hardening sprint.
- Marketplace/Open VSX extension publication: external distribution action.
- Raw HTML default flip: breaking product-model change; this sprint preserves trusted-author model and improves adjacent safety issues.

## Manual Actions Required
- None for credentials or external services.
- If Cloudflare `/__wd/echo` should actually work in production, a Pages Function deployment decision may be needed after this sprint.
