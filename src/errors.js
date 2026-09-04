// ---------------------------------------------------------------------------
// The stable compile-error code registry.
//
// Every author-facing compile error carries a `WDxxx` code: `wdError()`
// (src/compiler/context.js) prefixes the message with `[WDxxx] ` and mirrors it
// onto `err.wd.code`, so a user can paste the code into a search box and tooling
// can match on an identifier instead of prose. This file is the single source of
// truth for what those codes MEAN; `docs/errors.md` is generated from it
// (scripts/gen-errors.mjs) and `directiveCatalog().errors` exposes it to the
// machine-readable surface AI tooling already consumes.
//
// NUMBERING (the hundreds digit is the subsystem; it never moves):
//   WD0xx  source, frontmatter, prose interpolation, block structure
//   WD1xx  loops (@loop) and typed content collections
//   WD2xx  state (:state/:store/:computed/:theme) and the expression whitelists
//   WD3xx  actions (:button/:effect/:every)
//   WD4xx  forms and form fields
//   WD5xx  data fetching (:fetch) and URL safety
//   WD6xx  includes and page structure (@include, :::, :if, :carousel, :try)
//   WD7xx  media and embeds
//   WD8xx  skins and styling
//   WD9xx  project, routing, deploy, CLI
//
// CODES ARE A PUBLIC CONTRACT. Once a code ships it is permanent:
//   * NEVER renumber a code, and NEVER reuse a retired one. A code that is
//     withdrawn goes in RETIRED_CODES below and stays there forever, so the
//     next number is always fresh even when the error itself is gone.
//   * A code's MEANING may be refined (better wording, a better fix) but must
//     keep pointing at the same authoring mistake.
//   * New errors take the next free number in their subsystem block.
//
// WHAT GETS A CODE. Author-facing compile errors (anything a `.wd`/`.md`/
// `.skin`/frontmatter/CLI input can trigger) all go through `wdError` and carry
// a code. Genuine INTERNAL invariants do not: `src/compiler/expr-ast.js` parses
// the compiler's own already-validated output and `src/compiler/reader.js`
// guards the host reader contract, so a throw there is a framework bug, not
// something an author can fix, and it stays a plain `Error`. That split is
// enforced by tests/error-codes.test.js.
//
// Examples are drawn from the SAME `*_EXAMPLE` constants the compiler's error
// hints use, exactly like src/catalog.js, so a documented example cannot drift
// from what actually compiles.
// ---------------------------------------------------------------------------

import {
  ACTION_EXAMPLE,
  BUTTON_EXAMPLE,
  EFFECT_EXAMPLE,
  EVERY_EXAMPLE
} from "./compiler/actions.js";
import { FETCH_EXAMPLE } from "./compiler/fetch.js";
import {
  BIND_EXAMPLE,
  CHECKBOX_EXAMPLE,
  FORM_EXAMPLE,
  INPUT_EXAMPLE,
  RADIO_EXAMPLE,
  SELECT_EXAMPLE,
  SLIDER_EXAMPLE,
  SUBMIT_EXAMPLE,
  TEXTAREA_EXAMPLE
} from "./compiler/forms.js";
import { LOOP_EXAMPLE } from "./compiler/loops.js";
import { EMBED_EXAMPLE, VIDEO_EXAMPLE } from "./compiler/media.js";
import {
  COMPUTED_EXAMPLE,
  STATE_EXAMPLE,
  STORE_EXAMPLE,
  THEME_EXAMPLE,
  URL_STATE_EXAMPLE
} from "./compiler/state.js";
import {
  CAROUSEL_EXAMPLE,
  CONTAINER_A11Y_EXAMPLE,
  CONTAINER_EXAMPLE,
  IF_EXAMPLE,
  INCLUDE_EXAMPLE
} from "./compiler/structure.js";

/**
 * One subsystem block of the numbering scheme.
 * @typedef {object} ErrorArea
 * @property {number} block The hundreds digit (0-9).
 * @property {string} range Human label for the block, e.g. `WD1xx`.
 * @property {string} name Short machine name, e.g. `loops`.
 * @property {string} title One-line description of what the block covers.
 */

/**
 * A registered error code.
 * @typedef {object} ErrorEntry
 * @property {string} code The stable `WDxxx` identifier.
 * @property {string} area The subsystem name (derived from the hundreds digit).
 * @property {string} title Short name for the mistake.
 * @property {string} cause What the author wrote that triggers it.
 * @property {string} fix The corrective action, in one line.
 * @property {string} [example] A concrete, compilable line, sourced from the
 *   compiler's own `*_EXAMPLE` constants.
 */

/** The subsystem blocks, in code order. */
/** @type {ErrorArea[]} */
export const ERROR_AREAS = [
  { block: 0, range: "WD0xx", name: "source", title: "Source, frontmatter & block structure" },
  { block: 1, range: "WD1xx", name: "loops", title: "Loops & collections" },
  { block: 2, range: "WD2xx", name: "state", title: "State & expressions" },
  { block: 3, range: "WD3xx", name: "actions", title: "Button, effect & timer actions" },
  { block: 4, range: "WD4xx", name: "forms", title: "Forms & form fields" },
  { block: 5, range: "WD5xx", name: "fetch", title: "Data fetching & URL safety" },
  { block: 6, range: "WD6xx", name: "structure", title: "Includes & page structure" },
  { block: 7, range: "WD7xx", name: "media", title: "Media & embeds" },
  { block: 8, range: "WD8xx", name: "skin", title: "Skins & styling" },
  { block: 9, range: "WD9xx", name: "project", title: "Project, routing & CLI" }
];

/**
 * Codes that were withdrawn. They are NEVER reused: a retired number stays
 * listed here so the next free number in its block is always genuinely free,
 * and so an old error message found in a log or an issue still resolves to a
 * meaningful (if historical) entry. Empty today.
 * @type {string[]}
 */
