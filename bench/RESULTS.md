# Darkmown agent-eval results

Overall = mean of (compiled ? mean(persona scores) : capped 1.5) across all builds, 0–5.

| Round | Sheet change | Overall | Compile rate | Stylist | Purist | Prod-Owner |
|-------|--------------|---------|--------------|---------|--------|------------|
| 1 | AGENTS.md v1 (baseline) | **2.78** | 0.75 | 1.48 | 3.78 | 3.21 |

Models: Haiku 4.5, Sonnet 4.6, Opus 4.8 (Fable 5 gated/unavailable). Per-model overall R1: Haiku 2.29, Sonnet 3.00, Opus 3.04.

### Round 1 → v2 changes (targeting measured failures)
- **Styling (Stylist 1.48, 25 "no responsive/type-scale" + 12 "no .skin" notes):** mandate styling every page; added a full modern `.skin` starter (tokens, type scale, spacing, gradient hero, responsive grid, button/input).
- **`.skin` hit dead selectors (8 notes):** added a "what HTML each directive emits" table so selectors match real elements.
- **Duplicate-route fails (5 notes, optionality compile 0.33):** loud "rename = delete the `.md`" rule.
- **Invented `@section`/`{.class}` (5 notes):** explicit "these do not exist" list + how to add classes / style a CTA link.
- **Escape-hatch misuse:** canonical filter pattern (DOM-filter, don't overwrite source state, no setInterval).
- **Ordering fail:** "declare before you bind; `:form into x` declares x" rule.
- Grader fairness: Stylist now neutral-3 on non-styling tasks.
