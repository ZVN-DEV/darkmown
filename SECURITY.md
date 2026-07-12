# Security Policy

## Supported versions

Only the latest published minor version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/ZVN-DEV/darkmown/security/advisories/new). Do not open public issues for security reports.

You can expect an initial response within 72 hours. If the report is accepted, a fix ships as the next patch release and the advisory is published after the fix is available.

## Trust boundary / threat model

Darkmown is a **trusted-author** static site generator. The threat model assumes you compile content you wrote yourself, the same way you trust your own source code — it does not assume the content is hostile. Within that boundary the guarantees below hold; three assumptions define the boundary itself:

1. **Compile only trusted, author-written content.** Do not compile `.md`/`.wd` files you did not write — user-generated content, third-party docs, or form input — without applying your own sanitization first.
2. **Raw HTML is escaped by default; `html: true` re-opens the boundary per page.** `markdown-it` runs with `html: false`, so raw HTML in content renders as inert escaped text — a `<script>` or `onerror=` attribute in a contributed markdown file cannot execute. A page opts back into verbatim raw HTML with `html: true` frontmatter; on such a page there is no built-in sanitizer and untrusted content would execute in the visitor's browser, so reserve the opt-in for pages whose HTML you wrote yourself.
3. **`:fetch` and `:form action=` have no host allowlist.** A `:fetch`, `refresh=`, or `:form action=` URL is read directly from the page source; the compiler rejects non-http(s) schemes (`file:`, `data:`, `javascript:`, protocol-relative `//host`) but does not restrict which hosts you call, so SSRF/exfiltration protection is the author's responsibility. *(Since 2.1, reactive pages no longer need `'unsafe-eval'` — the runtime interprets a validated expression AST instead of building a `new Function`, so reactive and static pages share the same strict, eval-free CSP.)*

The default is deliberately stricter than most Markdown SSGs: with content collections making multi-author markdown a first-class input, escaped-by-default is the only default that is safe when one of those authors isn't you. Unsafe content on an `html: true` page remains the author's responsibility to sanitize before it reaches the compiler.

## Security model

Things Darkmown deliberately guards at compile time and runtime:

- **No arbitrary JavaScript in content files.** Directive actions (`:button -> …`), `:computed` expressions, and `@loop … where` predicates compile through strict whitelisted grammars — only item paths, declared `:state`, numbers, and strings are allowed. Assignment, function calls, and unknown syntax are compile errors. Raw user content is never `eval`'d — and since 2.1, **nothing is `eval`'d at all**: the *validated* expression is compiled to a compact serialized AST and **interpreted by a closed evaluator** in `src/runtime.js` (no `new Function`). The interpreter only ever reads a fixed op vocabulary; an unknown op is a hard error. This is what lets reactive pages run under a strict CSP with no `'unsafe-eval'`.
- **Prototype-walk protection.** Path lookups (`{ a.b.c }`, computed expressions) reject `constructor`, `prototype`, and `__proto__` segments in both the compiler and the runtime.
- **Include sandboxing.** `@include` and `@loop` data sources must resolve inside `site/pages` or `site/_`; traversal outside the site tree is a compile error, and include cycles are detected.
- **Private page assets stay private.** Page-colocated assets under `site/pages` are copied only when their relative path has no hidden segment (`.`, `-`, or `_`) and is not a symlink. This keeps `.env`, `_private/*`, `-draft/*`, and symlink-to-outside files out of `dist`.
- **Output escaping.** Interpolated values are HTML-escaped; state scripts escape `<` to prevent script-tag breakout.
- **Static server path containment.** The dev/preview servers resolve requests strictly inside `dist`.

## The #1 footgun: the raw HTML opt-in (`html: true`)

This is the single most important thing to understand about Darkmown's security model. **Read this before putting `html: true` on a page.**

Since 2.0.0, Darkmown configures markdown-it with `html: false` by default: **raw HTML in `.md`/`.wd` files is escaped**, so a `<script>` or an `onerror=` attribute in content renders as visible inert text instead of executing. This makes multi-author content — blog collections, contributed docs, anything you merge from a PR — stored-XSS-safe without any per-page setting.

### The `html: true` per-page opt-in

