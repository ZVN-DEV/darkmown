---
title: Collections and pagination, with zero ceremony
description: Any folder under site/pages is a queryable collection. Loop it by name, sort it, paginate it — all at build time, all zero-JS.
date: 2026-06-28
excerpt: This very page is an entry in a collection. The list you came from is one @loop over a folder — no content root, no marker file, no config.
schema: BlogPosting
tags: [collections, content]
---

# Collections and pagination, with zero ceremony

The page you came from is not a hand-maintained list of links. It is one
`@loop` over a *collection* — and a collection is just a folder. Every `.md`
and `.wd` file under `site/pages/blog/` is an entry, queryable by the folder's
bare name:

```wd
@loop blog where draft == false sort by date desc paginate 3 into post
- [{ post.title }]({ post.url }) — { post.date }
@endloop
```

No `content/` root to opt into, no marker file to drop in, no config object.
A folder of posts *is* the collection. Each entry's frontmatter becomes a row,
plus three fields the framework derives for you: `url` (the entry's route),
`slug` (its filename), and `excerpt` (the post's first paragraph when you don't
write one).

## It is the same loop you already know

There is no second loop syntax. `where`, `sort by`, `reverse`, `offset`,
`limit`, and the format pipes all work over a collection exactly as they do over
a JSON file — because under the hood a collection resolves to the same array of
rows. The only new word is `paginate N`, which slices the listing into static
pages: page one keeps this listing's clean route, and pages two and up live at
`/blog/page/2/`, `/blog/page/3/`, and so on. Every one is plain HTML.

A pure listing like this ships **zero** framework JavaScript. The pager links —
newer, older, numbered — are just `<a href>`s to the generated routes.
