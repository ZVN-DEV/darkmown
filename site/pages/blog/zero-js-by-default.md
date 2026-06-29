---
title: Zero JavaScript, by default
description: A Darkmown page ships no framework JavaScript unless it declares reactive behavior. The blog you are reading proves it.
date: 2026-06-25
excerpt: View source on this page. There is no runtime script tag, because nothing on it is reactive — and the framework knows the difference.
tags: [performance, philosophy]
---

# Zero JavaScript, by default

Open your browser's view-source on this post. Look for a `<script>` that loads a
framework runtime. There isn't one — and there isn't one on the blog index, or
on any of its paginated pages either. None of them declare reactive behavior, so
none of them pay for it.

That is the whole bargain. A `.md` file is plain CommonMark. Rename it to `.wd`
and you unlock directives — state, loops, conditionals — but you only ship the
~7.4 KB runtime on the pages that actually use them. A listing built from a
collection loop resolves entirely at build time, so it stays static HTML.

## The extension is the feature gate

There is no flag to toggle, no "static export" mode to remember. The compiler
tracks whether a page declared anything reactive and emits `runtime: false` into
`routes.json` when it didn't. A collection listing, a paginated archive, a page
of prose with a code block — all static, all cacheable on a CDN forever, all
fast on the first byte because there is nothing to hydrate.

When you do want an island of interactivity — a search box, a cart, a sortable
table — you declare it, and only that page loads the runtime. The rest of the
site stays weightless.
