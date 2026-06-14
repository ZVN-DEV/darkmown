# Core form controls plan — full native control surface

Status: planning (revised 2026-06-14 against **v0.7.0**). Core Darkmown.
Generalizes the storefront's P5 idea — form controls are a general framework
capability, not a storefront one.

> **Revised:** v0.6.0 already shipped **`:bind <state>`** — a live two-way
> `<input>`. This plan is no longer "add two-way binding"; it is "complete the
> control surface around the binding that already exists."

## Goal

Every native browser form control is expressible in Markdown with live two-way
binding, so Darkmown is a fully functional framework — not one that binds only
single-line text `<input>`s.

## Where we actually are (v0.7.0)

Three input-ish paths exist today:

1. **`:bind <state>`** (`src/compiler.js`, `handleBind`) — live two-way
   `<input>`. Writes state on every keystroke; reflects state back when the
   field is **not** focused (`document.activeElement !== input` in
   `src/runtime.js`). Delegated single `input` listener. **Limits:** `<input>`
   only; `type=` passthrough; attrs only `placeholder`, `autocomplete`; flags
   only `required`, `autofocus`; **bare state identifier only** (no dotted
   paths); no `<select>`/`<textarea>`; no checkbox/radio groups.
2. **`:input <name> [type=X] [attrs] [flags]`** (`handleInput`) — a
   **submit-capture** `<input>` inside `:form`; reaches state via `data-wd-form`
   FormData on submit, not live. Wider attr whitelist than `:bind`
   (`placeholder value min max step pattern autocomplete`; flags
   `required autofocus disabled readonly`).
3. **`:submit "Label"`** — the form's submit button.

### The duality problem (decide first)

We now have **two `<input>` directives** — `:input` (submit-capture) and
`:bind` (live two-way). That is exactly the "alternate syntax" the `CLAUDE.md`
invariant warns against. Before expanding either, reconcile them. Options:

- **A — Merge:** one `:input` directive; `bind=<state>` makes it live, its
  absence keeps submit-capture. Deprecate the standalone `:bind`. Cleanest
  long-term; one mental model. Cost: migrates the `:bind` surface shipped in
  0.6.0.
- **B — Keep both, draw a bright line:** `:bind` = live single control,
  `:input` = form-field. Document the split. Lower churn; keeps two directives.

**Recommendation: A**, phased so `:bind` keeps working as an alias during a
deprecation window. Picking this shapes every section below, so it is the gating
decision.

## Design thesis (respects "never add alternates")

1. **One directive per HTML element, variety via `type=`.** All `<input>`
   types are `type=X` on the unified input directive — never `:email`,
   `:number`, `:checkbox`, `:date`, etc.
2. **New directives only for non-`<input>` elements:** `:select` (+ `:option`)
   and `:textarea`.
3. **Structural/display elements stay raw HTML.** `.wd` already allows inline
   HTML. `<label>`, `<fieldset>`, `<output>`, `<progress>`, `<meter>`,
   `<datalist>` need no directive unless they bind state.

## Work items (all build on the existing `:bind` runtime)

### F1 — Full `<input>` type + attribute matrix

Extend the input directive (per decision A/B) to all native types with
**per-type attribute whitelists** — compile-time, no eval, matching the existing
whitelist style.

- **Types:** `text search tel url email password number range date month week
  time datetime-local color checkbox radio file hidden`.
- **Universal:** `name value placeholder required disabled readonly autofocus
  autocomplete`.
- **Type-gated (error on wrong type):** text-ish → `minlength maxlength pattern
  size spellcheck list`; numeric/temporal → `min max step`; `email`/`file` →
  `multiple`; `file` → `accept capture`; `checkbox`/`radio` → `checked`.

Pure compiler work; no runtime change. The `:bind` runtime already syncs
`.value`, so text/number/date/color/range bind for free once attrs are allowed.

### F2 — `.checked` and grouped binding (runtime delta)

Checkbox/radio need the runtime to sync `.checked`, not `.value`, and groups
need array / selected-value semantics. This is the **only meaningful runtime
addition** and it touches the 5 KB budget.

- single `checkbox` ↔ boolean; `checkbox` group (same bind) ↔ array of `value`s;
  `radio` group ↔ selected `value`.
- Runtime: branch the existing `data-wd-bind-input` sync on input type; one
  small helper for group arrays. The delegated `input` listener already exists.
- **Budget:** current runtime is well under 5120 B gzipped (`tests/size.test.js`,
  ~2 KB per the changelog). Measure in the same PR; if group logic threatens the
  cap, ship single checkbox/radio first, defer groups.

### F3 — `:select` / `:option` and `:textarea`

New elements, bindable through the same mechanism.

```
:state size = "M"
:select size
:option "Small" value=S
:option "Medium" value=M
:endselect

:state draft = ""
:textarea draft rows=5 placeholder="Your message"
```

- `:select` syncs selected `value` (and array for `multiple`); options inline
  via `:option` **or** sourced from state by wrapping with the existing
  `@loop` (reuse, don't invent option-list syntax — and `@loop … where` already
  filters them).
- `:textarea` syncs `.value`; attrs `rows cols wrap minlength maxlength`.
- Runtime: extend the `data-wd-bind-input` query/sync to also match
  `select`/`textarea` (they already fire `input`/`change`).

### F4 — Dotted-path bind targets

`:bind cart.note` / `:select buyer.country`. The binding key is currently a bare
identifier; allow dotted paths, routed through the same safe `getPath`
(`constructor`/`prototype`/`__proto__` rejected). Compiler + a small runtime
path-set helper.

## Phasing

1. **Decide the duality (A vs B)** — gates naming for everything else.
2. **F1** — type + attribute matrix. Pure compiler, no runtime delta. Ships
   alone, immediately widens what binds.
3. **F3** — `:select`/`:textarea` (single-value). Mostly compiler + a query
   widening in the runtime.
4. **F2** — checkbox/radio `.checked` + groups. The runtime-heavy item; measure
   against 5 KB.
5. **F4** — dotted-path targets.

## Tests (extend, don't duplicate)

- Each input type emits correct `type=` + only its allowed attrs; wrong-type
  attr errors with a corrective message.
- `:bind`/unified input round-trip (already covered for text — extend to
  number/date/color/checkbox/radio/select/textarea).
- `:select` static + `@loop`-sourced + `@loop … where`-filtered; `multiple` →
  array. `:textarea` bind.
- A bind-free control inside `:form action` stays `runtime: false`.
- `tests/size.test.js` still passes (< 5120 B gzipped) after F2.

## Open decisions

- **Duality A vs B** (above) — the gating call.
- **Group binding in v1 vs deferred** — depends on the F2 byte measurement.
- **Display binding** (`<output>`/`<progress>`/`<meter>` reflecting state) —
  out of scope as directives; revisit if attribute interpolation lands.
