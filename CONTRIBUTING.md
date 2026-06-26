# Contributing to Darkmown

Thanks for your interest! Darkmown is young and moving fast — small, focused PRs land quickest.

## Development setup

```sh
git clone https://github.com/ZVN-DEV/darkmown.git
cd darkmown
npm install
npm test        # node --test, should be all green
npm run dev     # live demo site at http://localhost:5173
```

There is no build step for the framework itself — `src/` is plain ESM JavaScript, Node >= 20.

### Code style

[Biome](https://biomejs.dev) handles linting and formatting. Run `npm run lint` to check and `npm run format` to apply fixes. A pre-commit hook (husky + lint-staged) runs Biome on staged files automatically, so a `git commit` keeps the tree consistent without extra steps.

## Repo map

- `src/compiler.js` — the heart: directive parsing, markdown-it integration, interpolation, scopes
- `src/runtime.js` — the browser runtime (keyed loops, bindings, fetch, forms). **Budget: < 5 KB gzipped**, enforced in CI
- `src/skin.js` — `.skin` → CSS
- `src/router.js` / `src/builder.js` / `src/statics.js` / `src/cli.js` / `src/dev.js` / `src/scaffold.js` — routing, build, static serving, CLI, dev reload, `init`
- `site/` — the demo site (also the dogfood: every feature must be demonstrated here)
- `tests/` — `node --test` suites; behavioral tests preferred

## Ground rules

1. **Every feature needs a test and a demo.** If it isn't exercised by `tests/` and visible somewhere under `site/pages/`, it doesn't exist.
2. **The runtime size budget is sacred.** Static pages ship zero JS; reactive pages share one sub-5 KB runtime. CI fails if `src/runtime.js` exceeds the budget.
3. **No arbitrary JS in content.** Directive grammars are compile-time-checked whitelists by design. Escape hatches live in colocated `.js` files via `window.wd` — not in `.wd` syntax.
4. **`.md` stays plain.** Never give `.md` files directive behavior. Renaming to `.wd` is the upgrade path.
5. **Friendly errors.** Compile errors must say what went wrong, in which file, and what to write instead.

## Before opening a PR

- `npm test` passes
- `npm run build` produces a clean `dist/`
- New directives are documented in `README.md` and the docs page

## Releases

Maintainers tag `vX.Y.Z` on master; CI publishes to npm and creates the GitHub release.
