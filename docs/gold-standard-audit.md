# Darkmown — Gold-Standard Open-Source Audit

Date: 2026-06-16 · Package: `@zvndev/darkmown@0.9.0` · Status: launch-readiness scorecard

## Summary

Darkmown is a mature pre-1.0 Markdown framework with the launch-critical trust pieces in place: typed public surface, unit/e2e/fuzz coverage, Dependabot, community files, release provenance, package smoke testing, and a public npm package. Audited across 10 gold-standard dimensions, it scores **48.5/50**. The remaining work is launch polish, not structural readiness.

## Current scorecard

| Dimension | Score | Key finding |
|-----------|-------|-------------|
| Testing | 5/5 | Unit, integration, fuzz, runtime DOM, CLI e2e, and Playwright browser tests are present; runtime size stays under the 5 KB gzip budget. |
| Error Handling | 5/5 | Compiler and CLI failures name the file/path and usually include a corrective `Use:` hint; dev/prod behavior is separated. |
| CI/CD | 5/5 | CI covers node tests, coverage, typecheck, e2e, build, size, audit, and editor grammar checks. |
| Build System | 5/5 | Deterministic `dist/` output, generated route manifest, colocated assets, and package tarball smoke coverage. |
| Security | 5/5 | One runtime dependency, high-severity audit gate, Dependabot for npm/actions, and documented `html:true` tradeoffs. |
| Code Organization | 4.5/5 | Modules are focused and acyclic; `src/compiler.js` remains the main future split candidate, deferred to avoid pre-launch churn. |
| Tech Debt | 4.5/5 | View transitions are intentionally parked with regression coverage; larger server/runtime ideas are documented as future scope. |
| Documentation | 5/5 | README, CLI docs, spec alignment, changelog, contribution guide, code of conduct, issue/PR templates, and CODEOWNERS are present. |
| Release Engineering | 5/5 | Public scoped package, MIT license, `prepublishOnly`, provenance release flow, and packed-consumer smoke test are in place. |
| Developer Experience | 4.5/5 | Three-command quick start, live reload, scaffold, syntax grammar, and generated types are present; editor distribution remains source-install until a Marketplace/Open VSX release is cut. |

**Overall: 48.5/50**

## Launch-readiness notes

- Public package metadata is live for `@zvndev/darkmown@0.9.0` and the project uses the MIT license.
- The v0.9 surface includes `@loop where`, `:bind`, per-row loop actions, nested `:if` in loop rows, `:fetch`, `:form`, `:computed`, persisted state, and scoped `window.wd` debugging.
- Static `.md` and non-reactive `.wd` pages still ship zero Darkmown runtime; reactive pages opt into the small shared runtime only when directives require it.
- Editor support is real as a source-installable VS Code extension with grammar tests. Marketplace/Open VSX publishing is post-launch distribution work, not an implementation gap.

## Remaining launch polish

1. Keep public docs and demo roadmap data aligned with shipped behavior before every release.
2. Make the scaffold and CLI docs showcase the distinctive reactive features without bloating first-run complexity.
3. Decide and document extension distribution channels before advertising Marketplace availability.
4. Continue package-content audits so shipped demo/source files are intentional.

## Deferred non-blockers

- Split `src/compiler.js` into smaller compiler phases after launch.
- Reintroduce view transitions only with browser fallback evidence.
- Explore first-party server/runtime features (`site/api/`, fragment swaps, server-side cart/session sync) as post-launch product bets.
