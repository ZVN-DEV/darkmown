---
title: Markdown-native, by default
description: Every post is a .md file; the index is one .wd loop.
date: 2026-02-02
excerpt: Every post is a plain .md file; the index is one .wd loop. The date in each post's frontmatter is what lands it in rss.xml.
transitions: true
---

[← All posts](/)

# Markdown-native, by default

To add a post, drop a Markdown file in `site/pages/posts/`. That folder is a
typed content collection, and the home page loops it directly:

```wd
@loop posts into post sort by post.date desc
### [{ post.title }]({ post.url })
@endloop
```

No manifest, no build config, no content layer. The file *is* the page, and its
frontmatter is the data — `site/pages/posts/_schema.wd` type-checks every
post's `title`, `date`, and `description` at build time, so a typo fails the
build with a file and line instead of shipping a broken list.

[← Back to all posts](/)
