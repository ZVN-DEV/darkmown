// ---------------------------------------------------------------------------
// Forms + inputs: `:form` (client state / native post / fetch round-trip) and
// the field directives that feed it — `:input`, `:textarea`, `:select`,
// `:checkbox`/`:radio` groups, `:submit` — plus the two-way bound controls
// `:bind` and `:slider`.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, lineOf, nestedCtx, recordSymbol, wdError } from "./context.js";
import { validateFetchUrl } from "./fetch.js";
import {
  escapeHtml,
  humanizeName,
  parseStateValue,
  resolveStateKey,
  safeScriptJson,
  stripQuotes
} from "./interpolation.js";
import { declareErrorState, declareState } from "./state.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Concrete, compilable one-liners for the form-family hint tails + the catalog.
// (Field openers like :select/:checkbox expect following `- Label` lines; the
// example is the opener, which the catalog/grammar pair with option lines.)
export const FORM_EXAMPLE = ":form into contact";
export const INPUT_EXAMPLE = ":input email type=email required";
export const TEXTAREA_EXAMPLE = ':textarea message placeholder="Your message" rows=4';
export const SELECT_EXAMPLE = ":select topic";
export const CHECKBOX_EXAMPLE = ":checkbox toppings";
export const RADIO_EXAMPLE = ":radio size";
export const SUBMIT_EXAMPLE = ':submit "Send"';
export const BIND_EXAMPLE = ':bind query placeholder="Search"';
export const SLIDER_EXAMPLE = ":slider volume = 50 min=0 max=100 step=1";
const INPUT_USE = `Use: :input name [type=…] [placeholder="…"] [required] — e.g. ${INPUT_EXAMPLE}`;

// ---------------------------------------------------------------------------
// A FIELD DIRECTIVE MEANS TWO DIFFERENT THINGS, AND ONLY THE FORM KNOWS WHICH.
//
// Inside a `:form`, `:select topic` names a FORM FIELD: the label goes in the
// submitted payload under that name and nothing is reactive. Outside one, the
// same line is a bound CONTROL over a declared `:state`, exactly like `:bind`
// and `:slider` — changing it writes the state, changing the state moves it.
//
// The two cannot be told apart from the line alone, and inferring it from
// "does a state of that name happen to exist?" would mean declaring an
// unrelated `:state topic` elsewhere on the page silently rewires a form. So
// the enclosing `:form` says so: `handleForm` flags the context it compiles its
// body with, and `nestedCtx` spreads that flag into every nested block, so a
// field inside a `:::` inside the form still sees it.
//
// The flag rides on the context object rather than the `Ctx` typedef because
// `context.js` is the root of the module DAG and knows nothing about forms.
// (Known limit: an `@include` compiles its target with a fresh context, so a
// field directive inside an included partial is always the standalone form.)
// ---------------------------------------------------------------------------

/** @param {Ctx} ctx @returns {boolean} */
const inForm = (ctx) => Boolean(/** @type {any} */ (ctx).inForm);

/**
 * Resolve a standalone field's state key, or explain how to declare it.
 * @param {string} name
 * @param {string} directive `:select` / `:checkbox` / `:radio`.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line`.
 * @returns {string} The fully-qualified state key.
 */
function boundKey(name, directive, ctx, index) {
  const key = resolveStateKey(name, ctx);
  if (key) return key;
  const seed = directive === ":checkbox" ? "false" : '"…"';
  const hint = `declare the state first — :state ${name} = ${seed} — or move ${directive} inside a :form, where the name is a form field instead`;
  throw wdError(
    `${directive} ${name} in ${at(ctx, index)} is outside a :form and has no matching state. Use: ${hint} — e.g. ${SELECT_EXAMPLE}`,
    { code: "WD450", file: ctx.file, line: lineOf(ctx, index), hint, example: SELECT_EXAMPLE }
  );
}