export const RETIRED_CODES = [];

/** The registry, in code order. */
/** @type {Omit<ErrorEntry, "area">[]} */
const ENTRIES = [
  // --- WD0xx: source, frontmatter, prose, block structure ------------------
  {
    code: "WD001",
    title: "Unterminated frontmatter",
    cause: "The file opens with `---` but never closes the block.",
    fix: "Add a closing `---` on its own line before the page body."
  },
  {
    code: "WD002",
    title: "Disallowed path segment",
    cause: "A dotted path contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Read a different path; those segments are rejected everywhere for safety."
  },
  {
    code: "WD003",
    title: "Cannot interpolate an object value",
    cause: "`{ name }` resolved to an object, which has no sensible text form.",
    fix: "Interpolate one of its fields (`{ name.title }`) or iterate it with `@loop`."
  },
  {
    code: "WD004",
    title: "Unbalanced JSON value",
    cause: "A `:state`/`:store`/`:theme` value opens `[` or `{` and never closes it.",
    fix: "Balance the literal (no blank lines inside it), or quote it as text.",
    example: STATE_EXAMPLE
  },
  {
    code: "WD005",
    title: "Loop variable used outside a loop",
    cause: "`{ $index }` (or another `$` row variable) appears outside a `@loop` body.",
    fix: "Move the interpolation into a loop body, or rename your value."
  },
  {
    code: "WD006",
    title: "Unknown format pipe",
    cause: "`{ value | name }` names a formatter that is not in the fixed whitelist.",
    fix: "Use one of the catalogued pipes; the message lists every available name."
  },
  {
    code: "WD007",
    title: "Stray `:::` close",
    cause: "A bare `:::` line appears with no container open.",
    fix: "Open the container first, or delete the stray closer.",
    example: CONTAINER_EXAMPLE
  },
  {
    code: "WD008",
    title: "Retired `@repeat` directive",
    cause: "`@repeat` was replaced by the single `@loop` directive.",
    fix: "Rewrite the block as `@loop … into … @endloop`.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD009",
    title: "Retired `:for` directive",
    cause: "`:for` was replaced by the single `@loop` directive.",
    fix: "Rewrite the block as `@loop … into … @endloop`.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD010",
    title: "Stray block closer",
    cause: "An `@endloop`/`:endif`/`:endform`/`:else` line has no matching opener.",
    fix: "Open the matching block, or delete the stray closer."
  },
  {
    code: "WD011",
    title: "Missing block closer",
    cause: "A `@loop`/`:form`/`:carousel` block runs to the end of the file unclosed.",
    fix: "Close the block with its own closing token."
  },
  {
    code: "WD012",
    title: "Missing closing `:::`",
    cause: "A `::: container` block is never closed.",
    fix: "Add a bare `:::` line to close the container.",
    example: CONTAINER_EXAMPLE
  },
  {
    code: "WD013",
    title: "`:else if` after `:else`",
    cause: "A conditional continues with `:else if` after a bare `:else` already closed it.",
    fix: "Order every `:else if` before the bare `:else`."
  },
  {
    code: "WD014",
    title: "Duplicate `:else`",
    cause: "A conditional has more than one bare `:else` branch.",
    fix: "Keep one `:else`; turn the others into `:else if` branches."
  },
  {
    code: "WD015",
    title: "Missing `:endif`",
    cause: "An `:if` region is never closed.",
    fix: "Close the region with `:endif`.",
    example: IF_EXAMPLE
  },
  {
    code: "WD016",
    title: "Unknown structured-data type",
    cause: "Frontmatter `schema:` names a type outside the supported whitelist.",
    fix: "Use one of the listed schema.org types; the message names every one."
  },

  // --- WD1xx: loops and collections ----------------------------------------
  {
    code: "WD101",
    title: "Malformed `@loop` header",
    cause: "The header does not read `@loop <source> into <item>`.",
    fix: "Name a source and an item variable, then any clauses in the fixed order.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD102",
    title: "Malformed `@loop` clause",
    cause: "A clause is misspelled or written out of the fixed order.",
    fix: "Order clauses `where`, `sort by`, `reverse`, `offset`, `limit`, `paginate`, `sortable`.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD103",
    title: "Unknown `sort by { state }` key",
    cause: "A reactive sort key references a `:state`/`:store` that is not declared.",
    fix: "Declare the state first, or sort by a literal item field.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD104",
    title: "Sort key is not a loop-item field",
    cause: "`sort by` names something other than the loop item.",
    fix: "Sort by `<item>.field`, using the item name from the `into` clause.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD105",
    title: "Disallowed sort key path",
    cause: "The sort key contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Sort by an ordinary data field."
  },
  {
    code: "WD106",
    title: "Unknown sort direction state",
    cause: "A reactive `{ direction }` references a `:state`/`:store` that is not declared.",
    fix: "Declare the state first, or use the literal `asc`/`desc`.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD107",
    title: "Invalid `offset`/`limit` argument",
    cause: "The argument is neither a non-negative integer nor a declared `:state`.",
    fix: "Pass an integer literal or a declared state key.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD108",
    title: "`sortable` combined with other clauses",
    cause: "`sortable` reorders the underlying list, so a derived view would desynchronise.",
    fix: "Drop `where`/`sort`/`reverse`/`offset`/`limit`/`paginate` from a sortable loop."
  },
  {
    code: "WD109",
    title: "`paginate` combined with `offset`/`limit`",
    cause: "`paginate` already slices each page, so an explicit slice conflicts with it.",
    fix: "Keep `paginate N` and remove `offset`/`limit`."
  },
  {
    code: "WD110",
    title: "`paginate` on a non-collection source",
    cause: "Pagination multiplies static routes, which only makes sense for a collection.",
    fix: "Paginate a collection (a `site/pages/<name>/` subdirectory) by its bare name."
  },
  {
    code: "WD111",
    title: "Loop data file is not a JSON array",
    cause: "The `.json` source parses to an object or a scalar.",
    fix: "Make the file a top-level JSON array of rows."
  },
  {
    code: "WD112",
    title: "In-scope loop source is not a list",
    cause: "The name resolved to a scalar or object value in scope.",
    fix: "Point the loop at a list, or omit the field to render the `@empty` branch."
  },
  {
    code: "WD113",
    title: "Disallowed `@loop` source path",
    cause: "The source path contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Loop an ordinary collection, JSON file, scope value, or state list."
  },
  {
    code: "WD114",
    title: "`sortable` on a nested loop",
    cause: "An item-relative loop has no top-level state list to reorder.",
    fix: "Make the sortable loop read a top-level `:state`/`:store` list."
  },
  {
    code: "WD115",
    title: "Unresolved `@loop` source",
    cause: "The source is not a collection, JSON file, in-scope value, or declared state.",
    fix: "Check the name; the message lists the available collections.",
    example: LOOP_EXAMPLE
  },
  {
    code: "WD116",
    title: "Reactive loop nested too deep",
    cause: "A third reactive `@loop` level would paint empty at runtime.",
    fix: "Unroll the outer data at build time, or move the innermost list into build data."
  },
  {
    code: "WD117",
    title: "`sortable` needs a state list",
    cause: "`sortable` was used on a JSON file or in-scope value, which cannot be reordered.",
    fix: "Reorder a `:state`/`:store` list instead."
  },
  {
    code: "WD120",
    title: "Malformed `_schema.wd` line",
    cause: "A schema line does not read `field: type`.",
    fix: "Write one `field: type` rule per line inside the `---` block."
  },
  {
    code: "WD121",
    title: "Unknown `_schema.wd` type",
    cause: "The type is outside the closed vocabulary.",
    fix: "Use `string`, `number`, `boolean`, `date`, or `string[]`, with `?` for optional."
  },
  {
    code: "WD122",
    title: "Undeclared frontmatter field",
    cause: "A collection entry has a field the schema does not declare (often a typo).",
    fix: "Add the field to `_schema.wd`, or remove it from the entry."
  },
  {
    code: "WD123",
    title: "Missing required frontmatter field",
    cause: "A collection entry omits a field the schema requires.",
    fix: "Add the field to the entry, or mark it optional with `?` in the schema."
  },
  {
    code: "WD124",
    title: "Frontmatter field has the wrong type",
    cause: "An entry's value does not match its schema type.",
    fix: "Fix the entry's value, or widen the type in `_schema.wd`."
  },
  {
    code: "WD190",
    title: "Expression could not be compiled",
    cause:
      "A `:if` or `::: … when` condition folded a build-time value the expression re-parser cannot read back.",
    fix: 'Use simpler operands — a field path, a declared `:state`, a plain number, or a `"string"`.'
  },
  {
    code: "WD191",
    title: "Reactive `@loop` over markdown table rows",
    cause:
      "A `@loop` whose body is bare `| … |` cells resolves to a reactive source, and a reactive row is cloned into a `<div>`, which cannot live inside a `<table>`.",
    fix: "Loop a static source (a JSON file, a frontmatter list, or a collection) for a markdown table — and if the source is already static, drop the `:state` the `where`/`limit`/`sort by` clause reads — or build reactive rows from containers (`::: trow` / `::: td`) instead of `|` cells."
  },

  // --- WD2xx: state and expressions ----------------------------------------
  {
    code: "WD201",
    title: "Malformed `:state`",
    cause: "The line does not read `:state name = value [persist|ephemeral]`.",
    fix: "Give the state a name and an initial value.",
    example: STATE_EXAMPLE
  },
  {
    code: "WD202",
    title: "`:state` inside a reactive loop",
    cause: "State cannot be declared per row; a loop body has no place to hold it.",
    fix: "Declare the state outside the loop."
  },
  {
    code: "WD203",
    title: "`:state` collides with a `:store`",
    cause: "A page-global store already owns that name.",
    fix: "Rename one of them, or use the store everywhere.",
    example: STORE_EXAMPLE
  },
  {
    code: "WD204",
    title: "`:state` declared twice",
    cause: "The same name is declared twice in one section scope.",
    fix: "Remove the duplicate, or scope one declaration to its own `::: section`."
  },
  {
    code: "WD205",
    title: "Malformed `:store`",
    cause: "The line does not read `:store name = value [persist|ephemeral]`.",
    fix: "Give the store a name and an initial value.",
    example: STORE_EXAMPLE
  },
  {
    code: "WD206",
    title: "`:store` declared twice",
    cause: "Stores are page-global, so a second declaration is ambiguous.",
    fix: "Declare the store once and reference it everywhere else.",
    example: STORE_EXAMPLE
  },
  {
    code: "WD207",
    title: "`:store` collides with a `:state`",
    cause: "A `:state` of the same name is already declared on the page.",
    fix: "Rename one of them, or use the store everywhere.",
    example: STORE_EXAMPLE
  },
  {
    code: "WD208",
    title: "Malformed `:computed`",
    cause: "The line does not read `:computed name = <expression>`.",
    fix: "Give the computed value a name and a right-hand expression.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD209",
    title: "Malformed `:computed` expression",
    cause: "The right-hand side passes the character whitelist but is not a real expression.",
    fix: "Write a complete expression over declared state, numbers, and operators.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD210",
    title: "Malformed `:theme`",
    cause: 'The line does not read `:theme [name] [= "auto"]`.',
    fix: "Use a bare `:theme`, or name the store and seed it.",
    example: THEME_EXAMPLE
  },
  {
    code: "WD211",
    title: "Persistence token on `:computed`",
    cause:
      "The expression ends in a bare `persist`, `ephemeral`, or `from-url`, which is swallowed into it.",
    fix: "Computed values are derived, not stored. Put the token on the state they derive from instead.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD220",
    title: "Malformed `where` condition",
    cause: "A `where` condition is not `operand <op> operand`.",
    fix: "Compare a loop-item field with a value using a whitelisted operator."
  },
  {
    code: "WD221",
    title: "Unsupported `where` operand",
    cause: "An operand is not an item field, a state name, a number, or a quoted string.",
    fix: "Use one of those four operand forms."
  },
  {
    code: "WD222",
    title: "Disallowed `where` path",
    cause: "An operand path contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Compare an ordinary data field."
  },
  {
    code: "WD223",
    title: "Unknown name in `where`",
    cause: "An operand names neither the loop item nor a declared `:state`.",
    fix: "Use the loop item's field, or declare the state first."
  },
  {
    code: "WD224",
    title: "Unsupported `when`/`:if` operand",
    cause: "An operand is not an item field, a state name, a number, or a quoted string.",
    fix: "Use one of those four operand forms.",
    example: IF_EXAMPLE
  },
  {
    code: "WD225",
    title: "Disallowed `when`/`:if` path",
    cause: "An operand path contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Compare an ordinary data field."
  },
  {
    code: "WD226",
    title: "Unknown name in `when`/`:if`",
    cause: "An operand names nothing in scope: no loop item, no scope value, no state.",
    fix: "Declare the state first, or reference a value that is in scope.",
    example: IF_EXAMPLE
  },
  {
    code: "WD227",
    title: "Disallowed aggregate path",
    cause: "A `sum`/`avg`/`min`/`max`/`count` argument contains a prototype-poisoning segment.",
    fix: "Aggregate an ordinary state list."
  },
  {
    code: "WD228",
    title: "Unknown state in a `:computed` aggregate",
    cause: "The aggregated list is not a declared `:state`/`:store`/`:fetch` key.",
    fix: "Declare the list first.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD229",
    title: "Unsupported string syntax in `:computed`",
    cause: "The expression contains a quote, backslash, or backtick outside a simple literal.",
    fix: "Use plain double- or single-quoted string literals."
  },
  {
    code: "WD230",
    title: "Unsupported syntax in `:computed`",
    cause: "The expression contains characters outside the closed whitelist.",
    fix: "Use state names, numbers, strings, arithmetic, comparisons, and `&& || !`.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD231",
    title: "Assignment in `:computed`",
    cause: "A `:computed` expression derives a value; it may not assign one.",
    fix: "Mutate state from a `:button`/`:effect` action instead."
  },
  {
    code: "WD232",
    title: "Function call in `:computed`",
    cause: "Only the fixed `sum`/`avg`/`min`/`max`/`count` aggregates may look like calls.",
    fix: "Remove the call, or use one of the aggregates."
  },
  {
    code: "WD233",
    title: "Disallowed `:computed` path segment",
    cause: "A referenced path contains `constructor`, `prototype`, or `__proto__`.",
    fix: "Read an ordinary state path."
  },
  {
    code: "WD234",
    title: "Unknown state in `:computed`",
    cause: "The expression references a name that is not declared state.",
    fix: "Declare it with `:state`, `:store`, or `:fetch` first.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD250",
    title: "Reserved state declaration name",
    cause:
      "A `:state`/`:store`/`:computed`/`:fetch`/`:form`/`:slider`/`:theme` name is `__proto__`, `constructor`, or `prototype`, which the runtime's state object inherits rather than owns.",
    fix: "Rename the key — any other name works.",
    example: STATE_EXAMPLE
  },
  {
    code: "WD251",
    title: "State seeded from another state",
    cause:
      "A `:state`/`:store` value is a bare name that is already declared state, so it would be stored as that literal text and never track the value.",
    fix: "Derive it with `:computed`, or quote the text to keep it literal.",
    example: COMPUTED_EXAMPLE
  },
  {
    code: "WD260",
    title: "`from-url` on a keyword that cannot take it",
    cause:
      "`:store` and `:theme` are shared by every page and every tab, while a query parameter belongs to one page's address, so the two cannot mean the same thing.",
    fix: "Declare the value with `:state … from-url`, or drop the token.",
    example: URL_STATE_EXAMPLE
  },
  {
    code: "WD261",
    title: "Conflicting persistence modifiers",
    cause: "A declaration carries `persist` and `ephemeral` at once, or repeats the same modifier.",
    fix: "Pick one: `persist` keeps the value across reloads, `ephemeral` drops it.",
    example: STATE_EXAMPLE
  },

  // --- WD3xx: actions ------------------------------------------------------
  {
    code: "WD301",
    title: "Malformed `:button`",
    cause: 'The line does not read `:button "Label" -> action`.',
    fix: "Quote the label and give at least one action after the arrow.",
    example: BUTTON_EXAMPLE
  },
  {
    code: "WD302",
    title: "Malformed `:effect`",
    cause: "The line does not read `:effect watchedState -> action`.",
    fix: "Name one state to watch and the actions to run when it changes.",
    example: EFFECT_EXAMPLE
  },
  {
    code: "WD303",
    title: "`:effect` watches unknown state",
    cause: "The watched name is not a declared `:state`/`:store`.",
    fix: "Declare the state first.",
    example: EFFECT_EXAMPLE
  },
  {
    code: "WD304",
    title: "Malformed `:every`",
    cause: "The line does not read `:every <duration> -> action`.",
    fix: "Give a duration and the actions to run on each tick.",
    example: EVERY_EXAMPLE
  },
  {
    code: "WD305",
    title: "Invalid `:every` duration",
    cause: "The duration is not a positive `<int>[ms|s|m]` value.",
    fix: "Use a duration like `500ms`, `5s`, or `2m`.",
    example: EVERY_EXAMPLE
  },
  {
    code: "WD306",
    title: "Action targets unknown state",
    cause: "The action mutates a name that is not declared state.",
    fix: "Declare the state first.",
    example: BUTTON_EXAMPLE
  },
  {
    code: "WD307",
    title: "Row append needs a list state",
    cause: "`list += item` carries the current row into a target that is not a list.",
    fix: "Declare the target as a list, e.g. `:state cart = []`."
  },
  {
    code: "WD308",
    title: "`+=` needs a number or a list",
    cause: "`+=` with a non-number value requires a list target to append to.",
    fix: "Add a number, or declare the target as a list."
  },
  {
    code: "WD309",
    title: "Row remove inside a nested loop",
    cause: "An item-relative loop has no top-level list for the runtime to remove from.",
    fix: "Carry the row into a top-level list first, then remove it there."
  },
  {
    code: "WD310",
    title: "Row remove targets the wrong list",
    cause: "Per-row `remove` must target the same list the loop is iterating.",
    fix: "Name the looped list, or remove a value instead of the current row."
  },
  {
    code: "WD311",
    title: "Unsupported action",
    cause: "The expression is outside the fixed action vocabulary (no JavaScript is allowed).",
    fix: "Use a catalogued op; the message lists the whole vocabulary.",
    example: ACTION_EXAMPLE
  },
  {
    code: "WD312",
    title: "`merge` operand is unknown state",
    cause: "The right-hand name of a `merge` is not declared state.",
    fix: "Declare it first, or pass an inline object literal."
  },
  {
    code: "WD313",
    title: "Unsupported `merge` operand",
    cause: "The operand is neither a state key nor an inline object literal.",
    fix: "Merge a declared object state, or an inline `{…}` literal."
  },
  {
    code: "WD314",
    title: "Unsupported action literal",
    cause: "The action value is not a quoted string, number, boolean, null, or valid JSON.",
    fix: "Quote strings and use valid JSON for arrays and objects."
  },
  {
    code: "WD315",
    title: "`:every`/`:effect` inside a reactive `@loop`",
    cause:
      "A reactive loop clones its body per row, so the timer or watcher would be registered once per row and a removed row's would keep firing.",
    fix: "Declare it once outside the loop — at page level or inside the `:::` section — and act on the whole list.",
    example: EVERY_EXAMPLE
  },

  // --- WD4xx: forms and fields ---------------------------------------------
  {
    code: "WD401",
    title: "Malformed `:form`",
    cause: 'The opener has neither `into <name>` nor `action="…"`, or has leftover text.',
    fix: "Capture into state, post to a URL, or do both for a fetch round-trip.",
    example: FORM_EXAMPLE
  },
  {
    code: "WD402",
    title: "Malformed `:input`",
    cause: "The line does not start with a field name.",
    fix: "Name the field, then add optional attributes and flags.",
    example: INPUT_EXAMPLE
  },
  {
    code: "WD403",
    title: "Unknown `:input` flag",
    cause: "The bare flag is not one of `required`/`autofocus`/`disabled`/`readonly`.",
    fix: "Use a supported flag, or write it as `name=value`.",
    example: INPUT_EXAMPLE
  },
  {
    code: "WD404",
    title: "Unknown `:input` attribute",
    cause: "The attribute is outside the supported set.",
    fix: "Use a supported attribute; the compiler emits no arbitrary HTML attributes.",
    example: INPUT_EXAMPLE
  },
  {
    code: "WD405",
    title: "Malformed `:bind`",
    cause: "The line does not start with the bound state name.",
    fix: "Name a declared `:state`, then add optional attributes.",
    example: BIND_EXAMPLE
  },
  {
    code: "WD406",
    title: "`:bind` has no matching state",
    cause: "The bound name is not a declared `:state`/`:store`.",
    fix: "Declare the state before binding to it.",
    example: BIND_EXAMPLE
  },
  {
    code: "WD407",
    title: "Unknown `:bind` flag",
    cause: "The bare flag is not `required` or `autofocus`.",
    fix: "Use a supported flag.",
    example: BIND_EXAMPLE
  },
  {
    code: "WD408",
    title: "Unknown `:bind` attribute",
    cause: "The attribute is outside the supported set.",
    fix: "Use `placeholder`, `type`, `autocomplete`, or an `aria-*` attribute.",
    example: BIND_EXAMPLE
  },
  {
    code: "WD409",
    title: "Malformed `:slider`",
    cause: "The line does not start with the slider's state name.",
    fix: "Name the state, then optionally seed it and set the range.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD410",
    title: "Malformed `:slider` initial value",
    cause: "The `=` is present but no value follows it.",
    fix: "Give the slider a numeric initial value.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD411",
    title: "Unknown `:slider` attribute",
    cause: "The attribute is not `min`, `max`, `step`, or `aria-label`.",
    fix: "Use a supported attribute.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD412",
    title: "Non-numeric `:slider` bound",
    cause: "`min`, `max`, or `step` is not a number.",
    fix: "Give every bound a numeric value.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD413",
    title: "Non-numeric `:slider` initial value",
    cause: "A slider is bound to a number, so its seed must be numeric.",
    fix: "Seed the slider with a number.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD414",
    title: "`:slider persist` without an inline value",
    cause: "`persist` belongs to the declaration, and this slider binds existing state.",
    fix: "Declare the value inline to persist it, or persist it on the `:state` line.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD415",
    title: "`:slider` has no matching state",
    cause: "The slider binds a name that is not declared state.",
    fix: "Declare the state, or seed it inline on the slider.",
    example: SLIDER_EXAMPLE
  },
  {
    code: "WD416",
    title: "Malformed `:submit`",
    cause: 'The line does not read `:submit "Label"`.',
    fix: "Quote the button label.",
    example: SUBMIT_EXAMPLE
  },
  {
    code: "WD417",
    title: "Malformed `:textarea`",
    cause: "The line does not start with a field name.",
    fix: "Name the field, then add optional attributes and flags.",
    example: TEXTAREA_EXAMPLE
  },
  {
    code: "WD418",
    title: "Unknown `:textarea` flag",
    cause: "The bare flag is not one of `required`/`autofocus`/`disabled`/`readonly`.",
    fix: "Use a supported flag.",
    example: TEXTAREA_EXAMPLE
  },
  {
    code: "WD419",
    title: "Unknown `:textarea` attribute",
    cause: "The attribute is outside the supported set.",
    fix: "Use a supported attribute such as `placeholder`, `rows`, or `maxlength`.",
    example: TEXTAREA_EXAMPLE
  },
  {
    code: "WD420",
    title: "Malformed `:select`",
    cause: "The line does not start with a field name.",
    fix: "Name the field, then list the options as `- Label` lines.",
    example: SELECT_EXAMPLE
  },
  {
    code: "WD421",
    title: "Unknown `:select` flag",
    cause: "The bare flag is not `required`, `disabled`, or `autofocus`.",
    fix: "Use a supported flag.",
    example: SELECT_EXAMPLE
  },
  {
    code: "WD422",
    title: "Unknown `:select` attribute",
    cause: "The attribute is not `autocomplete` or an `aria-*` attribute.",
    fix: "Use a supported attribute.",
    example: SELECT_EXAMPLE
  },
  {
    code: "WD423",
    title: "`:select` has no options",
    cause: "No `- Label` lines follow the opener.",
    fix: "Add one `- Label` line per option directly beneath it.",
    example: SELECT_EXAMPLE
  },
  {
    code: "WD424",
    title: "Malformed `:checkbox`/`:radio`",
    cause: "The line does not start with a group name.",
    fix: "Name the group, then list the options as `- Label` lines.",
    example: CHECKBOX_EXAMPLE
  },
  {
    code: "WD425",
    title: "Unknown `:checkbox`/`:radio` flag",
    cause: "The bare flag is not `required`, `disabled`, or `autofocus`.",
    fix: "Use a supported flag.",
    example: CHECKBOX_EXAMPLE
  },
  {
    code: "WD426",
    title: "Unknown `:checkbox`/`:radio` attribute",
    cause: "The attribute is not `aria-label` or `aria-describedby`.",
    fix: "Use a supported attribute.",
    example: CHECKBOX_EXAMPLE
  },
  {
    code: "WD427",
    title: "`:checkbox`/`:radio` has no options",
    cause: "No `- Label` lines follow the opener.",
    fix: "Add one `- Label` line per option directly beneath it.",
    example: RADIO_EXAMPLE
  },

  {
    code: "WD450",
    title: "Bound field with no state",
    cause:
      "A `:select`/`:radio`/`:checkbox` outside a `:form` names state that is not declared, so there is nothing for it to bind to.",
    fix: "Declare the state first, or move the field inside a `:form`, where the name is a form field instead.",
    example: SELECT_EXAMPLE
  },
  {
    code: "WD451",
    title: "Bound `:checkbox` with several options",
    cause:
      "A `:checkbox` bound to state carries one true/false, so a list of options has no meaning.",
    fix: "Give it one `- Label` line, or use a `:radio` group for a set of choices.",
    example: CHECKBOX_EXAMPLE
  },

  {
    code: "WD452",
    title: "File field in a GET form",
    cause:
      'A `:form` contains an `<input type=file>` and declares `method="get"`. A GET request has no body, so only the file\'s name would travel.',
    fix: 'Drop `method="get"` — a `:form` posts by default, and a form with a file field is submitted as multipart.',
    example: FORM_EXAMPLE
  },

  // --- WD5xx: data fetching and URL safety ---------------------------------
  {
    code: "WD501",
    title: "Malformed `:fetch`",
    cause: 'The line does not read `:fetch name from "url" [options]`.',
    fix: "Name the state key and quote the URL, then add keyword options.",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD502",
    title: "Unknown `:fetch` option",
    cause: "An option is not a `name=value` pair from the supported set.",
    fix: "Use `method`, `when`, `timeout`, `retry`, `headers`, `body`, or `refresh`.",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD503",
    title: "Unsupported `:fetch` method",
    cause: "The method is outside `GET`/`POST`/`PUT`/`PATCH`/`DELETE`.",
    fix: "Use one of the supported HTTP methods.",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD504",
    title: "Unsupported `:fetch when`",
    cause: "`when` is neither `load` nor `visible`.",
    fix: "Fetch on `load` (the default) or when the marker becomes `visible`.",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD505",
    title: "Non-integer `:fetch timeout`/`retry`",
    cause: "The value is not a non-negative integer.",
    fix: "Pass whole numbers (milliseconds for `timeout`, attempts for `retry`).",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD506",
    title: "`:fetch refresh=` without `headers=`",
    cause: "A token refresh has nowhere to write the renewed token back to.",
    fix: "Add `headers=<stateKey>` alongside `refresh=`.",
    example: FETCH_EXAMPLE
  },
  {
    code: "WD507",
    title: "Unsafe URL",
    cause: "The URL is empty, padded with whitespace, or contains control characters.",
    fix: "Use a clean relative path, an http(s) URL, or a `{ state }` interpolation."
  },
  {
    code: "WD508",
    title: "Protocol-relative URL",
    cause: "A `//host` URL inherits whatever scheme the page was served over.",
    fix: "Write `http://` or `https://` explicitly."
  },
  {
    code: "WD509",
    title: "Disallowed URL scheme",
    cause: "The scheme is not `http` or `https` (`javascript:`, `data:`, `file:`, and friends).",
    fix: "Use http(s) or a relative path."
  },

  // --- WD6xx: includes and page structure ----------------------------------
  {
    code: "WD601",
    title: "Include outside the source sandbox",
    cause: "The include path escapes `site/pages` and `site/_`.",
    fix: "Move the partial inside the sandbox and reference it from there.",
    example: INCLUDE_EXAMPLE
  },
  {
    code: "WD602",
    title: "Include not found",
    cause: "No file matched the spec in `site/pages` or `site/_`.",
    fix: "Check the path, the extension, and the leading slash.",
    example: INCLUDE_EXAMPLE
  },
  {
    code: "WD603",
    title: "Malformed `@include`",
    cause: 'The line does not read `@include /partial.wd [with key="value"]`.',
    fix: "Give one target path, then optional `with` arguments.",
    example: INCLUDE_EXAMPLE
  },
  {
    code: "WD604",
    title: "Include argument is not in scope",
    cause: "A `with key={ value }` argument references a name that does not resolve.",
    fix: "Pass a literal, or reference a value that is in scope at the include site.",
    example: INCLUDE_EXAMPLE
  },
  {
    code: "WD605",
    title: "Unexpected token in a container header",
    cause: "The header holds something that is not a name, `.class`, or `#id`.",
    fix: "Use a leading name, then `.class`/`#id` tokens.",
    example: CONTAINER_EXAMPLE
  },
  {
    code: "WD606",
    title: "Malformed `:carousel`",
    cause: "The opener carries something other than `autoplay=<ms>`.",
    fix: "Open it bare, or with a numeric `autoplay`.",
    example: CAROUSEL_EXAMPLE
  },
  {
    code: "WD607",
    title: "Loop variable in `:if` outside a loop",
    cause: "`:if $first` (or another row variable) appears outside a `@loop` body.",
    fix: "Move the conditional into the loop body."
  },
  {
    code: "WD608",
    title: "`:if` name is not declared",
    cause: "The condition names neither a `:state` nor an in-scope value.",
    fix: "Declare the state first, or reference a value that is in scope.",
    example: IF_EXAMPLE
  },
  {
    code: "WD609",
    title: "Malformed `:if`",
    cause: "The `:if` line carries no condition.",
    fix: "Give a name, or a comparison joined with `and`/`or`/`not`.",
    example: IF_EXAMPLE
  },
  {
    code: "WD610",
    title: "Unsafe `:try` href",
    cause: "The href has control characters, or a scheme outside http/https/mailto.",
    fix: "Use a relative URL, or an `http:`, `https:`, or `mailto:` URL."
  },
  {
    code: "WD611",
    title: "Protocol-relative `:try` href",
    cause: "A `//host` href inherits whatever scheme the page was served over.",
    fix: "Write `http:` or `https:` explicitly."
  },
  {
    code: "WD612",
    title: "Include cycle",
    cause:
      "An `@include` chain reaches a file that is already being compiled, so the compile would never terminate.",
    fix: "Break the loop: remove the `@include` that points back, or move the shared content into a third file both sides include."
  },
  {
    code: "WD650",
    title: "Attribute is not on the accessibility whitelist",
    cause:
      "A `::: ` container header or a `:button` carries an attribute outside the accessibility whitelist (`onclick=`, `style=`, `href=`, `class=`, `data-…=`).",
    fix: 'Keep only `role="…"`, `aria-…="…"`, and `title="…"`; style with `.class` tokens and act with `->` actions.',
    example: CONTAINER_A11Y_EXAMPLE
  },
  {
    code: "WD651",
    title: "Accessibility attribute has no quoted value",
    cause: "An attribute in a container header or a `:button` is missing its double-quoted value.",
    fix: 'Write the value in double quotes, e.g. `role="region"`.',
    example: CONTAINER_A11Y_EXAMPLE
  },

  // --- WD7xx: media and embeds ---------------------------------------------
  {
    code: "WD701",
    title: "Malformed `:video`/`:audio`",
    cause: "The line carries no clip source.",
    fix: "Give the clip path, then optional attributes and flags.",
    example: VIDEO_EXAMPLE
  },
  {
    code: "WD702",
    title: "Unknown `:video`/`:audio` flag",
    cause: "The bare flag is outside the supported set for that element.",
    fix: "Use `controls`, `autoplay`, `loop`, `muted`, or (video only) `playsinline`.",
    example: VIDEO_EXAMPLE
  },
  {
    code: "WD703",
    title: "Unknown `:video`/`:audio` attribute",
    cause: "The attribute is outside the supported set for that element.",
    fix: "Use `poster`, `width`, `height`, or `preload` (audio takes `preload` only).",
    example: VIDEO_EXAMPLE
  },
  {
    code: "WD704",
    title: "Malformed `:embed`",
    cause: "The line carries no URL.",
    fix: "Give the share or watch URL, then an optional title.",
    example: EMBED_EXAMPLE
  },
  {
    code: "WD705",
    title: "Unknown `:embed` attribute",
    cause: "`title` is the only supported attribute.",
    fix: "Remove the attribute, or set the accessible title.",
    example: EMBED_EXAMPLE
  },

  // --- WD8xx: skins ---------------------------------------------------------
  {
    code: "WD801",
    title: "`scoped` is not the first line",
    cause: "The scoping opt-in appears somewhere other than the first meaningful line.",
    fix: "Move `scoped` to the top of the `.skin`, or delete it."
  },
  {
    code: "WD802",
    title: "Page-level declaration in a scoped skin",
    cause: "A declaration with no enclosing selector would write to the whole page.",
    fix: "Nest it under a selector, or move it to a global skin."
  },
  {
    code: "WD803",
    title: "Page-level selector in a scoped skin",
    cause: "A top-level `page`/`body`/`html`/`*`/`::selection` selector escapes the scope.",
    fix: "Move page-level styles to a global (non-scoped) skin."
  },

  // --- WD9xx: project, routing, CLI ----------------------------------------
  {
    code: "WD901",
    title: "Duplicate route",
    cause: "Two source files map to the same public route (often `.md` plus `.wd`).",
    fix: "Rename or delete one of the files."
  },
  {
    code: "WD902",
    title: "Route escapes the build output",
    cause: "A route resolved outside `dist`, which would write outside the build.",
    fix: "Remove traversal segments from the route."
  },
  {
    code: "WD903",
    title: "Unknown init template",
    cause: "`darkmown init --template` names a template that does not ship.",
    fix: "Pick a bundled template; the message lists every available name."
  },
  {
    code: "WD904",
    title: "Unknown deploy target",
    cause: "`darkmown deploy` names a platform Darkmown does not drive.",
    fix: "Deploy to `vercel` or `cloudflare`."
  },
  {
    code: "WD905",
    title: "Deploy CLI not signed in",
    cause: "The platform CLI rejected the deploy with an authentication failure.",
    fix: "Run the platform login command, then re-run the deploy."
  },
  {
    code: "WD906",
    title: "Deploy command failed",
    cause: "The platform CLI exited non-zero for a reason other than authentication.",
    fix: "Read the CLI output above the error, fix the cause, and re-run."
  },
  {
    code: "WD907",
    title: "Unknown `ai_crawlers` policy",
    cause: "The home page's `ai_crawlers:` is neither `allow` nor `deny`.",
    fix: "Write `ai_crawlers: allow` or `ai_crawlers: deny` (absent means allow)."
  },
  {
    code: "WD950",
    title: "Invalid `rss_limit`",
    cause: "The home page's `rss_limit:` is not a positive whole number of items.",
    fix: "Write `rss_limit: 20` (absent means 20)."
  }
];

