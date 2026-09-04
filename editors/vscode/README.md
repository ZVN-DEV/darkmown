# Darkmown for VS Code

Syntax highlighting, snippets, and language support for [Darkmown](https://darkmown.com) — the Markdown framework.

## Features

- **`.wd` highlighting** — full Markdown highlighting plus the whole directive set:
  - State and data: `:state` / `:store` (with `persist` and `ephemeral`), `:computed`, `:fetch` (and its `method` / `when` / `timeout` / `retry` / `headers` / `body` options), `:effect`, `:every`, `:theme`.
  - Structure: `@include`, `@loop` / `@empty` / `@endloop` (including the `where`, `sort by`, `reverse`, `offset`, `limit`, `paginate`, `sortable` clauses), `:if` / `:else if` / `:else` / `:endif`, `::: section`, `:carousel` / `:endcarousel`.
  - Forms and controls: `:form` / `:endform`, `:input`, `:textarea`, `:select`, `:checkbox`, `:radio`, `:submit`, `:bind`, `:slider`.
  - Media: `:video`, `:audio`, `:embed`.
  - Actions: `:button` and the closed action vocabulary (`++`, `--`, `+=`, `-=`, `=`, `toggle`, `append`, `prepend`, `remove`, `clear`, `merge`, `delete`, `reset`, `refetch`).
  - Values: `{ interpolation }` with its `| format:pipes`.
- **`.skin` highlighting** — selectors, the `tokens` block, `$token` references, `#hex` colors, and CSS-like properties.
- **Snippets** — one for every directive (type `:state`, `@loop`, `:if`, `:form`, `:carousel`, `:embed`, `:::` and the rest), plus `.skin` snippets for `tokens`, `scoped`, a rule, and a media query.
- **Folding** — `@loop…@endloop`, `:if…:endif`, `:form…:endform`, and `:::` sections fold.

## What it looks like

A `.wd` file is plain Markdown until a directive appears. The extension keeps prose rendering exactly like Markdown, and colorizes only the Darkmown layer on top — so a `.wd` file never looks "broken."

```wd
---
title: Hello
---

:state count = 0

Count: { count }

:button "Add" -> count++

@loop /features.json into feature
- **{ feature.name }** — { feature.detail }
@endloop
```

## Install

The extension is source-installable for launch. Build it from the repository root or from this folder, then install the packaged `.vsix`:

```sh
# From the repository root
npm run pack:extension
code --install-extension editors/vscode/darkmown-*.vsix

# Or from this folder
npx @vscode/vsce package
code --install-extension darkmown-*.vsix
```

Marketplace/Open VSX publishing is a post-launch distribution task; this README intentionally documents source installation until store listings exist.

## License

MIT — part of the [Darkmown](https://github.com/ZVN-DEV/darkmown) project.
