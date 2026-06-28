---
title: Unfinished thoughts (do not ship)
description: A work-in-progress post that demonstrates draft exclusion — it carries a date but never reaches a production feed.
date: 2026-06-28
draft: true
---

# Unfinished thoughts

This post is marked `draft: true`. It also has a `date:`, which would normally
land it in `rss.xml` and `sitemap.xml` — but because it is a draft, a production
build excludes it from both, and from `dist` and `routes.json` entirely. You are
only reading this in `darkmown dev` or a `build --drafts` staging build.
