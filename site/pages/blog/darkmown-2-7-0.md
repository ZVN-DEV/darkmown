---
title: "Darkmown 2.7.0: no more silent failures"
description: A release built around one question asked of every code path, when this goes wrong does the author find out. Plus a minified runtime that paid for five new features.
date: 2026-09-04
excerpt: A brace in a link destination used to stay literal text with no warning. A line that was just ":state" rendered as prose. Both are fixed, and the runtime got small enough to afford five new features.
schema: BlogPosting
tags: [release, compiler, runtime]
---

# Darkmown 2.7.0: no more silent failures

Most framework bugs announce themselves. You get a stack trace, a red screen,
a test that goes from green to red. The bugs worth being afraid of are the
other kind: the page compiles, the build says `Built 38 routes`, and something
on it is quietly wrong.

This release came out of an audit that asked one question of every path in the
compiler, the builder and the runtime. **When this goes wrong, does the author
find out?** Too often the honest answer was no.

Four examples, all of which shipped in 2.6.0 and none of which printed a word:

- `[Read more](/docs/{ post.slug }/)` left the literal text `/docs/{ post.slug }/`
  in the `href`. The brace resolved only when it filled the entire destination.
- A line that was exactly `:state`, with no name and no value, rendered as the
  text `:state` on the page.
- A static `@loop` over `| … |` table rows produced a header-only table
  followed by three paragraphs reading `| Ash | 3 | 12 |`.
- A `:every 5s -> n++` inside a reactive `@loop` registered one interval per
  row, and a row removed from the list kept ticking forever.

Every one of those is now either compiled correctly or refused with a coded
error that names the fix. That is the whole shape of the release.

## Braces resolve, and then they bind

The destination case turned out to be worth more than a bug fix. Once every
brace in a destination resolves, the obvious next question is what happens when
the value is reactive. It binds:

```wd
:state region = "eu"

:button "EU" -> region = "eu"
:button "US" -> region = "us"

[Open the docs for this region](/docs/{ region }/)
```

Click a button and the `href` changes. The compiler emits the destination as a
small template (the literal parts plus a reader) and the runtime rebuilds the
whole value on every render. The build-time paint is still the seed, so the
link works before the runtime loads and a crawler following it lands somewhere
real.

Two guards came with it. A value in URL position is percent-encoded, so a `)`
arriving from your data cannot close the link and hand the rest back to the
Markdown parser. And the runtime re-checks the scheme of the value it
assembled, refusing `javascript:`, `data:` and `vbscript:` with an empty
attribute rather than a half-applied one, because the compiler cannot see a
value that only exists at runtime.

Raw HTML attributes still do not bind. `<a href="{ url }">` is painted once,
and now says so in a warning that names the position that does bind.

## The URL is state

Here is the feature I have wanted longest. A filter nobody can link to is half
a feature:

```wd
:state q = "" from-url

:bind q placeholder="Search products"

:state products = [{"name": "Aurora Lamp"}, {"name": "Briza Fan"}]

@loop products into p where p.name contains q
- **{ p.name }**
@empty
Nothing matches that search.
@endloop
```

Type in the box and the address bar becomes `?q=aurora`. Reload and the search
comes back. Send the URL to somebody and they open on the same view.

`from-url` is a third word in the persistence vocabulary, next to `persist` and
`ephemeral`, and it is on `:state` only. Writes go through
`history.replaceState`, so filtering never fills the back button with one entry
per keystroke. A value back at its declared seed drops its parameter, so the
default page keeps a clean URL. Combine it with `persist` and the precedence is
URL, then storage, then seed: a link somebody sent you beats what this browser
remembers.

Putting it on a `:store` is a compile error rather than a guess, and the error
says why. A `:store` is shared by every page and every tab, while a query
parameter belongs to one page's address. Those cannot mean the same thing.

## What the API actually said

A failed `:fetch` used to set `name_error` to `Error: HTTP 422`, no matter what
the server had gone to the trouble of explaining. Now, when the response body
is JSON, `name_error` is the body's own `error` or `message` field, and the
whole parsed body lands in a new `name_error_body`:

```wd
:fetch signup from "/api/signup" method=POST

:if signup_error
**{ signup_error }**
:if signup_error_body
Photo: { signup_error_body.fields.photo }
:endif
:endif
```

Given a 422 whose body is
`{"error": "Pick a file first.", "fields": {"photo": "No file was attached."}}`,
the page renders *Pick a file first.* and the per-field message underneath it.
No JavaScript of your own.

## Smaller runtime, more features

None of the above would have fit. The runtime shipped as comment-stripped
readable source, and the audit fixes alone had taken it to 8036 bytes gzipped
out of a budget of 8192. Adding the five features below would have put the same
file at 8886, well over the line.

It now ships minified: a committed esbuild artifact, with an external sourcemap
served next to it so DevTools still shows the readable source with real names
and real comments. That bought about 2 KB back, and this release spent it:
attribute binding, `from-url`, bound `:select`/`:radio`/`:checkbox` outside a
form, server error bodies, and real multipart file upload. Total after all five:
**6584 bytes gzipped**, against the same 8192 byte budget.

The budget did not move. That is the point of having one.

## Things that now fail loudly

Some of the audit findings could not be fixed by making them work, because
there was nothing correct to do. Those became errors:

- **`WD191`**, a reactive `@loop` over Markdown table rows. A reactive row is
  cloned into a `<div>`, which is not a legal child of `<table>`. The hint names
  both ways out: a static source, or containers styled as table rows.
- **`WD315`**, `:every` or `:effect` inside a reactive loop body. Neither has a
  per-row meaning to salvage.
- **A bare directive keyword**, which now throws that directive's own error with
  that directive's own `Use:` hint. To show a directive name as text, escape it
  with a backslash: `\:fetch`.
- **`WD251`**, `:state b = a` where `a` is declared state. It used to seed the
  literal string `"a"` and track nothing. Derive it with `:computed` instead.

There are thirteen new codes in all, each with a cause, a fix and a compilable
example in `darkmown catalog --llms-full`.

## The rest

`:::` containers and `:button` now take `role`, `aria-*` and `title`, which was
the one place the no-attribute-syntax rule genuinely blocked a correct page.
A `:state` declared inside a closed `:if` branch is finally hydrated when the
branch opens. A static `@loop` fills a Markdown table. Renders settle, so a row
cloned mid-render gets its own `:if` state in the same pass. Rows keep their
place, so a re-render no longer steals focus from an input.

The [changelog](https://github.com/ZVN-DEV/darkmown/blob/master/CHANGELOG.md)
has all of it, and six new demo pages have it running:
[reactive links](/attr-binding/), [URL state](/url-state/),
[bound controls](/settings/), [server errors](/api-errors/),
[file upload](/upload/), and [closed-branch state](/branch-state/).

Upgrade with `npm install -D @zvndev/darkmown@latest`. Read the behavior
changes in the changelog first: interpolation now resolves in positions where
it used to stay literal, so a page that showed braces in an `href` will start
showing values.
