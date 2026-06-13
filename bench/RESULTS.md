# Darkmown agent-eval results

Overall = mean of (compiled ? mean(persona scores) : capped 1.5) across all builds, 0–5.

| Round | Sheet change | Overall | Compile rate | Stylist | Purist | Prod-Owner |
|-------|--------------|---------|--------------|---------|--------|------------|
| 1 | AGENTS.md v1 (baseline) | **2.78** | 0.75 | 1.48 | 3.78 | 3.21 |
| 2 | AGENTS.md v2 (styling + mechanics) | **3.54** | 0.75* | 2.96 | 4.41 | 3.84 |
| 3 | v3 + harness fix + .skin @media/font | **4.41** | 1.00 | 3.51 | 4.85 | 4.88 |
| 4 | v4 (doc nits) | **3.96**† | 0.83 | 3.44 | 4.64 | 4.21 |
| 5 | v5 (form gotchas) — **converged** | **4.51** | 1.00 | 3.69 | 4.86 | 4.97 |

Per-model R5: Haiku **4.47**, Sonnet **4.52**, Opus **4.53** — a tight cluster; even the cheapest model (Haiku, 2.29 in R1) now builds Darkmown as well as Opus. v5 form fixes recovered `optionality` (compile 0.33→1.0, Prod-Owner→5.0).

## Final read — converged after 5 rounds

**Trajectory:** overall **2.78 → 4.51** (+62%); compile **0.75 → 1.00**; Stylist **1.48 → 3.69**; Purist **3.78 → 4.86**; Prod-Owner **3.21 → 4.97**. Failure notes **132 → 49**, now **0 compile failures, 0 invented syntax**.

**The two residuals are not doc-fixable:**
1. **Design-taste ceiling (24/49 R5 notes).** Graders reserve 5 for distinctive art direction — custom typefaces, imagery, dark mode. A one-sheet reliably gets models to *clean, modern, responsive, polished* (Stylist ~3.7–4.4 on build tasks) but can't manufacture original design identity.
2. **The filter gap (5 notes, every round).** Darkmown has no state-driven list filtering, so the escape-hatch DOM-toggle is the only option — and it's fragile against the keyed-loop reconciler. **This is the single recurring non-doc signal across all 5 rounds → strongest case to build the `:filter`/derived-list primitive.**

**Bugs the loop caught & fixed (with tests):** `.skin` `@media` (responsive was impossible), `.skin` `font` shorthand, and a harness bug (compile stage resurrecting deleted files). All these would have hit real users.

Loop stopped at R5 by design — chasing N=1 sampling noise past convergence isn't worth the cost. The harness (`bench/`) is reusable to regression-test future doc or framework changes.

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
