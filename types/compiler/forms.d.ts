/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleForm(line: string, bodyLines: string[], ctx: Ctx, index: number): string;
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInput(line: string, ctx: Ctx, index: number): string;
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleBind(line: string, ctx: Ctx, index: number): string;
/**
 * `:slider name [= value] [min=N] [max=N] [step=N] [aria-label="…"] [persist]` — a
 * range input two-way bound to a NUMBER :state. With `= value` it declares the state
 * inline (seeding it numeric) and may `persist`; without `=` it binds to an already-
 * declared :state. Pure compile-time: it reuses the runtime's input binding (range
 * values coerce to Number), so it ships NO behavior module.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSlider(line: string, ctx: Ctx, index: number): string;
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSubmit(line: string, ctx: Ctx, index: number): string;
/**
 * `:textarea name [placeholder="…"] [rows=N] [required]` → a `<textarea>`. Like
 * `:input`, it derives a non-visual aria-label from the placeholder (else the
 * humanized name) when the author supplies none. Captured by the runtime's
 * FormData exactly like `:input` — no runtime change needed.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleTextarea(line: string, ctx: Ctx, index: number): string;
/**
 * `:select name [required]` followed by `- Label` list lines → a `<select>` with
 * one `<option>` per label (value === label). Derives an aria-label from the
 * humanized name when none is given. Captured by FormData like the other fields.
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSelect(line: string, optionLines: string[], ctx: Ctx, index: number): string;
/**
 * `:checkbox name [required]` / `:radio name [required]` followed by `- Label`
 * lines → a labelled group of `<input type=checkbox|radio>`, each sharing `name`
 * with value === label and wrapped in its own `<label>`. The group is a
 * `role="group"` / `role="radiogroup"` container with an aria-label (explicit or
 * humanized from the name). Checkbox groups are marked `data-wd-multi="name"` so
 * the runtime captures every checked value as an array (`FormData.getAll`); radio
 * groups capture a single value like `:input`. Flags: `required` (radio → the
 * group; not emitted on checkboxes, where "at least one" has no native HTML form),
 * `disabled` (whole group), `autofocus` (first control).
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {"checkbox" | "radio"} kind
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleChoiceGroup(line: string, optionLines: string[], ctx: Ctx, kind: "checkbox" | "radio", index: number): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 */
export const FORM_EXAMPLE: ":form into contact";
export const INPUT_EXAMPLE: ":input email type=email required";
export const TEXTAREA_EXAMPLE: ":textarea message placeholder=\"Your message\" rows=4";
export const SELECT_EXAMPLE: ":select topic";
export const CHECKBOX_EXAMPLE: ":checkbox toppings";
export const RADIO_EXAMPLE: ":radio size";
export const SUBMIT_EXAMPLE: ":submit \"Send\"";
export const BIND_EXAMPLE: ":bind query placeholder=\"Search\"";
export const SLIDER_EXAMPLE: ":slider volume = 50 min=0 max=100 step=1";
export type Ctx = import("./context.js").Ctx;
