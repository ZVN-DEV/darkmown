<!-- Thanks for contributing to Darkmown! Keep PRs focused: one change per PR. See CONTRIBUTING.md for the full gate list. -->

## What & why

<!-- What does this change and why? Link any related issue: Closes #123 -->

## Checklist

- [ ] `npm test`, `npm run test:cov` (100% src lines), `npm run typecheck`, and `npm run lint` all pass
- [ ] `npm run build` is clean
- [ ] If the runtime or a behavior module changed: `npm run runtime:size` is within budget (`.size-snapshot.json`) and `npm run test:e2e` passes
- [ ] Touched `src/errors.js`? Re-ran `node scripts/gen-errors.mjs`. Touched the directive vocabulary? Re-ran `node scripts/gen-grammar.mjs`
- [ ] New/changed directive is **tested** (`tests/`), **demoed** (a page under `site/pages/`), and **documented** in all four places: `README.md`, `site/pages/docs/index.wd`, `docs/spec-alignment.md`, and `AGENTS.md`
- [ ] Every `.wd` example added to the docs compiles (`node --test tests/docs-snippets.test.js`), with annotations **outside** the fence
- [ ] Compile errors include the file path, a `WDxxx` code, and a corrective `Use: …` suggestion
- [ ] No new runtime dependency; `.md` files stay plain (the extension is the feature gate)
- [ ] Docs/claims match shipped behavior (no advertising disabled or unbuilt features)

## Notes for reviewers

<!-- Anything non-obvious, trade-offs, or follow-ups intentionally left out of scope. -->
