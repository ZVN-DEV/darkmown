---
name: Feature request
about: Suggest a directive, capability, or improvement
title: "[feat] "
labels: enhancement
---

## The problem

<!-- What are you trying to do that Darkmown makes hard or impossible today? -->

## Proposed solution

<!-- What should it look like? If it's a directive, sketch the `.wd` syntax. Remember the invariants:
     one loop (`@loop … into … @endloop`), one interpolation (`{ name }`), `.md` stays plain. -->

```wd

```

## Alternatives considered

<!-- Other approaches, and why the proposal is better. -->

## Scope check

- [ ] This keeps static pages zero-JS (or only adds cost to pages that opt into reactivity)
- [ ] This doesn't require a new runtime dependency
- [ ] This fits the "markdown-native, no escape hatch into a JS framework" philosophy