/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleForm(line, bodyLines, ctx, index) {
  const rest = line.slice(":form".length).trim();
  const rawAction = rest.match(/action="([^"]+)"/)?.[1];
  const method = rest.match(/method="([^"]+)"/)?.[1] || "post";
  const into = rest.match(/(?:^|\s)into\s+([A-Za-z_$][\w$]*)/)?.[1];
  const leftover = rest
    .replace(/action="[^"]+"/, "")
    .replace(/method="[^"]+"/, "")
    .replace(/(?:^|\s)into\s+[A-Za-z_$][\w$]*/, "")
    .trim();
  if ((!rawAction && !into) || leftover) {
    const hint = `':form into name' (client state), ':form action="/url"' (native post), or both (fetch round-trip into state) — e.g. ${FORM_EXAMPLE}`;
    throw wdError(`Malformed :form in ${at(ctx, index)}: ${line}. Use ${hint}`, {
      code: "WD401",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: FORM_EXAMPLE
    });
  }
  const action = rawAction ? validateFetchUrl(rawAction, ctx, ":form action") : undefined;
  // See the `inForm` note above: the body's context carries the flag that makes
  // a field directive a FORM FIELD rather than a bound control.
  const bodyCtx = /** @type {any} */ (nestedCtx(ctx, index + 1));
  bodyCtx.inForm = true;
  const inner = ctx.compileBody(bodyLines, bodyCtx).trim();
  // A file cannot be urlencoded, so a form carrying one has to be multipart —
  // in the browser's native submit (this attribute) and in the runtime's
  // round-trip (which posts the FormData itself). A GET form has no body at
  // all, so the file would be dropped and only its NAME would travel: that is
  // the silent kind of failure, so it is a compile error instead.
  const hasFile = /<input[^>]*\btype="file"/i.test(inner);
  if (hasFile && method.toLowerCase() === "get") {
    const hint = `drop method="get" (a :form posts by default) — a GET request has no body, so the file would never be sent — e.g. ${FORM_EXAMPLE}`;
    throw wdError(`:form in ${at(ctx, index)} has a file field and method="get". Use: ${hint}`, {
      code: "WD452",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: FORM_EXAMPLE
    });
  }
  const enctype = hasFile ? ` enctype="multipart/form-data"` : "";
  if (!into) {
    return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}"${enctype}>${inner}</form>`;
  }
  const key = declareState(into, null, ctx);
  declareErrorState(key, ctx);
  recordSymbol(ctx, index, {
    kind: "form",
    name: key,
    target: key,
    detail: `:form action="${rawAction}" into ${into}`
  });
  const actionAttrs = action
    ? ` action="${escapeHtml(action)}" method="${escapeHtml(method)}"${enctype}`
    : "";
  return `<script type="application/json" data-wd-state>${safeScriptJson({ [key]: null })}</script><form data-wd-form="${escapeHtml(key)}"${actionAttrs}>${inner}</form>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInput(line, ctx, index) {
  const match = line.match(/^:input\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match)
    throw wdError(`Malformed :input in ${at(ctx, index)}: ${line}. ${INPUT_USE}`, {
      code: "WD402",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: INPUT_USE.slice("Use: ".length),
      example: INPUT_EXAMPLE
    });
  const attrs = [`name="${escapeHtml(match[1])}"`];
  recordSymbol(ctx, index, { kind: "field", name: match[1], detail: `:input ${match[1]}` });
  let type = "text";
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw wdError(`Unknown :input flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD403",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") {
      type = value;
      continue;
    }
    if (
      ![
        "placeholder",
        "value",
        "min",
        "max",
        "step",
        "pattern",
        "autocomplete",
        "aria-label",
        "aria-describedby"
      ].includes(token[1])
    ) {
      throw wdError(`Unknown :input attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD404",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name: if the author supplied neither aria-label nor aria-describedby,
  // derive a non-visual aria-label from the placeholder, else from the field name.
  // Never overrides an author-supplied aria attribute (zero layout impact).
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<input type="${escapeHtml(type)}" ${attrs.join(" ")}>`;
}

// :bind <state> [placeholder="…"] [type=…] — a live two-way input bound to a
// declared :state. Updates state on every keystroke; reflects state back when
// not focused. The state must be declared first (with :state).
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleBind(line, ctx, index) {
  const match = line.match(/^:bind\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
  if (!match)
    throw wdError(`Malformed :bind in ${at(ctx, index)}: ${line}. Use: ${BIND_EXAMPLE}`, {
      code: "WD405",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: BIND_EXAMPLE,
      example: BIND_EXAMPLE
    });
  const key = resolveStateKey(match[1], ctx);
  if (!key) {
    throw wdError(
      `:bind ${match[1]} in ${ctx.file} has no matching state. Declare it first: :state ${match[1]} = ""`,
      { code: "WD406", file: ctx.file }
    );
  }
  recordSymbol(ctx, index, {
    kind: "field",
    name: match[1],
    target: key,
    detail: `:bind ${match[1]}`
  });
  ctx.comp.assets.runtime = true;
  let type = "text";
  let placeholder;
  let hasAria = false;
  const attrs = [];
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus"].includes(token[3]))
        throw wdError(`Unknown :bind flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD407",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") {
      type = value;
      continue;
    }
    if (!["placeholder", "autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw wdError(`Unknown :bind attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD408",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name (see handleInput): default a non-visual aria-label from the
  // placeholder, else a humanized version of the bound state key. The author's own
  // aria-label/aria-describedby always wins.
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  const initial = ctx.comp.state.get(key);
  const valueAttr =
    initial === undefined || initial === null ? "" : ` value="${escapeHtml(String(initial))}"`;
  return `<input type="${escapeHtml(type)}" data-wd-bind-input="${escapeHtml(key)}"${valueAttr} ${attrs.join(" ")}>`;
}

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
export function handleSlider(line, ctx, index) {
  const head = line.match(/^:slider\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
  if (!head)
    throw wdError(`Malformed :slider in ${at(ctx, index)}: ${line}. Use: ${SLIDER_EXAMPLE}`, {
      code: "WD409",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: SLIDER_EXAMPLE,
      example: SLIDER_EXAMPLE
    });
  const name = head[1];
  let rest = head[2].trim();

  /** @type {string | undefined} */
  let initialRaw;
  if (rest.startsWith("=")) {
    const valueMatch = rest.match(/^=\s*(\S+)\s*(.*)$/);
    if (!valueMatch)
      throw wdError(
        `Malformed :slider initial value in ${at(ctx, index)}: ${line}. Use: :slider ${name} = 50`,
        { code: "WD410", file: ctx.file, line: lineOf(ctx, index) }
      );
    initialRaw = valueMatch[1];
    rest = valueMatch[2].trim();
  }

  let min = "0";
  let max = "100";
  let step = "1";
  /** @type {string | undefined} */
  let ariaLabel;
  let persist = false;
  for (const token of rest.matchAll(/([A-Za-z-]+)=("[^"]*"|\S+)|(\bpersist\b)/g)) {
    if (token[3]) {
      persist = true;
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "min") min = value;
    else if (token[1] === "max") max = value;
    else if (token[1] === "step") step = value;
    else if (token[1] === "aria-label") ariaLabel = value;
    else
      throw wdError(`Unknown :slider attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD411",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
  }
  for (const [label, raw] of [
    ["min", min],
    ["max", max],
    ["step", step]
  ]) {
    if (!/^-?\d+(?:\.\d+)?$/.test(raw))
      throw wdError(`:slider ${label} must be a number in ${at(ctx, index)}: ${raw}`, {
        code: "WD412",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
  }

  ctx.comp.assets.runtime = true;
  /** @type {string} */
  let key;
  let seed = "";
  if (initialRaw !== undefined) {
    const value = parseStateValue(initialRaw, at(ctx, index));
    if (typeof value !== "number")
      throw wdError(
        `:slider ${name} initial value must be a number in ${at(ctx, index)}: ${initialRaw}`,
        { code: "WD413", file: ctx.file, line: lineOf(ctx, index) }
      );
    key = declareState(name, value, ctx);
    const persistAttr = persist ? ` data-wd-persist="${escapeHtml(key)}"` : "";
    seed = `<script type="application/json" data-wd-state${persistAttr}>${safeScriptJson({ [key]: value })}</script>`;
  } else {
    if (persist)
      throw wdError(
        `:slider persist only applies when declaring state inline (:slider ${name} = 0 … persist) in ${at(ctx, index)}`,
        { code: "WD414", file: ctx.file, line: lineOf(ctx, index) }
      );
    const resolved = resolveStateKey(name, ctx);
    if (!resolved)
      throw wdError(
        `:slider ${name} in ${ctx.file} has no matching state. Declare it: :slider ${name} = 0 min=0 max=100`,
        { code: "WD415", file: ctx.file }
      );
    key = resolved;
  }

  const initial = ctx.comp.state.get(key);
  const valueAttr =
    initial === undefined || initial === null ? "" : ` value="${escapeHtml(String(initial))}"`;
  const ariaAttr = ` aria-label="${escapeHtml(ariaLabel || humanizeName(name))}"`;
  recordSymbol(ctx, index, { kind: "field", name, target: key, detail: `:slider ${name}` });
  return `${seed}<input type="range" data-wd-bind-input="${escapeHtml(key)}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}"${valueAttr}${ariaAttr}>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSubmit(line, ctx, index) {
  const match = line.match(/^:submit\s+"([^"]+)"\s*$/);
  if (!match)
    throw wdError(
      `Malformed :submit in ${at(ctx, index)}: ${line}. Use: :submit "Label" — e.g. ${SUBMIT_EXAMPLE}`,
      {
        code: "WD416",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: `:submit "Label" — e.g. ${SUBMIT_EXAMPLE}`,
        example: SUBMIT_EXAMPLE
      }
    );
  recordSymbol(ctx, index, { kind: "field", name: "submit", detail: line.trim() });
  return `<button type="submit">${escapeHtml(match[1])}</button>`;
}

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
export function handleTextarea(line, ctx, index) {
  const match = line.match(/^:textarea\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) {
    const hint = `:textarea name [placeholder="…"] [rows=N] [required] — e.g. ${TEXTAREA_EXAMPLE}`;
    throw wdError(`Malformed :textarea in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
      code: "WD417",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: TEXTAREA_EXAMPLE
    });
  }
  const attrs = [`name="${escapeHtml(match[1])}"`];
  recordSymbol(ctx, index, { kind: "field", name: match[1], detail: `:textarea ${match[1]}` });
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw wdError(`Unknown :textarea flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD418",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (
      ![
        "placeholder",
        "rows",
        "cols",
        "minlength",
        "maxlength",
        "autocomplete",
        "aria-label",
        "aria-describedby"
      ].includes(token[1])
    ) {
      throw wdError(`Unknown :textarea attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD419",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<textarea ${attrs.join(" ")}></textarea>`;
}

/**
 * `:select name [required]` followed by `- Label` list lines → a `<select>` with
 * one `<option>` per label (value === label). Derives an aria-label from the
 * humanized name when none is given.
 *
 * Inside a `:form` it is a form field captured by FormData, exactly as before.
 * Outside one it is a control two-way bound to a declared `:state` of that name
 * (see the `inForm` note at the top of this file): the seed selects the matching
 * option, changing the control writes the state, and changing the state moves
 * the control.
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleSelect(line, optionLines, ctx, index) {
  const match = line.match(/^:select\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) {
    const hint = `:select name [required] then "- Label" lines — e.g. ${SELECT_EXAMPLE}`;
    throw wdError(`Malformed :select in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
      code: "WD420",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: SELECT_EXAMPLE
    });
  }
  const bound = inForm(ctx) ? null : boundKey(match[1], ":select", ctx, index);
  const attrs = bound
    ? [`data-wd-bind-input="${escapeHtml(bound)}"`]
    : [`name="${escapeHtml(match[1])}"`];
  if (bound) ctx.comp.assets.runtime = true;
  recordSymbol(ctx, index, {
    kind: "field",
    name: match[1],
    ...(bound ? { target: bound } : {}),
    detail: `:select ${match[1]}`
  });
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw wdError(`Unknown :select flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD421",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (!["autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw wdError(`Unknown :select attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD422",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    }
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(humanizeName(match[1]))}"`);
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw wdError(
      `:select "${match[1]}" in ${at(ctx, index)} has no options. Add "- Label" lines beneath it.`,
      { code: "WD423", file: ctx.file, line: lineOf(ctx, index) }
    );
  }
  // A bound select opens on the state's current value, so the first paint agrees
  // with what the runtime will reflect a moment later.
  const selected = bound ? String(ctx.comp.state.get(bound) ?? "") : null;
  const opts = options
    .map(
      (o) =>
        `<option value="${escapeHtml(o)}"${o === selected ? " selected" : ""}>${escapeHtml(o)}</option>`
    )
    .join("");
  return `<select ${attrs.join(" ")}>${opts}</select>`;
}

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
 *
 * OUTSIDE a `:form` (see the `inForm` note at the top of this file) both bind to
 * a declared `:state` of that name instead: a `:radio` group binds the STRING of
 * the chosen option, and a `:checkbox` binds a BOOLEAN, so it takes exactly one
 * option — the label to show beside it.
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {"checkbox" | "radio"} kind
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleChoiceGroup(line, optionLines, ctx, kind, index) {
  const directive = `:${kind}`;
  const match = line.match(
    kind === "checkbox"
      ? /^:checkbox\s+([A-Za-z_][\w-]*)\s*(.*)$/
      : /^:radio\s+([A-Za-z_][\w-]*)\s*(.*)$/
  );
  if (!match) {
    const example = kind === "checkbox" ? CHECKBOX_EXAMPLE : RADIO_EXAMPLE;
    const hint = `${directive} name [required] then "- Label" lines — e.g. ${example}`;
    throw wdError(`Malformed ${directive} in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
      code: "WD424",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example
    });
  }
  const name = match[1];
  const bound = inForm(ctx) ? null : boundKey(name, directive, ctx, index);
  if (bound) ctx.comp.assets.runtime = true;
  recordSymbol(ctx, index, {
    kind: "field",
    name,
    ...(bound ? { target: bound } : {}),
    detail: `:${kind} ${name}`
  });
  const flags = [];
  let ariaLabel = null;
  let ariaDescribedby = null;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw wdError(`Unknown ${directive} flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD425",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      }
      flags.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "aria-label") ariaLabel = value;
    else if (token[1] === "aria-describedby") ariaDescribedby = value;
    else
      throw wdError(`Unknown ${directive} attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD426",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw wdError(
      `${directive} "${name}" in ${at(ctx, index)} has no options. Add "- Label" lines beneath it.`,
      { code: "WD427", file: ctx.file, line: lineOf(ctx, index) }
    );
  }
  const isCheckbox = kind === "checkbox";
  // A bound checkbox is one boolean, so a list of options has no meaning: the
  // author is reaching for a multi-value control that would need every box to
  // write the same key.
  if (bound && isCheckbox && options.length > 1) {
    const hint = `a bound :checkbox is a single true/false, so give it one "- Label" line. For a list of choices, use a :radio group (one value) or drive an array with :button "…" -> ${name} toggle "Label"`;
    throw wdError(
      `:checkbox ${name} in ${at(ctx, index)} is bound to state and has ${options.length} options. Use: ${hint} — e.g. ${CHECKBOX_EXAMPLE}`,
      { code: "WD451", file: ctx.file, line: lineOf(ctx, index), hint, example: CHECKBOX_EXAMPLE }
    );
  }
  const groupAttrs = [
    `class="wd-${isCheckbox ? "checkboxes" : "radios"}"`,
    `role="${isCheckbox ? "group" : "radiogroup"}"`
  ];
  // `data-wd-multi` tells the form submit handler to collect every checked box
  // into an array. A bound checkbox is not in a form and is not an array.
  if (isCheckbox && !bound) groupAttrs.push(`data-wd-multi="${escapeHtml(name)}"`);
  groupAttrs.push(`aria-label="${escapeHtml(ariaLabel || humanizeName(name))}"`);
  if (ariaDescribedby) groupAttrs.push(`aria-describedby="${escapeHtml(ariaDescribedby)}"`);
  const disabled = flags.includes("disabled");
  const required = flags.includes("required");
  const autofocus = flags.includes("autofocus");
  const current = bound ? ctx.comp.state.get(bound) : undefined;
  const controls = options
    .map((opt, idx) => {
      const a = [
        `type="${kind}"`,
        `name="${escapeHtml(bound || name)}"`,
        `value="${escapeHtml(opt)}"`
      ];
      // A radio group still needs its shared `name` to be mutually exclusive in
      // the browser, so the bound form keys it by the state key.
      if (bound) a.push(`data-wd-bind-input="${escapeHtml(bound)}"`);
      if (bound && (isCheckbox ? Boolean(current) : String(current ?? "") === opt))
        a.push("checked");
      if (disabled) a.push("disabled");
      if (required && !isCheckbox) a.push("required");
      if (autofocus && idx === 0) a.push("autofocus");
      return `<label><input ${a.join(" ")}> ${escapeHtml(opt)}</label>`;
    })
    .join("");
  return `<div ${groupAttrs.join(" ")}>${controls}</div>`;
}
