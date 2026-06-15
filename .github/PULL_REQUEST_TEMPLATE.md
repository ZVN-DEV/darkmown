<!-- Thanks for contributing to Darkmown! Keep PRs focused — one change per PR. -->

## What & why

<!-- What does this change and why? Link any related issue: Closes #123 -->

## Checklist

- [ ] `npm test` passes (zero-dependency suite, all green)
- [ ] `npm run build` is clean
- [ ] If the runtime changed: `npm run test:e2e` passes and the gzipped runtime stays **under 5 KB** (`size` job)
- [ ] New/changed directive is **tested** (`tests/`), **demoed** (a page under `site/pages/`), and **documented** (`README.md` + `site/pages/docs/index.wd`)
- [ ] Compile errors include the file path **and** a corrective `Use: …` suggestion
- [ ] No new runtime dependency; `.md` files stay plain (the extension is the feature gate)
- [ ] Docs/claims match shipped behavior (no advertising disabled or unbuilt features)

## Notes for reviewers

<!-- Anything non-obvious, trade-offs, or follow-ups intentionally left out of scope. -->