/**
 * The subsystem an error belongs to, derived from its code so the `area` can
 * never disagree with the number.
 * @param {string} code
 * @returns {string}
 */
function areaOf(code) {
  const block = Number(code[2]);
  const area = ERROR_AREAS.find((a) => a.block === block);
  return area ? area.name : "unknown";
}

/**
 * The full error-code registry, in code order. Each entry carries the stable
 * code, its subsystem, a short title, what causes it, and how to fix it.
 * @returns {ErrorEntry[]}
 */
export function errorCatalog() {
  return ENTRIES.map((entry) => ({ ...entry, area: areaOf(entry.code) }));
}

/**
 * Look up one code, or undefined when it is not registered.
 * @param {string} code
 * @returns {ErrorEntry | undefined}
 */
export function errorForCode(code) {
  return errorCatalog().find((entry) => entry.code === code);
}

/**
 * Render `docs/errors.md` from the registry. Generated, never hand-edited, so
 * the reference page cannot drift from the codes the compiler actually throws
 * (`scripts/gen-errors.mjs` writes it; tests/error-codes.test.js re-checks it).
 * @returns {string}
 */
export function errorsMarkdown() {
  const entries = errorCatalog();
  const out = [];
  out.push("# Darkmown compile error codes");
  out.push("");
  out.push(
    "Every Darkmown compile error carries a stable `WDxxx` code. It is the first",
    "thing in the message (`[WD201] Malformed :state in …`) and it is mirrored on",
    "the thrown error as `err.wd.code`, alongside `file`, `line`, `hint`, and a",
    "concrete compilable `example`."
  );
  out.push("");
  out.push("```");
  out.push("[WD201] Malformed :state in site/pages/index.wd:1: :state x.");
  out.push("        Use: :state name = value [persist|ephemeral] — e.g. :state count = 0");
  out.push("```");
  out.push("");
  out.push(
    "Codes are grouped by subsystem, and a shipped code is permanent: it is never",
    "renumbered and a retired number is never reused. Add new errors at the next",
    "free number in their block."
  );
  out.push("");
  out.push("| Range | Subsystem |");
  out.push("| --- | --- |");
  for (const area of ERROR_AREAS) out.push(`| \`${area.range}\` | ${area.title} |`);
  out.push("");
  out.push(
    "> This page is generated from `src/errors.js` by `node scripts/gen-errors.mjs`.",
    "> Edit the registry, not this file."
  );
  out.push("");

  for (const area of ERROR_AREAS) {
    const rows = entries.filter((entry) => entry.area === area.name);
    if (!rows.length) continue;
    out.push(`## ${area.range} — ${area.title}`);
    out.push("");
    out.push("| Code | Error | Cause | Fix | Example |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const row of rows) {
      const example = row.example ? `\`${escapeCell(row.example)}\`` : "";
      out.push(
        `| \`${row.code}\` | ${escapeCell(row.title)} | ${escapeCell(row.cause)} | ${escapeCell(row.fix)} | ${example} |`
      );
    }
    out.push("");
  }

  out.push("## Errors without a code");
  out.push("");
  out.push(
    "A handful of throws are framework invariants rather than authoring mistakes:",
    "the expression re-parser (`src/compiler/expr-ast.js`) consumes the compiler's",
    "own already-validated output, and the source reader (`src/compiler/reader.js`)",
    "guards the host contract behind `compileFromMemory`. Hitting one of those is a",
    "bug in Darkmown, not something a page can fix, so they stay uncoded and should",
    "be reported as issues."
  );
  out.push("");
  return out.join("\n");
}

/**
 * Escape a value for a markdown table cell (pipes would split the row).
 * @param {string} value
 * @returns {string}
 */
function escapeCell(value) {
  return value.replaceAll("|", "\\|");
}
