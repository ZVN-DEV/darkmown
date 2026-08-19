# Darkmown compile error codes

Every Darkmown compile error carries a stable `WDxxx` code. It is the first
thing in the message (`[WD201] Malformed :state in …`) and it is mirrored on
the thrown error as `err.wd.code`, alongside `file`, `line`, `hint`, and a
concrete compilable `example`.

```
[WD201] Malformed :state in site/pages/index.wd:1: :state x.
        Use: :state name = value [persist|ephemeral] — e.g. :state count = 0
```

Codes are grouped by subsystem, and a shipped code is permanent: it is never
renumbered and a retired number is never reused. Add new errors at the next
free number in their block.

| Range | Subsystem |
| --- | --- |
| `WD0xx` | Source, frontmatter & block structure |
| `WD1xx` | Loops & collections |
| `WD2xx` | State & expressions |
| `WD3xx` | Button, effect & timer actions |
| `WD4xx` | Forms & form fields |
| `WD5xx` | Data fetching & URL safety |
| `WD6xx` | Includes & page structure |
| `WD7xx` | Media & embeds |
| `WD8xx` | Skins & styling |
| `WD9xx` | Project, routing & CLI |

> This page is generated from `src/errors.js` by `node scripts/gen-errors.mjs`.
> Edit the registry, not this file.

