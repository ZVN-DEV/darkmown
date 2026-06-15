# Darkmown — Audit Report

Source: product-review run 2026-06-14 (inherited into product-sprint).
Overall rating at audit time: **7/10** (strong pre-1.0 framework, single author, ~36 commits over 4 days, 83 tests passing).

## Summary

Darkmown is real, working software. The core thesis (`.md` = zero framework JS, `.wd` = directives + sub-5KB runtime) is faithfully implemented and verifiable in built output. Runtime measured at 2,902 B gzipped (budget 5,120, CI-enforced). Security model is careful (whitelist grammars, prototype-pollution guards in compiler + runtime, include sandboxing, path containment). The gaps are honesty drift, an untested client runtime, and presentation polish.

## Findings by priority

### P0 — CRITICAL
None. No exploitable security vulnerability, no data loss, no broken core feature.

### P1 — HIGH (trust-breaking / honesty / biggest engineering gap)
- **H1 — View transitions advertised but hardcoded off.** `src/compiler.js:28` is `const transitions = ""`. CHANGELOG 0.2.0 and `docs/spec-alignment.md` still claim `transitions: true`. Stale claim → fix docs (keep feature disabled; re-enabling is out of scope).
- **H2 — "No eval" is inaccurate.** `:computed` and loop `where` run via `new Function` over compiler-whitelisted strings (`runtime.js:39,58`; `compiler.js:463,732`). Safe today but the marketing claim is false. Fix wording in README/SECURITY.
- **H3 — Runtime size copy wrong.** README/CLAUDE say "~2 KB"; actual is ~2.9 KB. Correct copy.
- **H4 — `html: true` markdown passthrough → stored XSS if untrusted content compiled** (`compiler.js:5`). By design for trusted authors, but no warning prominence and no opt-out. Add loud README warning; add `html` opt-out if cleanly doable.
- **H5 — No browser-side runtime tests.** All 83 tests are Node-side compiler/build. The keyed reconciler, fetch/form handlers, persistence, `structuredClone` dedup in `runtime.js` are CI-blind. Largest engineering gap.
- **H6 — Stale lockfile identity.** `package-lock.json` still names `markie-framework@0.1.0`, bin `markie`. Regenerate.
- **H7 — Tagline drift.** Four live taglines across README / hero / docs. Lock one canonical line.
- **H8 — Landing-page whitespace.** `site/pages/index.skin` hero (`min-height:60vh`) + compounding section margins produce large dead vertical bands; reads as broken layout. Highest-impact visual fix.
- **H9 — VS Code "install from Marketplace" claim unverified.** Extension at 0.1.0, no evidence published. Soften to build-from-source / coming soon.
- **H10 — `docs/cli.md` stale.** Lists init output missing `about.md` and `package.json` that `scaffold.js` actually writes.
- **H11 — Demo-only directives undocumented.** `:note`, `:try`, `:sprint` power landing copy but appear nowhere in docs; view-source users will try them. Document as demo-only or note clearly.

### P2 — MEDIUM (quality / correctness)
- **M1 — `escapeHtml` doesn't escape single quotes** (`compiler.js:1139`). Not reachable today (all attrs double-quoted) but a latent landmine. Add `'` → `&#39;`.
- **M2 — Silent `catch {}` swallowing** in `evalPredicate` (`compiler.js:728`), computed init (`compiler.js:461`), runtime recompute/predicate. A typo'd expression fails silently. Add dev-mode warnings.
- **M3 — Malformed frontmatter returns `{meta:{},body:raw}` silently** (`compiler.js:91-142`) rather than erroring. Mask author mistakes. Emit an actionable error/warning.
- **M4 — Loop reconcile at scale untested / unbatched.** `render()` re-runs every loop region and rebuilds the key map on every state change, including per-keystroke `:bind` (`runtime.js:104-152`). No rAF/batching. Add coalescing + a large-list test.

### P3 — LOW (skip unless trivial)
- Types/JSDoc/.d.ts (public surface is a CLI; low value this sprint) — SKIP.
- ESLint/Prettier — violates the deliberate zero-devDependency ethos; SKIP.
- Mobile nav overflow nit — fold into H8 if trivial.

## Out of scope (acknowledged, parked)
First-party server runtime / `site/api/`, cart server sync, HTML-fragment swaps, re-enabling view transitions (feature build, not a sprint fix).
