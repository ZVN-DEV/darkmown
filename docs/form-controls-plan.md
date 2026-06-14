# Core form controls plan — full native input surface

Status: planning (2026-06-14). Core Darkmown. Subsumes primitive **P5
(`:select`)** from `docs/shopify-storefront-plan.md` — form controls are a
general framework capability, not a storefront one.

## Goal

Every native browser form control is expressible in Markdown, with live
two-way binding to state, so Darkmown is a fully functional framework rather
than one with a single submit-capture `:input`.

## Where we are

- `:input name [type=X] [attrs] [flags]` (`src/compiler.js:484-509`) emits one
  `<input>`. `type=` is already passed through, but the attribute whitelist
  (`:503`) is generic (`placeholder|value|min|max|step|pattern|autocomplete`)
  and the flag whitelist (`:492`) is `required|autofocus|disabled|readonly`.
- Inputs are **submit-capture only**: values reach state through
  `data-wd-form` FormData when the form submits (`src/runtime.js`). There is no
  live binding, no `<select>`, no `<textarea>`, no checkbox/radio grouping.

## Design thesis (respects "one syntax, never add alternates")

The invariant in `CLAUDE.md` — *"One interpolation syntax. Never add alternates."*
— governs this. So:

1. **`:input` stays the single directive for every `<input>` element.** All
   native types are `:input … type=X`. We do **not** add `:email`, `:number`,
   `:color`, `:range`, `:checkbox`, `:date`, etc. Variety comes from `type=`,
   not from new directives.
2. **New directives only for elements that are not `<input>`:** `:select`
   (+ `:option`) and `:textarea`. These are genuinely different HTML elements;
   `type=` cannot produce them.
3. **Structural / display-only elements stay raw HTML.** `.wd` already allows
   inline HTML (see `<main>`, `<button class>` in `site/pages/*.wd`). `<label>`,
   `<fieldset>`, `<legend>`, `<output>`, `<progress>`, `<meter>`, `<datalist>`
   need no directive unless they bind state. Directives are reserved for
   controls that **capture or reflect state**; everything else is just HTML.

This keeps the new surface to: an expanded `:input`, plus `:select`/`:option`
and `:textarea`, plus one binding keyword shared by all of them.

## The core new capability: two-way binding (`bind`)

The thing that makes the framework "fully functional" is live binding, not more
input types. One keyword, on every control:

```
:state email = ""
:input email type=email bind=email placeholder="you@example.com"

You typed: { email }
```

- `bind=name` (or `bind=cart.note`, dotted path) links the control's value to
  declared state, **both ways**: user input writes state; state writes update
  the control.
- Compiles to a `data-wd-input-bind="<key>"` attribute (and `data-wd-bind-prop`
  to say whether it syncs `.value`, `.checked`, or multi-`<select>` values).
- Without `bind`, behavior is unchanged — the control is still captured at form
  submit via `data-wd-form`. `bind` is additive and opt-in, so existing pages
  and the no-JS native-POST path are untouched.

### Per-type binding semantics

| Control | Reads/writes | Notes |
|---|---|---|
| text/email/url/tel/search/password/number/date family/color | `.value` | number/date may coerce on read |
| `range` | `.value` | same as number |
| `checkbox` (single) | `.checked` (boolean) | |
| `checkbox` (group, same `bind`) | array of checked `value`s | |
| `radio` (group, same `bind`) | selected `value` | |
| `file` | read-only `FileList` ref | bind reflects selection; can't set |
| `select` (single) | selected `value` | |
| `select multiple` | array of selected values | |
| `textarea` | `.value` | |

## Complete `<input>` type + attribute matrix

`:input` accepts all native types. Validation = a per-type attribute whitelist
(compile-time, in the spirit of the existing whitelists at `compiler.js:492,503`).

- **Types:** `text search tel url email password number range date month week
  time datetime-local color checkbox radio file hidden button submit reset
  image`.
