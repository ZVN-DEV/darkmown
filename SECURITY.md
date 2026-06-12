# Security Policy

## Supported versions

Darkmown is pre-1.0. Only the latest published minor version receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately via [GitHub Security Advisories](https://github.com/ZVN-DEV/darkmown/security/advisories/new). Do not open public issues for security reports.

You can expect an initial response within 72 hours. If the report is accepted, a fix ships as the next patch release and the advisory is published after the fix is available.

## Security model

Things Darkmown deliberately guards at compile time and runtime:

- **No arbitrary JavaScript in content files.** Directive actions (`:button -> …`) and `:computed` expressions compile through strict whitelisted grammars. Assignment, function calls, and unknown syntax are compile errors.
- **Prototype-walk protection.** Path lookups (`{ a.b.c }`, computed expressions) reject `constructor`, `prototype`, and `__proto__` segments in both the compiler and the runtime.
- **Include sandboxing.** `@include` and `@loop` data sources must resolve inside `site/pages` or `site/_`; traversal outside the site tree is a compile error, and include cycles are detected.
- **Output escaping.** Interpolated values are HTML-escaped; state scripts escape `<` to prevent script-tag breakout.
- **Static server path containment.** The dev/preview servers resolve requests strictly inside `dist`.

Raw HTML in `.md`/`.wd` files is passed through by design (like every markdown site generator): treat content files as trusted input. Do not compile untrusted third-party content without sanitizing it first.
