# Darkmown — Gold-Standard Open-Source Audit

Date: 2026-06-15 · Branch: `sprint/v0.9.0-proof-and-tests` · ~2,070 LOC src, 3,378 LOC tests (1.63:1)

## Summary
Darkmown is an unusually mature pre-1.0, single-author framework. Audited across 10 gold-standard dimensions, it scores **46.5/50** — a clear pass. The remaining gaps are cheap P1/P2 boilerplate (types, fuzz test, release smoke-test, dependabot, community files), not structural problems.

## Scorecard

| Dimension | Score | Key finding |
|-----------|-------|-------------|
| Testing | 5/5 | 1.63:1 test ratio, 96.5% coverage, behavioral e2e, node:vm DOM stub (zero-dep). Gap: no fuzz test. |
| Error Handling | 5/5 | Nearly every throw carries file path + `Use:` fix; dev/prod split via `wd.debug`. |
| CI/CD | 5/5 | 8 parallel jobs, concurrency-cancel + npm cache, new e2e + coverage jobs. |
| Build System | 5/5 | `dist/` not committed, deterministic build, runtime 3182 B gz (38% under budget). |
| Security | 5/5 | 0 vulns, 1 runtime dep, exemplary SECURITY.md + html:true footgun warning. Gap: no dependabot. |
| Code Organization | 4.5/5 | Clean acyclic modules, each single-purpose. `compiler.js` (1165 LOC) is the one split candidate (deferred — risky pre-release). |
| Tech Debt | 4.5/5 | ~0 TODOs/kLOC; view-transitions parking is exemplary. Gap: no issue link for it; repo-root clutter. |
| Documentation | 4.5/5 | Excellent README/CHANGELOG/spec-alignment + dual CLAUDE.md/AGENTS.md. Gap: no CoC/PR/issue templates/CODEOWNERS. |
| Release Engineering | 4/5 | Tag publish + provenance + great CHANGELOG. Gap: no pack smoke-test, no prepublishOnly. |
| Developer Experience | 4/5 | 3-command hello-world, great hot reload. Gap: no type safety on the published surface. |

**Overall: 46.5/50**

## Improvement plan (Stage 3 of v0.9.0 sprint)

**P1 (done this sprint):**
1. **Types** — `tsconfig.json` (`allowJs`+`checkJs`+`noEmit`+`strict`), JSDoc on exported functions, generated `.d.ts`, CI `typecheck` job. Adds `typescript` as a dev-only dep (runtime stays zero-dep). [DX 4→5]
2. **Fuzz test** — seeded property test: random `.wd` directive bodies + `:computed`/`where` expressions assert "compile produces valid HTML or throws a path-tagged Error — never crashes, never emits undefined." [Testing gap closed]
3. **Release pack smoke-test** — `npm pack` → install tarball in temp dir → `darkmown init && build` → assert `dist/index.html`, gating publish. [Release 4→5]
4. **`.github/dependabot.yml`** — npm (root + editors/vscode) + github-actions, weekly. [Security gap closed]

**P2 (done this sprint):**
5. `"prepublishOnly": "npm test"` guard.
6. Document + expose `window.wd.debug`.
7. `.github/PULL_REQUEST_TEMPLATE.md` + issue templates (mirror CONTRIBUTING's pre-PR checklist).
8. Short custom `CODE_OF_CONDUCT.md` (pledge + contact; not the full Covenant).
9. `.github/CODEOWNERS`.
10. Fix CONTRIBUTING.md repo-map drift (`src/server.js` → `src/statics.js`).
11. Repo-root hygiene: move sprint/audit markdown into `docs/`, gitignore screenshots.

**P3 (deferred — noted for later):**
- Split `compiler.js` into `frontmatter.js`/`predicate.js`/`loop-fill.js` (moderate refactor; risky right before release).
- Playwright firefox/webkit projects; pin GitHub Actions to SHAs; `extension` CI job → `npm ci` + cache.