## WD0xx — Source, frontmatter & block structure

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD001` | Unterminated frontmatter | The file opens with `---` but never closes the block. | Add a closing `---` on its own line before the page body. |  |
| `WD002` | Disallowed path segment | A dotted path contains `constructor`, `prototype`, or `__proto__`. | Read a different path; those segments are rejected everywhere for safety. |  |
| `WD003` | Cannot interpolate an object value | `{ name }` resolved to an object, which has no sensible text form. | Interpolate one of its fields (`{ name.title }`) or iterate it with `@loop`. |  |
| `WD004` | Unbalanced JSON value | A `:state`/`:store`/`:theme` value opens `[` or `{` and never closes it. | Balance the literal (no blank lines inside it), or quote it as text. | `:state count = 0` |
| `WD005` | Loop variable used outside a loop | `{ $index }` (or another `$` row variable) appears outside a `@loop` body. | Move the interpolation into a loop body, or rename your value. |  |
| `WD006` | Unknown format pipe | `{ value \| name }` names a formatter that is not in the fixed whitelist. | Use one of the catalogued pipes; the message lists every available name. |  |
| `WD007` | Stray `:::` close | A bare `:::` line appears with no container open. | Open the container first, or delete the stray closer. | `::: card .featured` |
| `WD008` | Retired `@repeat` directive | `@repeat` was replaced by the single `@loop` directive. | Rewrite the block as `@loop … into … @endloop`. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD009` | Retired `:for` directive | `:for` was replaced by the single `@loop` directive. | Rewrite the block as `@loop … into … @endloop`. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD010` | Stray block closer | An `@endloop`/`:endif`/`:endform`/`:else` line has no matching opener. | Open the matching block, or delete the stray closer. |  |
| `WD011` | Missing block closer | A `@loop`/`:form`/`:carousel` block runs to the end of the file unclosed. | Close the block with its own closing token. |  |
| `WD012` | Missing closing `:::` | A `::: container` block is never closed. | Add a bare `:::` line to close the container. | `::: card .featured` |
| `WD013` | `:else if` after `:else` | A conditional continues with `:else if` after a bare `:else` already closed it. | Order every `:else if` before the bare `:else`. |  |
| `WD014` | Duplicate `:else` | A conditional has more than one bare `:else` branch. | Keep one `:else`; turn the others into `:else if` branches. |  |
| `WD015` | Missing `:endif` | An `:if` region is never closed. | Close the region with `:endif`. | `:if count > 0` |
| `WD016` | Unknown structured-data type | Frontmatter `schema:` names a type outside the supported whitelist. | Use one of the listed schema.org types; the message names every one. |  |

## WD1xx — Loops & collections

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD101` | Malformed `@loop` header | The header does not read `@loop <source> into <item>`. | Name a source and an item variable, then any clauses in the fixed order. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD102` | Malformed `@loop` clause | A clause is misspelled or written out of the fixed order. | Order clauses `where`, `sort by`, `reverse`, `offset`, `limit`, `paginate`, `sortable`. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD103` | Unknown `sort by { state }` key | A reactive sort key references a `:state`/`:store` that is not declared. | Declare the state first, or sort by a literal item field. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD104` | Sort key is not a loop-item field | `sort by` names something other than the loop item. | Sort by `<item>.field`, using the item name from the `into` clause. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD105` | Disallowed sort key path | The sort key contains `constructor`, `prototype`, or `__proto__`. | Sort by an ordinary data field. |  |
| `WD106` | Unknown sort direction state | A reactive `{ direction }` references a `:state`/`:store` that is not declared. | Declare the state first, or use the literal `asc`/`desc`. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD107` | Invalid `offset`/`limit` argument | The argument is neither a non-negative integer nor a declared `:state`. | Pass an integer literal or a declared state key. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD108` | `sortable` combined with other clauses | `sortable` reorders the underlying list, so a derived view would desynchronise. | Drop `where`/`sort`/`reverse`/`offset`/`limit`/`paginate` from a sortable loop. |  |
| `WD109` | `paginate` combined with `offset`/`limit` | `paginate` already slices each page, so an explicit slice conflicts with it. | Keep `paginate N` and remove `offset`/`limit`. |  |
| `WD110` | `paginate` on a non-collection source | Pagination multiplies static routes, which only makes sense for a collection. | Paginate a collection (a `site/pages/<name>/` subdirectory) by its bare name. |  |
| `WD111` | Loop data file is not a JSON array | The `.json` source parses to an object or a scalar. | Make the file a top-level JSON array of rows. |  |
| `WD112` | In-scope loop source is not a list | The name resolved to a scalar or object value in scope. | Point the loop at a list, or omit the field to render the `@empty` branch. |  |
| `WD113` | Disallowed `@loop` source path | The source path contains `constructor`, `prototype`, or `__proto__`. | Loop an ordinary collection, JSON file, scope value, or state list. |  |
| `WD114` | `sortable` on a nested loop | An item-relative loop has no top-level state list to reorder. | Make the sortable loop read a top-level `:state`/`:store` list. |  |
| `WD115` | Unresolved `@loop` source | The source is not a collection, JSON file, in-scope value, or declared state. | Check the name; the message lists the available collections. | `@loop /products.json into p where p.price < 50 sort by p.price asc` |
| `WD116` | Reactive loop nested too deep | A third reactive `@loop` level would paint empty at runtime. | Unroll the outer data at build time, or move the innermost list into build data. |  |
| `WD117` | `sortable` needs a state list | `sortable` was used on a JSON file or in-scope value, which cannot be reordered. | Reorder a `:state`/`:store` list instead. |  |
| `WD120` | Malformed `_schema.wd` line | A schema line does not read `field: type`. | Write one `field: type` rule per line inside the `---` block. |  |
| `WD121` | Unknown `_schema.wd` type | The type is outside the closed vocabulary. | Use `string`, `number`, `boolean`, `date`, or `string[]`, with `?` for optional. |  |
| `WD122` | Undeclared frontmatter field | A collection entry has a field the schema does not declare (often a typo). | Add the field to `_schema.wd`, or remove it from the entry. |  |
| `WD123` | Missing required frontmatter field | A collection entry omits a field the schema requires. | Add the field to the entry, or mark it optional with `?` in the schema. |  |
| `WD124` | Frontmatter field has the wrong type | An entry's value does not match its schema type. | Fix the entry's value, or widen the type in `_schema.wd`. |  |

## WD2xx — State & expressions

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD201` | Malformed `:state` | The line does not read `:state name = value [persist\|ephemeral]`. | Give the state a name and an initial value. | `:state count = 0` |
| `WD202` | `:state` inside a reactive loop | State cannot be declared per row; a loop body has no place to hold it. | Declare the state outside the loop. |  |
| `WD203` | `:state` collides with a `:store` | A page-global store already owns that name. | Rename one of them, or use the store everywhere. | `:store cart = []` |
| `WD204` | `:state` declared twice | The same name is declared twice in one section scope. | Remove the duplicate, or scope one declaration to its own `::: section`. |  |
| `WD205` | Malformed `:store` | The line does not read `:store name = value [persist\|ephemeral]`. | Give the store a name and an initial value. | `:store cart = []` |
| `WD206` | `:store` declared twice | Stores are page-global, so a second declaration is ambiguous. | Declare the store once and reference it everywhere else. | `:store cart = []` |
| `WD207` | `:store` collides with a `:state` | A `:state` of the same name is already declared on the page. | Rename one of them, or use the store everywhere. | `:store cart = []` |
| `WD208` | Malformed `:computed` | The line does not read `:computed name = <expression>`. | Give the computed value a name and a right-hand expression. | `:computed total = items.length * 4` |
| `WD209` | Malformed `:computed` expression | The right-hand side passes the character whitelist but is not a real expression. | Write a complete expression over declared state, numbers, and operators. | `:computed total = items.length * 4` |
| `WD210` | Malformed `:theme` | The line does not read `:theme [name] [= "auto"]`. | Use a bare `:theme`, or name the store and seed it. | `:theme` |
| `WD211` | Persistence token on `:computed` | The expression ends in a bare `persist` or `ephemeral`, which is swallowed into it. | Computed values are derived, not stored. Persist the state they derive from instead. | `:computed total = items.length * 4` |
| `WD220` | Malformed `where` condition | A `where` condition is not `operand <op> operand`. | Compare a loop-item field with a value using a whitelisted operator. |  |
| `WD221` | Unsupported `where` operand | An operand is not an item field, a state name, a number, or a quoted string. | Use one of those four operand forms. |  |
| `WD222` | Disallowed `where` path | An operand path contains `constructor`, `prototype`, or `__proto__`. | Compare an ordinary data field. |  |
| `WD223` | Unknown name in `where` | An operand names neither the loop item nor a declared `:state`. | Use the loop item's field, or declare the state first. |  |
| `WD224` | Unsupported `when`/`:if` operand | An operand is not an item field, a state name, a number, or a quoted string. | Use one of those four operand forms. | `:if count > 0` |
| `WD225` | Disallowed `when`/`:if` path | An operand path contains `constructor`, `prototype`, or `__proto__`. | Compare an ordinary data field. |  |
| `WD226` | Unknown name in `when`/`:if` | An operand names nothing in scope: no loop item, no scope value, no state. | Declare the state first, or reference a value that is in scope. | `:if count > 0` |
| `WD227` | Disallowed aggregate path | A `sum`/`avg`/`min`/`max`/`count` argument contains a prototype-poisoning segment. | Aggregate an ordinary state list. |  |
| `WD228` | Unknown state in a `:computed` aggregate | The aggregated list is not a declared `:state`/`:store`/`:fetch` key. | Declare the list first. | `:computed total = items.length * 4` |
| `WD229` | Unsupported string syntax in `:computed` | The expression contains a quote, backslash, or backtick outside a simple literal. | Use plain double- or single-quoted string literals. |  |
| `WD230` | Unsupported syntax in `:computed` | The expression contains characters outside the closed whitelist. | Use state names, numbers, strings, arithmetic, comparisons, and `&& \|\| !`. | `:computed total = items.length * 4` |
| `WD231` | Assignment in `:computed` | A `:computed` expression derives a value; it may not assign one. | Mutate state from a `:button`/`:effect` action instead. |  |
| `WD232` | Function call in `:computed` | Only the fixed `sum`/`avg`/`min`/`max`/`count` aggregates may look like calls. | Remove the call, or use one of the aggregates. |  |
| `WD233` | Disallowed `:computed` path segment | A referenced path contains `constructor`, `prototype`, or `__proto__`. | Read an ordinary state path. |  |
| `WD234` | Unknown state in `:computed` | The expression references a name that is not declared state. | Declare it with `:state`, `:store`, or `:fetch` first. | `:computed total = items.length * 4` |

## WD3xx — Button, effect & timer actions

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD301` | Malformed `:button` | The line does not read `:button "Label" -> action`. | Quote the label and give at least one action after the arrow. | `:button "Add one" -> count++` |
| `WD302` | Malformed `:effect` | The line does not read `:effect watchedState -> action`. | Name one state to watch and the actions to run when it changes. | `:effect query -> searches++` |
| `WD303` | `:effect` watches unknown state | The watched name is not a declared `:state`/`:store`. | Declare the state first. | `:effect query -> searches++` |
| `WD304` | Malformed `:every` | The line does not read `:every <duration> -> action`. | Give a duration and the actions to run on each tick. | `:every 5s -> seconds++` |
| `WD305` | Invalid `:every` duration | The duration is not a positive `<int>[ms\|s\|m]` value. | Use a duration like `500ms`, `5s`, or `2m`. | `:every 5s -> seconds++` |
| `WD306` | Action targets unknown state | The action mutates a name that is not declared state. | Declare the state first. | `:button "Add one" -> count++` |
| `WD307` | Row append needs a list state | `list += item` carries the current row into a target that is not a list. | Declare the target as a list, e.g. `:state cart = []`. |  |
| `WD308` | `+=` needs a number or a list | `+=` with a non-number value requires a list target to append to. | Add a number, or declare the target as a list. |  |
| `WD309` | Row remove inside a nested loop | An item-relative loop has no top-level list for the runtime to remove from. | Carry the row into a top-level list first, then remove it there. |  |
| `WD310` | Row remove targets the wrong list | Per-row `remove` must target the same list the loop is iterating. | Name the looped list, or remove a value instead of the current row. |  |
| `WD311` | Unsupported action | The expression is outside the fixed action vocabulary (no JavaScript is allowed). | Use a catalogued op; the message lists the whole vocabulary. | `count++` |
| `WD312` | `merge` operand is unknown state | The right-hand name of a `merge` is not declared state. | Declare it first, or pass an inline object literal. |  |
| `WD313` | Unsupported `merge` operand | The operand is neither a state key nor an inline object literal. | Merge a declared object state, or an inline `{…}` literal. |  |
| `WD314` | Unsupported action literal | The action value is not a quoted string, number, boolean, null, or valid JSON. | Quote strings and use valid JSON for arrays and objects. |  |

## WD4xx — Forms & form fields

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD401` | Malformed `:form` | The opener has neither `into <name>` nor `action="…"`, or has leftover text. | Capture into state, post to a URL, or do both for a fetch round-trip. | `:form into contact` |
| `WD402` | Malformed `:input` | The line does not start with a field name. | Name the field, then add optional attributes and flags. | `:input email type=email required` |
| `WD403` | Unknown `:input` flag | The bare flag is not one of `required`/`autofocus`/`disabled`/`readonly`. | Use a supported flag, or write it as `name=value`. | `:input email type=email required` |
| `WD404` | Unknown `:input` attribute | The attribute is outside the supported set. | Use a supported attribute; the compiler emits no arbitrary HTML attributes. | `:input email type=email required` |
| `WD405` | Malformed `:bind` | The line does not start with the bound state name. | Name a declared `:state`, then add optional attributes. | `:bind query placeholder="Search"` |
| `WD406` | `:bind` has no matching state | The bound name is not a declared `:state`/`:store`. | Declare the state before binding to it. | `:bind query placeholder="Search"` |
| `WD407` | Unknown `:bind` flag | The bare flag is not `required` or `autofocus`. | Use a supported flag. | `:bind query placeholder="Search"` |
| `WD408` | Unknown `:bind` attribute | The attribute is outside the supported set. | Use `placeholder`, `type`, `autocomplete`, or an `aria-*` attribute. | `:bind query placeholder="Search"` |
| `WD409` | Malformed `:slider` | The line does not start with the slider's state name. | Name the state, then optionally seed it and set the range. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD410` | Malformed `:slider` initial value | The `=` is present but no value follows it. | Give the slider a numeric initial value. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD411` | Unknown `:slider` attribute | The attribute is not `min`, `max`, `step`, or `aria-label`. | Use a supported attribute. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD412` | Non-numeric `:slider` bound | `min`, `max`, or `step` is not a number. | Give every bound a numeric value. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD413` | Non-numeric `:slider` initial value | A slider is bound to a number, so its seed must be numeric. | Seed the slider with a number. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD414` | `:slider persist` without an inline value | `persist` belongs to the declaration, and this slider binds existing state. | Declare the value inline to persist it, or persist it on the `:state` line. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD415` | `:slider` has no matching state | The slider binds a name that is not declared state. | Declare the state, or seed it inline on the slider. | `:slider volume = 50 min=0 max=100 step=1` |
| `WD416` | Malformed `:submit` | The line does not read `:submit "Label"`. | Quote the button label. | `:submit "Send"` |
| `WD417` | Malformed `:textarea` | The line does not start with a field name. | Name the field, then add optional attributes and flags. | `:textarea message placeholder="Your message" rows=4` |
| `WD418` | Unknown `:textarea` flag | The bare flag is not one of `required`/`autofocus`/`disabled`/`readonly`. | Use a supported flag. | `:textarea message placeholder="Your message" rows=4` |
| `WD419` | Unknown `:textarea` attribute | The attribute is outside the supported set. | Use a supported attribute such as `placeholder`, `rows`, or `maxlength`. | `:textarea message placeholder="Your message" rows=4` |
| `WD420` | Malformed `:select` | The line does not start with a field name. | Name the field, then list the options as `- Label` lines. | `:select topic` |
| `WD421` | Unknown `:select` flag | The bare flag is not `required`, `disabled`, or `autofocus`. | Use a supported flag. | `:select topic` |
| `WD422` | Unknown `:select` attribute | The attribute is not `autocomplete` or an `aria-*` attribute. | Use a supported attribute. | `:select topic` |
| `WD423` | `:select` has no options | No `- Label` lines follow the opener. | Add one `- Label` line per option directly beneath it. | `:select topic` |
| `WD424` | Malformed `:checkbox`/`:radio` | The line does not start with a group name. | Name the group, then list the options as `- Label` lines. | `:checkbox toppings` |
| `WD425` | Unknown `:checkbox`/`:radio` flag | The bare flag is not `required`, `disabled`, or `autofocus`. | Use a supported flag. | `:checkbox toppings` |
| `WD426` | Unknown `:checkbox`/`:radio` attribute | The attribute is not `aria-label` or `aria-describedby`. | Use a supported attribute. | `:checkbox toppings` |
| `WD427` | `:checkbox`/`:radio` has no options | No `- Label` lines follow the opener. | Add one `- Label` line per option directly beneath it. | `:radio size` |

## WD5xx — Data fetching & URL safety

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD501` | Malformed `:fetch` | The line does not read `:fetch name from "url" [options]`. | Name the state key and quote the URL, then add keyword options. | `:fetch todos from "/api/todos.json" when=visible` |
| `WD502` | Unknown `:fetch` option | An option is not a `name=value` pair from the supported set. | Use `method`, `when`, `timeout`, `retry`, `headers`, `body`, or `refresh`. | `:fetch todos from "/api/todos.json" when=visible` |
| `WD503` | Unsupported `:fetch` method | The method is outside `GET`/`POST`/`PUT`/`PATCH`/`DELETE`. | Use one of the supported HTTP methods. | `:fetch todos from "/api/todos.json" when=visible` |
| `WD504` | Unsupported `:fetch when` | `when` is neither `load` nor `visible`. | Fetch on `load` (the default) or when the marker becomes `visible`. | `:fetch todos from "/api/todos.json" when=visible` |
| `WD505` | Non-integer `:fetch timeout`/`retry` | The value is not a non-negative integer. | Pass whole numbers (milliseconds for `timeout`, attempts for `retry`). | `:fetch todos from "/api/todos.json" when=visible` |
| `WD506` | `:fetch refresh=` without `headers=` | A token refresh has nowhere to write the renewed token back to. | Add `headers=<stateKey>` alongside `refresh=`. | `:fetch todos from "/api/todos.json" when=visible` |
| `WD507` | Unsafe URL | The URL is empty, padded with whitespace, or contains control characters. | Use a clean relative path, an http(s) URL, or a `{ state }` interpolation. |  |
| `WD508` | Protocol-relative URL | A `//host` URL inherits whatever scheme the page was served over. | Write `http://` or `https://` explicitly. |  |
| `WD509` | Disallowed URL scheme | The scheme is not `http` or `https` (`javascript:`, `data:`, `file:`, and friends). | Use http(s) or a relative path. |  |

## WD6xx — Includes & page structure

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD601` | Include outside the source sandbox | The include path escapes `site/pages` and `site/_`. | Move the partial inside the sandbox and reference it from there. | `@include /header.wd` |
| `WD602` | Include not found | No file matched the spec in `site/pages` or `site/_`. | Check the path, the extension, and the leading slash. | `@include /header.wd` |
| `WD603` | Malformed `@include` | The line does not read `@include /partial.wd [with key="value"]`. | Give one target path, then optional `with` arguments. | `@include /header.wd` |
| `WD604` | Include argument is not in scope | A `with key={ value }` argument references a name that does not resolve. | Pass a literal, or reference a value that is in scope at the include site. | `@include /header.wd` |
| `WD605` | Unexpected token in a container header | The header holds something that is not a name, `.class`, or `#id`. | Use a leading name, then `.class`/`#id` tokens. | `::: card .featured` |
| `WD606` | Malformed `:carousel` | The opener carries something other than `autoplay=<ms>`. | Open it bare, or with a numeric `autoplay`. | `:carousel autoplay=3000` |
| `WD607` | Loop variable in `:if` outside a loop | `:if $first` (or another row variable) appears outside a `@loop` body. | Move the conditional into the loop body. |  |
| `WD608` | `:if` name is not declared | The condition names neither a `:state` nor an in-scope value. | Declare the state first, or reference a value that is in scope. | `:if count > 0` |
| `WD609` | Malformed `:if` | The `:if` line carries no condition. | Give a name, or a comparison joined with `and`/`or`/`not`. | `:if count > 0` |
| `WD610` | Unsafe `:try` href | The href has control characters, or a scheme outside http/https/mailto. | Use a relative URL, or an `http:`, `https:`, or `mailto:` URL. |  |
| `WD611` | Protocol-relative `:try` href | A `//host` href inherits whatever scheme the page was served over. | Write `http:` or `https:` explicitly. |  |
| `WD612` | Include cycle | An `@include` chain reaches a file that is already being compiled, so the compile would never terminate. | Break the loop: remove the `@include` that points back, or move the shared content into a third file both sides include. |  |

## WD7xx — Media & embeds

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD701` | Malformed `:video`/`:audio` | The line carries no clip source. | Give the clip path, then optional attributes and flags. | `:video /demo.mp4 controls` |
| `WD702` | Unknown `:video`/`:audio` flag | The bare flag is outside the supported set for that element. | Use `controls`, `autoplay`, `loop`, `muted`, or (video only) `playsinline`. | `:video /demo.mp4 controls` |
| `WD703` | Unknown `:video`/`:audio` attribute | The attribute is outside the supported set for that element. | Use `poster`, `width`, `height`, or `preload` (audio takes `preload` only). | `:video /demo.mp4 controls` |
| `WD704` | Malformed `:embed` | The line carries no URL. | Give the share or watch URL, then an optional title. | `:embed https://youtu.be/dQw4w9WgXcQ title="Demo"` |
| `WD705` | Unknown `:embed` attribute | `title` is the only supported attribute. | Remove the attribute, or set the accessible title. | `:embed https://youtu.be/dQw4w9WgXcQ title="Demo"` |

## WD8xx — Skins & styling

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD801` | `scoped` is not the first line | The scoping opt-in appears somewhere other than the first meaningful line. | Move `scoped` to the top of the `.skin`, or delete it. |  |
| `WD802` | Page-level declaration in a scoped skin | A declaration with no enclosing selector would write to the whole page. | Nest it under a selector, or move it to a global skin. |  |
| `WD803` | Page-level selector in a scoped skin | A top-level `page`/`body`/`html`/`*`/`::selection` selector escapes the scope. | Move page-level styles to a global (non-scoped) skin. |  |

## WD9xx — Project, routing & CLI

| Code | Error | Cause | Fix | Example |
| --- | --- | --- | --- | --- |
| `WD901` | Duplicate route | Two source files map to the same public route (often `.md` plus `.wd`). | Rename or delete one of the files. |  |
| `WD902` | Route escapes the build output | A route resolved outside `dist`, which would write outside the build. | Remove traversal segments from the route. |  |
| `WD903` | Unknown init template | `darkmown init --template` names a template that does not ship. | Pick a bundled template; the message lists every available name. |  |
| `WD904` | Unknown deploy target | `darkmown deploy` names a platform Darkmown does not drive. | Deploy to `vercel` or `cloudflare`. |  |
| `WD905` | Deploy CLI not signed in | The platform CLI rejected the deploy with an authentication failure. | Run the platform login command, then re-run the deploy. |  |
| `WD906` | Deploy command failed | The platform CLI exited non-zero for a reason other than authentication. | Read the CLI output above the error, fix the cause, and re-run. |  |
| `WD907` | Unknown `ai_crawlers` policy | The home page's `ai_crawlers:` is neither `allow` nor `deny`. | Write `ai_crawlers: allow` or `ai_crawlers: deny` (absent means allow). |  |

## Errors without a code

A handful of throws are framework invariants rather than authoring mistakes:
the expression re-parser (`src/compiler/expr-ast.js`) consumes the compiler's
own already-validated output, and the source reader (`src/compiler/reader.js`)
guards the host contract behind `compileFromMemory`. Hitting one of those is a
bug in Darkmown, not something a page can fix, so they stay uncoded and should
be reported as issues.
