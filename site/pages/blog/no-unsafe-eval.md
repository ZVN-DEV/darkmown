---
title: Reactive pages with no unsafe-eval
description: Since 2.1.0 the runtime interprets a validated expression AST instead of building a function, so reactive and static pages ship the same strict Content-Security-Policy.
date: 2026-07-11
excerpt: A reactive page used to force 'unsafe-eval' into your CSP. It no longer does, because the runtime stopped compiling expressions to JavaScript and started interpreting them.
schema: BlogPosting
tags: [security, runtime]
---

# Reactive pages with no unsafe-eval

Every reactive framework has to answer one question honestly: how does the
browser evaluate `p.price < 50`?

Through Darkmown 2.0.x the answer was `new Function`. A `:computed`, a
`@loop … where`, a `.class when`, and a `:if` comparison were all validated at
compile time against a closed whitelist, then emitted as a small JavaScript
fragment that the runtime turned back into a callable. That is safe from the
injection angle, because nothing an author writes reaches the fragment unless it
matched the grammar first. It is not safe from the *deployment* angle, because
`new Function` needs `script-src 'unsafe-eval'`, and a security-minded adopter
who reads your CSP does not care how carefully you validated the input. They
care that the policy has a hole in it.

## What changed

The compiler still validates the expression exactly as before. What it emits is
different: instead of a JavaScript fragment, it serializes the already-validated
expression into a compact AST and puts it in the `data-wd-*` attribute. The
runtime walks that AST with a closed evaluator. Readers, unary operators, and a
fixed arithmetic, comparison, and logical set. An unknown op tag is a hard
error, never a fallthrough.

No `new Function`. No `eval`. Nothing on the page turns text into code.

## What it buys

The shipped policy is now byte-identical for static and reactive pages, across
`dist/_headers`, `vercel.json`, and the local `serve` layer:

```
script-src 'self'
```

No `'unsafe-inline'`, no `'unsafe-eval'`, on any page the framework emits. The
one inline script Darkmown ships (the `transitions: true` speculation-rules
block) is authorized by a build-time `'sha256-…'` hash, and the inline state
seed is a JSON data block that CSP does not gate at all.

## What it cost

136 bytes. The runtime went from 7,518 to 7,654 bytes gzipped, still under the
8 KB budget that CI enforces on every commit.

Semantics did not move. The interpreter applies the same JavaScript operators
the generated fragments used to, and a parity battery compares the two
evaluators across a wide matrix of expressions, states, and loop items, asserting
identical results. The fuzz suite still proves that hostile text survives only as
inert literal data.

## The rule underneath

Compile-time validation is the security layer, and it always was. Dropping
`eval` did not make the language safer against a malicious author, because the
whitelist already did that. It made the language **deployable** somewhere a
strict CSP is not negotiable, which is most places worth deploying.
