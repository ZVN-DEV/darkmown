# Darkmown for VS Code

Syntax highlighting, snippets, and language support for [Darkmown](https://darkmown.com) — the Markdown framework.

## Features

- **`.wd` highlighting** — full Markdown highlighting plus Darkmown directives: `:state`, `:computed`, `:button`, `:if`/`:else`/`:endif`, `@loop`/`@endloop`, `@include`, `:fetch`, `:form`/`:input`/`:submit`, `::: section`, and `{ interpolation }`.
- **`.skin` highlighting** — selectors, the `tokens` block, `$token` references, `#hex` colors, and CSS-like properties.
- **Snippets** — type `:state`, `@loop`, `:if`, `:form`, `:::` and more to scaffold directives.
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

Build the extension from source and install the packaged `.vsix`:

```sh
cd editors/vscode
npx @vscode/vsce package
code --install-extension darkmown-*.vsix
```

A Marketplace listing is coming soon; it is not published yet.

## License

MIT — part of the [Darkmown](https://github.com/ZVN-DEV/darkmown) project.