A page whose author writes their own HTML opts back into verbatim passthrough:

```wd
---
title: Landing page
html: true
---
```

On an `html: true` page the pre-2.0.0 rules apply in full:

- **Treat that page's content as trusted input**, the same way you trust your own source code.
- **Never compile untrusted or user-submitted Markdown** (comments, form input, third-party docs, scraped content) into an `html: true` page without sanitizing it first. Darkmown ships **no built-in sanitizer**.
- If you must render untrusted content, sanitize it (for example with a library like DOMPurify) before it reaches the compiler — or simply leave the page on the default strict renderer.

> **Note:** `html:` is a *per-page* (and per-include — every `.wd`/`.md` file carries its own frontmatter) key — there is no global/site-wide toggle today (no config loader exists yet). The safe default means that's the right shape: opt individual hand-written pages in, never a whole site of contributed content.

## Deploying with a Content-Security-Policy

Builds emit security response headers so a deployed site is hardened by default rather than relying on hand-written config. The build writes a `dist/_headers` file (Cloudflare Pages format) and the Vercel and local `serve` paths apply the equivalent. Every page gets:

- **`Content-Security-Policy`** — **no `'unsafe-inline'` and no `'unsafe-eval'` on `script-src`, for any page.** The inline state seed is a `<script type="application/json">` data block, which is non-executable and therefore not gated by `script-src` at all; the one inline script CSP does gate — the fixed `<script type="speculationrules">` block a `transitions: true` page emits — is authorized by a build-time `'sha256-…'` hash source (plus the `'inline-speculation-rules'` keyword for browsers that check that instead). Since 2.1, **static and reactive pages share the same strict, eval-free policy**: the reactive runtime interprets a validated `:computed` / `@loop … where` / `.class when` expression AST instead of building a `new Function`, so it needs no `'unsafe-eval'`. The only `script-src` a reactive page adds over a static one is `'self'` for the same-origin `/__wd/runtime.js` — already granted.
- **`X-Content-Type-Options: nosniff`** — stops MIME-type sniffing.
- **`Referrer-Policy`** — limits referrer leakage.
- **`frame-ancestors`** — clickjacking protection (controls who may frame the page).

A consequence of dropping `'unsafe-inline'`: a raw inline `<script>` you write into an `html: true` page is **blocked by the shipped CSP**. Put page behavior in a colocated `.js` file instead — it is served same-origin and allowed by `script-src 'self'` — or widen `script-src` in your deploy config as a deliberate decision. (`style-src` keeps `'unsafe-inline'` for the view-transition inline `<style>`.)

### Tightening the policy

The shipped CSP is a sensible default, not a finished policy for every site. Tighten or widen it for your deployment:

- **`:fetch` / `:form action=` to another host needs a wider `connect-src`.** The default CSP permits same-origin connections; a call to a third-party API is otherwise blocked. Add each external host to `connect-src` explicitly — it is **not** auto-derived from your page sources.
- **`img-src` / `media-src` default to any `https:` host** — remote images and media in markdown are legitimate on most sites, so the default keeps them working. If your site only serves its own assets, tighten both in your deploy config (`vercel.json`, `dist/_headers`, or your server): `img-src 'self' data:` (keep `data:` — the default favicon is a `data:` SVG) and `media-src 'self'`. If you hotlink from known hosts, list them instead: `img-src 'self' data: https://images.example.com`.
- **Remote fonts or extra embed hosts** need their hosts added to `font-src` / `frame-src` (the default `frame-src` pre-authorizes exactly the YouTube no-cookie and Vimeo player origins `:embed` rewrites to).
- **Reactive pages need no `'unsafe-eval'`** (since 2.1) — they run under the same strict, eval-free `script-src` as static pages, because the runtime interprets a validated expression AST rather than calling `new Function`. If you deployed an older build's CSP with `'unsafe-eval'`, you can drop it.
- The CSP is **defense-in-depth** — it limits the blast radius of a mistake but does **not** replace the trust-boundary rules above. It is not a substitute for sanitizing untrusted content, and it does not add a host allowlist to `:fetch`/`:form` (SSRF/exfiltration protection remains the author's responsibility).
