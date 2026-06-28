---
title: Markdown-native, by default
description: Every post is a .md file; the index is one .wd loop.
transitions: true
---

# Markdown-native, by default

To add a post, drop a Markdown file in `site/pages/posts/` and add a line to
`site/_/posts.json`. The home page loops that manifest:

```wd
@loop /posts.json into post sort by post.date desc
### [{ post.title }]({ post.url })
@endloop
```

No build config, no plugins, no content layer. The file *is* the page.

[← Back to all posts](/)
