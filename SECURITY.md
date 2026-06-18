# Security Policy

## Supported versions

Darkmown is pre-1.0. Only the latest published minor version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/ZVN-DEV/darkmown/security/advisories/new). Do not open public issues for security reports.

You can expect an initial response within 72 hours. If the report is accepted, a fix ships as the next patch release and the advisory is published after the fix is available.

## Trust boundary / threat model

Darkmown is a **trusted-author** static site generator. The threat model assumes you compile content you wrote yourself, the same way you trust your own source code — it does not assume the content is hostile. Within that boundary the guarantees below hold; three assumptions define the boundary itself:

1. **Compile only trusted, author-written content.** Do not compile `.md`/`.wd` files you did not write — user-generated content, third-party docs, or form input — without applying your own sanitization first.
2. **Raw HTML passes through by default.** `markdown-it` runs with `html: true`, so raw HTML in content is emitted verbatim. There is no built-in sanitizer, so a raw `<script>` or event-handler attribute in untrusted content would execute in the visitor's browser. A page can opt into strict mode with `html: false` frontmatter, which strips raw HTML.
3. **`:fetch` has no host allowlist, and reactive pages require `unsafe-eval`.** A `:fetch` (or `refresh=`) URL is read directly from the page source; the compiler rejects non-http(s) schemes (`file:`, `data:`, `javascript:`, protocol-relative `//host`) but does not restrict which hosts you call, so SSRF protection is the author's responsibility. Reactive pages also need `script-src 'unsafe-eval'` in your Content-Security-Policy, because the runtime compiles validated `:computed` / `@loop … where` / `.class when` expressions through `new Function`; a strict CSP without `unsafe-eval` breaks reactive pages (static pages are unaffected).

This is the same trust posture as every Markdown SSG: the framework is safe for the trusted-author use case it targets, and unsafe content is the author's responsibility to sanitize before it reaches the compiler.

## Security model

Things Darkmown deliberately guards at compile time and runtime:

- **No arbitrary JavaScript in content files.** Directive actions (`:button -> …`), `:computed` expressions, and `@loop … where` predicates compile through strict whitelisted grammars — only item paths, declared `:state`, numbers, and strings are allowed. Assignment, function calls, and unknown syntax are compile errors. Raw user content is never `eval`'d; what runs at runtime is the *validated* expression, compiled to the whitelisted grammar and executed via `new Function` (see `src/runtime.js`).
- **Prototype-walk protection.** Path lookups (`{ a.b.c }`, computed expressions) reject `constructor`, `prototype`, and `__proto__` segments in both the compiler and the runtime.
- **Include sandboxing.** `@include` and `@loop` data sources must resolve inside `site/pages` or `site/_`; traversal outside the site tree is a compile error, and include cycles are detected.
- **Output escaping.** Interpolated values are HTML-escaped; state scripts escape `<` to prevent script-tag breakout.
- **Static server path containment.** The dev/preview servers resolve requests strictly inside `dist`.

## The biggest footgun: raw HTML passthrough

Darkmown configures markdown-it with `html: true`, so **raw HTML in `.md`/`.wd` files is passed through verbatim** — by design, like every Markdown site generator. This is the single most important thing to understand about Darkmown's security model.

- Treat all content files as **trusted input**, the same way you trust your own source code.
- **Do not compile untrusted or user-submitted Markdown** (comments, form input, third-party docs) without sanitizing it first. Darkmown ships no built-in sanitizer; raw `<script>` and event-handler attributes in untrusted content would execute in the visitor's browser.
- If you must render untrusted content, sanitize it (for example with a library like DOMPurify) before it reaches the compiler.
