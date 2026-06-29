---
title: Shipping feeds without a config file
description: Site identity lives in the home page frontmatter — one site_url field turns on sitemap.xml and rss.xml.
date: 2026-06-26
excerpt: One reserved frontmatter field on the home page — site_url — turns on the whole feeds story. No config loader, no plugin.
tags: [feeds, seo]
---

# Shipping feeds without a config file

Darkmown has no config file, so the site's public origin lives where the rest of
its identity already does: the home page frontmatter. Add `site_url` to
`site/pages/index` and the build emits `sitemap.xml` and `rss.xml`, reusing the
home `title` and `description` as the RSS channel fields.

Every page picks up a `<link rel="alternate" type="application/rss+xml">` so
feed readers can autodiscover the feed, and `robots.txt` points crawlers at the
sitemap. All build-time — not a byte of client JavaScript.
