---
title: Drafts that never leak
description: draft true excludes a page everywhere in a production build — dist, routes.json, sitemap, and rss.
date: 2026-06-27
excerpt: Set draft true on a post and it vanishes from a production build — dist, routes.json, the sitemap, and the feed — even with a date.
tags: [drafts, workflow]
---

# Drafts that never leak

Set `draft: true` on any page and it disappears from a production build — no
HTML in `dist`, no entry in `routes.json`, and crucially no entry in
`sitemap.xml` or `rss.xml`, even if the draft also carries a `date:`.

The filter lives at one chokepoint — route discovery — so every downstream
consumer only ever sees published pages. `darkmown dev` still builds and serves
your drafts (with a visible banner), and `darkmown build --drafts` includes them
for a staging preview.
