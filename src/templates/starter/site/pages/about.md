---
title: About
---

# About

This page is plain Markdown (`.md`) — strict CommonMark, zero framework
JavaScript, and no raw HTML (Darkmown escapes it by default, so untrusted
content can't inject markup). That's why there's no shared nav bar here: a
`.md` page can't `@include` or use directives.

Rename it to `.wd` when you want that — state, loops, forms, and an
`@include /nav.wd` for the shared nav. The colocated `about.skin` styles this
page either way; it attaches automatically by basename, `.md` or `.wd` alike.

[Back home](/)
