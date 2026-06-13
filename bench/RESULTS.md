# Darkmown agent-eval results

Overall = mean of (compiled ? mean(persona scores) : capped 1.5) across all builds, 0–5.

| Round | Sheet change | Overall | Compile rate | Stylist | Purist | Prod-Owner |
|-------|--------------|---------|--------------|---------|--------|------------|
| 1 | AGENTS.md v1 (baseline) | **2.78** | 0.75 | 1.48 | 3.78 | 3.21 |
| 2 | AGENTS.md v2 (styling + mechanics) | **3.54** | 0.75* | 2.96 | 4.41 | 3.84 |
| 3 | v3 + harness fix + .skin @media/font | **4.41** | 1.00 | 3.51 | 4.85 | 4.88 |
| 4 | v4 (doc nits) | **3.96**† | 0.83 | 3.44 | 4.64 | 4.21 |

†R4 is **sampling noise, not a regression** (N=1 per model×task). The whole dip is two `optionality` compile failures from real model errors: Sonnet put `:if` *inside* the `:form…:endform` block; Opus wrapped the form in a `::: section`, scoping the state away from its `:if`. Styling/scripting held or improved (styling Stylist 4.3 vs 4.17). Per-model R4: Haiku **4.48** (clean), Sonnet 3.77, Opus 3.63.

### Round 4 → v5 changes (the two real form gotchas + two more)
All doc, no compiler change needed (`:input` already supports `type=`):
- **`:if`/`{ }` reading form state must come AFTER `:endform`** — the form declares its `into` state only at close.
- **`:form into x` inside a `::: section` scopes `x` to that section** — keep the `:if` in the same scope or don't nest the form.
- **Markdown isn't parsed inside raw HTML blocks** (`**Lumen**` in a `<div>` showed literal asterisks) — use `<strong>`.
- **`:input` supports `type=`** (e.g. `type=email`) — models defaulted everything to text.

Models: Haiku 4.5, Sonnet 4.6, Opus 4.8 (Fable 5 gated/unavailable). Per-model overall R1: Haiku 2.29, Sonnet 3.00, Opus 3.04. R2: Haiku 3.63, Sonnet 3.66, Opus 3.33.

\*R2 compile 0.75 was a **harness bug**, not a model failure: the `optionality` task scored compile 0.0 because the compile stage *recreated* the `index.md` that models had correctly deleted (→ duplicate-route error), then graders blamed the models. Real R2 compile across the other 3 tasks was 1.0. Fixed for R3 (pre-seed editable files; compile stage never recreates them).

### Round 2 → v3 changes
- **Fixed the optionality harness bug** (above) — should lift optionality compile 0.0 → ~1.0 and Prod-Owner 1.17 → high.
- **Fixed two real `.skin` compiler gaps the benchmark surfaced** (helps real users too): `@media` blocks now wrap their nested rules (responsive was impossible before); `font 16px/1.6 …` shorthand passes through instead of becoming `font-family: 16px/1.6`. Tests added.
- Sheet v3: `.skin` starter now uses working responsive `@media` + `:hover`/`:focus-visible`; documented the **CTA-layout gotcha** (adjacent links wrap into one `<p>`, so flex needs an explicit container) — the `.hero-actions`/`.footer-nav` failures from R2.

### Round 3 → v4 changes (cleaning the cheap doc nits)
R3 hit strong convergence: compile **1.0**, zero compile failures, near-zero invented syntax. Failure notes 132→49. Residual = design taste (~13, a ceiling), filter fragility (6, a real framework gap — not a doc issue), and a few doc nits. v4 targets the nits only:
- **Wrap body in `<main>`** so `main {}` rules apply (Sonnet's optionality page rendered full-bleed because it omitted `<main>`).
- **`#` once, `##` for sections** (avoid double-`<h1>`; style `h2` section titles).
- **Only style classes you attach** (models styled `.thanks`/`.thankyou` but never applied them).
- **Richer cards** (shadow, hover lift, price weight; avoid emoji icons).
- Filter caveat noting the DOM-toggle fragility.

### Round 1 → v2 changes (targeting measured failures)
- **Styling (Stylist 1.48, 25 "no responsive/type-scale" + 12 "no .skin" notes):** mandate styling every page; added a full modern `.skin` starter (tokens, type scale, spacing, gradient hero, responsive grid, button/input).
- **`.skin` hit dead selectors (8 notes):** added a "what HTML each directive emits" table so selectors match real elements.
- **Duplicate-route fails (5 notes, optionality compile 0.33):** loud "rename = delete the `.md`" rule.
- **Invented `@section`/`{.class}` (5 notes):** explicit "these do not exist" list + how to add classes / style a CTA link.
- **Escape-hatch misuse:** canonical filter pattern (DOM-filter, don't overwrite source state, no setInterval).
- **Ordering fail:** "declare before you bind; `:form into x` declares x" rule.
- Grader fairness: Stylist now neutral-3 on non-styling tasks.
