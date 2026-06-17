# Audit Report — Darkmown Product Sprint
Generated: 2026-06-17
Based on: current-thread product-review and specialist audit findings

## Product Review Baseline
Darkmown is real, functioning software: Node.js ESM package, Markdown compiler, CLI, static build pipeline, tiny reactive runtime, demo site, VS Code grammar, tests, CI, and release automation. Verified before sprint: `npm test` passed 285 tests, `npm run test:e2e` passed 38 browser tests, `npm run smoke` passed, `npm audit --audit-level=high` found 0 vulnerabilities, runtime gzip was ~4.7 KB under the 5 KB budget.

Baseline rating from review: **7/10**.

## P0 / P1 Findings

### P1 — Trust-breaking demo bug
- `site/pages/app.wd:18-20` reads `feature.name` and `feature.detail`.
- `site/_/features.json:2-13` provides `title` and `body`.
- Built output renders blank bullets at `dist/app/index.html:35-45`.

### P1 — Stale core runtime-size claims
- `README.md:5` and `README.md:50` claim ~3.2 KB.
- `site/pages/index.wd:99`, `site/pages/index.wd:106`, and `site/pages/app.wd:22` claim ~3.2 KB or ~2 KB.
- Actual current built runtime is ~4.7 KB gzipped, still below the 5 KB budget.

### P1 — Static server malformed URL handling
- `src/statics.js:30-38` calls `decodeURIComponent()` without handling `URIError`.
- `src/cli.js:114` serve path calls the resolver without a handler; malformed URLs can throw/crash preview.

### P1 — Release workflow weaker than CI
- `.github/workflows/release.yml:20-59` runs `npm test` and pack smoke but skips typecheck, coverage, e2e, build size, audit, and extension grammar.
- `package.json:24` `prepublishOnly` only runs `npm test`.

## P2 Findings

### P2 — Dev/preview server binds all interfaces
- `src/cli.js:103`, `src/cli.js:114` use `server.listen(port)` without host.
- Logs say localhost but Node may bind broadly.

### P2 — Demo-only `:try` permits unsafe hrefs
- `src/compiler.js:1577-1578` injects href without escaping or scheme validation.

### P2 — Form accessibility weak
- `src/compiler.js:908-932` and `src/compiler.js:943-969` allow placeholders but not `aria-label` or equivalent.
- Demo forms rely on placeholder-only identification.

### P2 — Missing focus-visible polish and mobile verification
- Skins lack consistent explicit focus-visible states.
- Playwright only runs Desktop Chrome in `playwright.config.js:30-34`.

### P2 — Cloudflare deploy config misses demo `/__wd/echo`
- `vercel.json:7-11` rewrites `/__wd/echo` to `api/echo.js`.
- `wrangler.toml:1-6` only builds static output; no Cloudflare Pages Function equivalent.

### P2 — CLI/dev test coverage gaps
- Coverage shows `src/cli.js` and `src/dev.js` undercovered despite high total coverage.

## P3 / Deferred Findings
- First-party server runtime, HTML-fragment swaps, and server-side cart/session sync are not yet built and remain strategic future scope.
- Marketplace/Open VSX extension publication is a distribution follow-up.
- Package includes hidden demo/source files intentionally; keep documented unless package surface becomes a launch blocker.