- **Universal attrs:** `name value placeholder required disabled readonly
  autofocus autocomplete form bind`.
- **Type-gated attrs (rejected on wrong type, with a corrective error):**
  - text-ish (`text search tel url email password`): `minlength maxlength
    pattern size spellcheck list`
  - numeric/temporal (`number range date month week time datetime-local`):
    `min max step`
  - `email`, `file`: `multiple`
  - `file`: `accept capture`
  - `checkbox`, `radio`: `checked` (flag)
  - `image`: `src alt width height`

Errors keep the current style: file path + `Use: …` suggestion.

## New directives

### `:select`

```
:select size bind=size
:option "Small" value=S
:option "Medium" value=M selected
:option "Large" value=L
:endselect
```

- Attrs: `name`, `bind`, flags `multiple required disabled`, `size=N`.
- Options two ways: explicit `:option` children **or** sourced from state via
  the existing loop concept (`@loop sizes into s` wrapping `:option`), so a
  dynamic list reuses `@loop` rather than inventing option-list syntax.
- `:option` attrs: `value`, `label`, flags `selected disabled`.

### `:textarea`

```
:textarea message bind=draft rows=5 placeholder="Your message"
```

- Attrs: `name`, `bind`, `rows`, `cols`, `placeholder`, `minlength`,
  `maxlength`, `wrap`, flags `required readonly disabled autofocus`.

## Runtime budget (the constraint that bites)

Live binding adds runtime: input/change listeners that write state, and a
state→DOM sync path for the bound controls. The runtime is **CI-capped under
5 KB gzipped** (`tests/size.test.js`). Plan:

- One delegated `input`/`change` listener at document level, not per-control —
  keeps bytes flat regardless of control count.
- Reuse the existing text-bind subscription machinery for state→control sync;
  binding is "text bind, but the target is `.value`/`.checked`."
- Multi-select / checkbox-group array handling is the only genuinely new logic;
  keep it in one small helper.
- Measure against the budget in the same PR; if it threatens 5 KB, ship
  single-value binding first and defer group/multi semantics.

## Validation & safety

- Per-type attribute whitelists, compile-time, no eval (matches existing
  directive grammar).
- `bind` targets must resolve to declared `:state` (same rule as actions /
  `:computed` references), else a compile error.
- Static pages with no `bind` and no other state stay `runtime: false` — a
  bare `:input`/`:select`/`:textarea` inside a native-POST `:form action` ships
  zero JS, preserving the progressive-enhancement story.

## Phasing

1. **Expand `:input`** — full type list + type-gated attribute whitelists.
   No runtime change; pure compiler. Ships alone.
2. **`bind` (two-way)** — runtime binding for single-value controls
   (text/number/date/color/checkbox-single/radio). The headline capability.
3. **`:select`/`:option` + `:textarea`** — new elements, with `bind`.
4. **Group/array binding** — checkbox groups, `select multiple`. Last because
   it carries the most runtime weight.

## Tests

- Each input type emits correct `type=` + only its allowed attrs; wrong-type
  attr errors.
- `bind` round-trips: typing updates `{ state }`; `:button -> state = "x"`
  updates the control.
- `:select`/`:option` (static and `@loop`-sourced); `:textarea` bind.
- Checkbox/radio group → array / selected value.
- A `bind`-free control inside `:form action` stays `runtime: false`.
- Runtime size stays under 5 KB gzipped (`tests/size.test.js`).

## Open decisions

- **Binding keyword:** `bind=name` (proposed) vs. reusing `{ }` syntax somehow.
  Recommend a distinct `bind` keyword — interpolation is read-only output; a
  control is read/write, so conflating them is misleading.
- **Group binding in v1 or deferred** — depends on the 5 KB measurement.
- **Display binding** (`<output>`/`<progress>`/`<meter>` reflecting state):
  out of scope as directives; achievable today with `{ state }` in raw HTML
  attributes if/when attribute interpolation is added (separate question).
