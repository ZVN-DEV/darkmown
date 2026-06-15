# Sprint Plan — Darkmown

Generated: 2026-06-14
Based on: AUDIT-REPORT.md (inherited from product-review, 7/10)

## Sprint Goal
Close the honesty, runtime-testing, and presentation gaps so Darkmown *looks and reads* as finished and trustworthy as it actually is — without breaking the zero-dependency ethos or any existing test.

## Success Criteria
- [ ] All P0 resolved (none exist — vacuous)
- [ ] All P1 (H1–H11) resolved
- [ ] P2 quality fixes (M1–M4) addressed
- [ ] All 83 existing tests still pass; new runtime tests added
- [ ] No new runtime dependency added; zero devDependencies preserved
- [ ] No claim in docs that isn't backed by shipped code

## Canonical decisions (apply consistently across tracks)
- **Canonical tagline: "Markdown that runs."** (already the hero). Every other surface aligns to it.
- **View transitions stay disabled.** Do NOT re-enable. Remove the stale "shipped" claim from docs only.
- **`html: true` stays the default** (documented design). Add a loud warning; add an opt-out ONLY if it's clean and non-breaking, else leave a documented TODO.
- **Runtime size copy: "~2.9 KB gzipped (CI-enforced under 5 KB)".**

## Dev Tracks (zero file overlap)

### Track 1: Compiler hardening & correctness — owns `src/compiler.js`, `src/config.js`
**Tasks:**
- [ ] M1: `escapeHtml` (compiler.js:~1139) — also escape `'` → `&#39;`.
- [ ] M3: Malformed frontmatter (compiler.js:~91-142) — emit an actionable error/warning (with file path) instead of silently returning `{meta:{},body:raw}` when the closing `---` is missing.
- [ ] M2 (compiler half): dev-mode warning in `evalPredicate` (compiler.js:~728) and `:computed` initial eval (compiler.js:~461) `catch` blocks — log a `console.warn` with file + expression on failure instead of silent fallback. Gate behind a dev flag if one exists; otherwise warn unconditionally to stderr at compile time.
- [ ] H4 (opt-out, best-effort): evaluate adding a per-page/site `html` opt-out for markdown HTML passthrough (compiler.js:5, `new MarkdownIt({ html: true })`). If a clean, non-breaking implementation exists (e.g. a frontmatter `html: false` → a second MarkdownIt instance with `html:false`), add it with a test. If it can't be done cleanly without disrupting the single-instance design, DO NOT force it — leave a clear `// TODO(security): expose html:false opt-out` and let Track 3 handle the warning. Document whichever you chose.

### Track 2: Runtime hardening & first browser tests — owns `src/runtime.js`, new `tests/runtime-dom.test.js`
**Tasks:**
- [ ] H5: Add the first runtime tests. **Do NOT add jsdom or any dependency.** Use a minimal hand-rolled DOM stub inside the test file (enough nodes/attrs/children/classList to drive the reconciler), OR extract the pure helpers (`getPath`, `loopKeyOf`, computed/predicate compilation surface) and unit-test those directly. Cover at minimum: keyed loop reconcile (add/remove/reorder), `getPath` prototype-pollution rejection (`__proto__`/`constructor`/`prototype`), and `loopKeyOf` collision handling. Keep zero new deps; tests run under `node --test`.
- [ ] M4: Coalesce renders — batch state-change-triggered `render()` calls via `queueMicrotask`/`requestAnimationFrame` (guard for non-DOM/test env) so rapid `:bind` keystrokes don't each trigger a full O(regions×rows) pass. Preserve correctness (final state always rendered); add/adjust a test proving N rapid mutations cause 1 render.
- [ ] M2 (runtime half): dev-mode `console.warn` in runtime `recompute`/predicate `catch` blocks instead of silent `false`/`undefined`, guarded so it's quiet in production (e.g. only when `window.wd?.debug` or similar lightweight flag).
**Must NOT touch:** `src/compiler.js` (Track 1 owns the compile-side `loopKeyOf`/escaping). If a helper needs to be shared, only edit the runtime copy.

### Track 3: Docs, claims & brand honesty — owns `README.md`, `docs/cli.md`, `docs/spec-alignment.md`, `CHANGELOG.md`, `SECURITY.md`, `CLAUDE.md`, `editors/vscode/README.md`
**Tasks:**
- [ ] H1: Remove/correct the view-transitions "shipped" claim (CHANGELOG 0.2.0 entry, docs/spec-alignment.md). State it as not-currently-enabled / parked. Do NOT claim it works.
- [ ] H2: Fix every "no eval" / "no eval of user content" statement to be accurate: "No eval of raw user content; `:computed` and loop `where` expressions are compiled to a whitelisted grammar and run via `new Function`." Update README + SECURITY.md.
- [ ] H3: Correct runtime size copy to "~2.9 KB gzipped (CI-enforced under 5 KB)" everywhere (README, CLAUDE.md).
- [ ] H4 (warning): Add a prominent README + SECURITY.md warning that markdown HTML passthrough is `html: true` by design and Darkmown must NOT be used to compile untrusted/user-submitted markdown without sanitization. (Coordinate with Track 1's choice but DO NOT edit compiler — just document.)
- [ ] H7: Apply canonical tagline "Markdown that runs." to README line 3 and docs lead. (Track 4 applies it to the site hero — do not edit `site/`.)
- [ ] H9: Soften VS Code "install from Marketplace" to "build/install from source (`vsce package`); Marketplace listing coming soon" in editors/vscode/README.md and any README mention.
- [ ] H10: Sync `docs/cli.md` init-output list to actual `scaffold.js` output (add `about.md` and `package.json`).
- [ ] H11: Document `:note`, `:try`, `:sprint` as **demo-only directives** (not part of the public directive set) in docs, OR clearly note they exist only to power the demo site.
**Must NOT touch:** `site/**`, `src/**`.

### Track 4: Site & landing polish — owns `site/**`
**Tasks:**
- [ ] H8: Fix landing-page whitespace. In `site/pages/index.skin`, reduce the hero `min-height:60vh` and the compounding section margins so the page reads as intentional spacing, not broken layout. Verify the built page has no large dead vertical bands.
- [ ] H7 (site half): Set the hero tagline to the canonical "Markdown that runs." (it already is — confirm and keep consistent; align eyebrow/subcopy).
- [ ] P3 nit (if trivial): fix mobile nav overflow / horizontal scroll in `site/_/nav.skin` or the relevant skin.
**Must NOT touch:** `src/**`, `docs/**`, root `README.md`.

## Track summary
- 4 tracks, **zero expected file conflicts** (each owns a disjoint file set).
- package-lock.json regeneration (H6) handled by the lead in the merge phase (mechanical `npm install`, not agent work).
- Intentionally skipped: types/.d.ts, ESLint (both violate the zero-devDep ethos or have low value this sprint); re-enabling view transitions (feature build, out of scope).

## Manual actions for the user (none blocking)
- None. No credential rotation. Optionally publish the VS Code extension to the Marketplace later (then revert H9 wording).
