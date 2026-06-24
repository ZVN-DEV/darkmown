---
title: Plain Markdown
transitions: true
---

# Plain Markdown stays plain

This page is `markdown.md`. Darkmown renders it with a real CommonMark parser and adds nothing — no runtime, no directives, no surprises.

## Everything CommonMark works

1. Ordered lists
2. With proper numbering
   1. And nesting

> Blockquotes render correctly, including **inline emphasis**.

| Feature | Status |
| --- | --- |
| Tables | Working |
| Ordered lists | Working |
| Blockquotes | Working |
| Images | Working |

![Darkmown logo](/__wd/media/logo.svg)

## Directives stay inert here

The next line is `.wd` syntax, left as plain text on purpose:

:state count = 0

And `{ count }` braces in prose are just braces: { count }

Rename this file to `markdown.wd` and all of it comes alive. That is the whole upgrade path.

[Back home](/)
