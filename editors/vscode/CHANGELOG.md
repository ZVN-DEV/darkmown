# Changelog

## 0.2.0 — 2026-09-04

The 0.1.0 grammar covered roughly a third of the language and highlighted three
directives that are demo-only. Both are fixed.

- **Highlighting for the missing two thirds.** `:store`, `:effect`, `:every`,
  `:theme`, `:bind`, `:slider`, `:carousel`/`:endcarousel`, `:video`, `:audio`,
  `:embed`, `:textarea`, `:select`, `:checkbox`, `:radio`, `@empty`, and
  `:else if` are now scoped instead of falling through to plain Markdown.
- `ephemeral` is recognised alongside `persist` on `:state`, and `:store` shares
  the same rule.
- `@loop` clauses (`where`, `sort by`, `reverse`, `offset`, `limit`, `paginate`,
  `sortable`, `asc`/`desc`) and their comparison operators are highlighted, as
  are format pipes inside `{ value | pipe }`.
- `:fetch` now highlights all of its options (`method`, `when`, `timeout`,
  `retry`, `headers`, `body`), not just `when=visible`.
- Action operators in `:button`, `:effect`, and `:every` cover the whole closed
  vocabulary, including `refetch`.
- **Removed `:note` and `:sprint`.** They are demo-only directives that the spec
  doc says are not public; highlighting them taught a vocabulary that does not
  exist. `:try` is still listed, so it stays.
- **Snippets for every directive.** The set went from 14 to 32 and now covers all
  25 catalog directives, plus `@empty` and `:else if`. A separate snippet file
  ships for `.skin` files (`tokens`, `scoped`, a rule, a media query).
- Every snippet is compiled by the framework's own test suite
  (`tests/gate-vscode-snippets.test.js`), so a snippet that does not compile
  cannot ship.

## 0.1.0 — 2026-06-12

- Initial release.
- `.wd` syntax highlighting: Markdown base plus Darkmown directives, sections, and `{ interpolation }`.
- `.skin` syntax highlighting: selectors, `tokens`, `$token` references, `#hex` colors, properties.
- Snippets for the common directives.
- Folding for `@loop`, `:if`, `:form`, and `:::` blocks.
