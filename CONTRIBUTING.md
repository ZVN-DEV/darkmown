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

- `src/compiler/` — the heart: directive parsing, markdown-it integration, interpolation, scopes (split into cohesive modules; `src/compiler.js` is a thin re-export barrel)
- `src/runtime.js` — the browser runtime (keyed loops, bindings, fetch, forms). **Budget: < 8 KB gzipped**, enforced in CI
- `src/behaviors/`: pay-for-what-you-use modules (`sortable`, `carousel`) loaded only on pages that use them, each with its own size budget
- `src/skin.js` — `.skin` → CSS
- `src/highlight.js`: build-time syntax highlighting for fenced code
- `src/errors.js`: the `WDxxx` error registry (every author-facing error lives here)
- `src/catalog.js` / `src/grammar.js`: the machine-readable directive catalog, the `--llms` / `--llms-full` artifacts, and the generated GBNF grammar
- `src/tools/`: `@zvndev/darkmown/tools`, the in-memory agent tool surface (`outline`/`refs`/`deps`/`grammar`/`apply`/`validate`)
- `src/feeds.js` / `src/headers.js`: `sitemap.xml`/`rss.xml`/`robots.txt`, and the shipped security headers (`dist/_headers`)
- `src/deploy.js` / `src/api-runner.js`: `darkmown deploy`, and the local runner for `api/*` functions
- `src/router.js` / `src/builder.js` / `src/statics.js` / `src/cli.js` / `src/dev.js` / `src/scaffold.js` — routing, build, static serving, CLI, dev reload, `init`
- `src/templates/`: the `init` templates (`starter`, `blog`, `store`, `dashboard`, `landing`)
- `site/` — the demo site (also the dogfood: every feature must be demonstrated here)
- `tests/` — `node --test` suites; behavioral tests preferred
- `scripts/`: the generators and gates (`gen-errors.mjs`, `gen-grammar.mjs`, `size-check.mjs`, `test-coverage-gate.mjs`, `smoke-consumer.mjs`)

## Ground rules

1. **Every feature needs a test and a demo.** If it isn't exercised by `tests/` and visible somewhere under `site/pages/`, it doesn't exist.
2. **The runtime size budget is sacred.** Static pages ship zero JS; reactive pages share one sub-8 KB runtime. CI fails if `src/runtime.js` exceeds the budget in `.size-snapshot.json`, which is the single source for it.
3. **No arbitrary JS in content.** Directive grammars are compile-time-checked whitelists by design. Escape hatches live in colocated `.js` files via `window.wd` — not in `.wd` syntax.
4. **`.md` stays plain.** Never give `.md` files directive behavior. Renaming to `.wd` is the upgrade path.
5. **Friendly errors.** Compile errors must say what went wrong, in which file, and what to write instead, and carry a `WDxxx` code from `src/errors.js`.

## Regenerate what is generated

Two artifacts are generated from the compiler's own tables and are checked in. Re-run the generator in the same PR as the change, or a drift guard fails:

```sh
node scripts/gen-errors.mjs     # after touching src/errors.js  → docs/errors.md
node scripts/gen-grammar.mjs    # after touching the directive vocabulary → grammar/wd-directives.gbnf
```

Never hand-edit `docs/errors.md` or `grammar/wd-directives.gbnf`.

## Adding a directive

A new directive is not done until all five exist:

1. A test in `tests/`.
2. A live demo under `site/pages/`.
3. A `README.md` section.
4. The matching section on the docs page, `site/pages/docs/index.wd` (a parity test enforces this).
5. An entry in `docs/spec-alignment.md`, and parity in `AGENTS.md`, which is copied byte-for-byte into every scaffolded project, so a directive missing there is a directive coding agents will refuse to use.

Every `.wd` example you write in `README.md`, `AGENTS.md`, or the docs page is compiled by `tests/docs-snippets.test.js`. There is no comment syntax on a directive line, so annotate *outside* the fence.

## Before opening a PR

Run what CI runs. The full gate set is:

```sh
npm test                        # node --test, on Node 20/22/24 + Windows + macOS in CI
npm run test:cov                # coverage gate: 100% src line coverage
npm run typecheck               # JSDoc + checkJs
npm run lint                    # Biome (CI runs `npx biome ci .`)
npm run build                   # the demo site must build clean
npm run runtime:size            # runtime + behavior size budgets
npm run test:e2e                # Playwright; CI shards chromium / firefox / webkit
npm audit --audit-level=high    # dependency audit
```

CI also packages the VS Code extension and tokenizes `.wd`/`.skin` through the VS Code grammar engine, so a change to `editors/vscode` needs `npm run pack:extension` to keep working.

Then fill in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md), which is the short version of this page.

## Releases

Maintainers tag `vX.Y.Z` on master; CI publishes to npm and creates the GitHub release. Version numbers live in `package.json` only; the CLI version and the scaffold's pin both read it at runtime.
