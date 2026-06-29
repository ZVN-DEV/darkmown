---
title: Typed frontmatter with a four-line schema
description: Drop a _schema.wd in a collection and every entry is validated at build time — missing fields, wrong types, and typos all fail the build.
date: 2026-06-29
excerpt: A typo'd frontmatter key used to ship silently. With a collection schema, titel instead of title fails the build with a file and line.
tags: [collections, schema, dx]
---

# Typed frontmatter with a four-line schema

Frontmatter is convenient until a typo bites. You write `titel:` instead of
`title:`, the field silently becomes empty, and the bug surfaces as a blank
heading in production. Darkmown closes that gap with an *optional* schema — one
file at the collection root, frontmatter-shaped, written exactly like the
frontmatter it checks:

```wd
---
title: string
date: date
description: string
excerpt: string?
tags: string[]?
---
```

The vocabulary is small and closed on purpose: `string`, `number`, `boolean`,
`date`, and `string[]`, with a trailing `?` to make a field optional. That is
the whole DSL. An unknown type token is a compile error in the schema file
itself.

## What it catches

At build time, every entry in the collection is checked against the rules. A
missing required field, a value of the wrong type, or an extra field the schema
never declared each fails the build — and the error names the offending entry
by path and the field by name, so the fix is obvious:

```
Missing required field "date" (date) in /blog/example/ (collection "blog").
```

Validation is opt-in. No `_schema.wd`, no validation — the same posture as
`scoped` styles and the `draft` flag. Add the file when you want the guardrails;
leave it out while you are still sketching.
