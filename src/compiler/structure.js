// ---------------------------------------------------------------------------
// Structure: the directives that shape a page's tree — `@include` (sub-file
// compile + scoped-skin stamp), `::: container` sections, `:if` conditional
// regions, the `:carousel` block — plus the documentation-demo directive
// `:try`. Nested block bodies recurse through
// `ctx.compileBody` (and `@include` through `ctx.compileFile`), threaded in by
// the per-file compile so the module graph stays an import-cycle-free DAG.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, createScope, LOOP_META, lineOf, nestedCtx, recordSymbol, wdError } from "./context.js";
import { resolveInclude, scopedSkinFor, stampScope } from "./includes.js";
import {
  escapeHtml,
  getPath,
  lookupPath,
  lookupVar,
  parseScalar,
  resolveStateKey
} from "./interpolation.js";
import { astAt, serializeExprAt } from "./loops.js";
import { compileWhen, evalPredicate } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Concrete, compilable structure examples for the hint tails + the catalog.
export const INCLUDE_EXAMPLE = "@include /header.wd";
export const CONTAINER_EXAMPLE = "::: card .featured";
// The same header carrying the accessibility attributes the whitelist allows —
// the WD650/WD651 hint tail, so a rejected attribute shows the accepted shape.
export const CONTAINER_A11Y_EXAMPLE = '::: card .note role="region" aria-label="Notes"';
export const IF_EXAMPLE = ":if count > 0";
export const CAROUSEL_EXAMPLE = ":carousel autoplay=3000";
const INCLUDE_USE = `Use: @include /partial.wd [with key="value"] — e.g. ${INCLUDE_EXAMPLE}`;

// Container names that emit their own semantic landmark element instead of a
// `<div>`, so scaffolds get real `<nav>`/`<main>` landmarks (accessibility: the
// skip link targets a genuine main-content region and navigation chrome sits in
// its own landmark). The name is still added as a class, so existing `.nav`/
// `.main` skin selectors keep working. Fixed compiler-owned constants — never
// author-supplied — so no tag-injection surface; classes/ids still escape.
const SEMANTIC_CONTAINER_TAGS = new Set(["nav", "main"]);

// ---------------------------------------------------------------------------
// The accessibility attribute whitelist, shared by `::: container` headers and
// `:button` lines.
//
// A disclosure widget, a tab list, a menu, or a semantic table needs `role` and
// `aria-*` on the elements the compiler emits, and until now neither directive
// accepted any attribute at all — so those patterns simply could not be built
// (audit 8.3). This opens exactly three shapes and nothing else:
//
//   role="…"       one ARIA role
//   aria-*="…"     any `aria-` attribute
//   title="…"      the native advisory title
//
// The value is STATIC quoted text; it is HTML-escaped on emit. There is no
// `{ state }` interpolation in an attribute value in this pass — a reactive
// `aria-expanded` would need a runtime attribute binding, which does not exist.
// Everything else (`onclick`, `style`, `href`, `class`, `data-*`, `id=`) is a
// compile error naming the whitelist, so the directive surface cannot quietly
// become "arbitrary HTML attributes".
// ---------------------------------------------------------------------------

/** The corrective `Use:` tail every attribute error carries. */
export const A11Y_ATTR_USE = 'role="…", aria-…="…", or title="…" (quoted static text)';

// `aria-` plus at least one lowercase letter; `role`/`title` exactly. Names are
// matched against this whitelist, so an emitted name can never carry markup.
const A11Y_ATTR_NAME = /^(?:role|title|aria-[a-z][a-z0-9-]*)$/;

// One `name="value"` pair at the cursor. The value cannot contain `"`, so the
// pair always ends where it looks like it ends.
const ATTR_PAIR = /^([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/;
// Anything that OPENS like an attribute, so a rejected one gets the whitelist
// error rather than the generic "unexpected token".
const ATTR_START = /^([A-Za-z][A-Za-z0-9-]*)\s*=/;

/**
 * Peel the leading run of whitelisted accessibility attributes off `rest`.
 *
 * Stops at the first token that does not open like an attribute (a `.class`, a
 * `#id`, a `->`, or the end of the line) and hands that remainder back. A token
 * that DOES open like an attribute but is misspelt, unquoted, or outside the
 * whitelist is a compile error — never silently skipped.
 * @param {string} rest Everything from the cursor to the end of the line.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {string} what Directive label for the message, e.g. `:button`.
 * @returns {{ attrs: [string, string][], rest: string }}
 */
export function takeA11yAttrs(rest, ctx, index, what) {
  /** @type {[string, string][]} */
  const attrs = [];
  let s = rest.trim();
  for (let start = s.match(ATTR_START); start; start = s.match(ATTR_START)) {
    // The NAME is checked before the quoting, so `onclick=x` reports the
    // whitelist (the attribute is the problem) rather than sending the author
    // off to add quotes to something that will still be rejected.
    if (!A11Y_ATTR_NAME.test(start[1])) {
      throw wdError(
        `Attribute "${start[1]}" is not allowed in ${what} at ${at(ctx, index)}. ` +
          `Only accessibility attributes are: ${A11Y_ATTR_USE}`,
        {
          code: "WD650",
          file: ctx.file,
          line: lineOf(ctx, index),
          hint: A11Y_ATTR_USE,
          example: CONTAINER_A11Y_EXAMPLE
        }
      );
    }
    const pair = s.match(ATTR_PAIR);
    if (!pair) {
      throw wdError(
        `Attribute "${start[1]}" in ${what} at ${at(ctx, index)} needs a double-quoted value. Use: ${A11Y_ATTR_USE}`,
        {
          code: "WD651",
          file: ctx.file,
          line: lineOf(ctx, index),
          hint: A11Y_ATTR_USE,
          example: CONTAINER_A11Y_EXAMPLE
        }
      );
    }
    attrs.push([pair[1], pair[2]]);
    s = s.slice(pair[0].length).trim();
  }
  return { attrs, rest: s };
}

/**
 * Serialize validated attribute pairs into an HTML attribute string. The NAME
 * came through {@link A11Y_ATTR_NAME} so it is inert; the VALUE is author text
 * and is escaped.
 * @param {[string, string][]} attrs
 * @returns {string}
 */
export function a11yAttrHtml(attrs) {
  return attrs.map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInclude(line, ctx, index) {
  const match = line.match(/^@include\s+(\S+)(?:\s+with\s+(.+))?$/);
  if (!match)
    throw wdError(`Malformed @include in ${at(ctx, index)}: ${line}. ${INCLUDE_USE}`, {
      code: "WD603",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: INCLUDE_USE.slice("Use: ".length),
      example: INCLUDE_EXAMPLE
    });
  const target = resolveInclude(
    match[1],
    ctx.file,
    ctx.context,
    false,
    at(ctx, index),
    ctx.comp.reader
  );
  const args = parseIncludeArgs(match[2] || "", ctx);
  recordSymbol(ctx, index, { kind: "include", name: match[1], detail: `@include ${match[1]}` });
  const childScope = createScope(ctx.scope, args);
  // Thread the reactive-nesting depth (and the enclosing loop opener, so a depth
  // error names the right opener) into the include, exactly as `loopItem` is —
  // otherwise a reactive @loop inside the include would start counting from zero
  // and could open a THIRD nested `data-wd-loop` level that silently paints empty.
  const child = ctx.compileFile(
    target,
    ctx.context,
    ctx.stack,
    childScope,
    ctx.comp,
    ctx.sections,
    ctx.loopItem,
    ctx.reactiveDepth ?? 0,
    ctx.loopOpener ?? null
  );
  // An include with its OWN scoped colocated skin stamps just its returned
  // subtree — so a scoped `.card` in the include can't collide with a `.card`
  // anywhere else on the page, and the scope never leaks to the include's
  // siblings (only this child HTML is stamped). The CSS rewrite (builder) uses
  // the same path-derived id, so attribute and stylesheet line up.
  const scopedSkin = scopedSkinFor(target, ctx.context, ctx.comp.reader);
  return scopedSkin && scopedSkin.scoped ? stampScope(child.html, scopedSkin.scopeId) : child.html;
}

/**
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {Record<string, unknown>}
 */
function parseIncludeArgs(raw, ctx) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const re = /([A-Za-z0-9_-]+)=("[^"]*"|'[^']*'|\{[^}]*\}|\S+)/g;
  for (const match of raw.matchAll(re)) {
    const value = match[2];
    if (value.startsWith("{")) {
      const expr = value.slice(1, -1).trim();
      const resolved = lookupPath(expr, ctx);
      if (!resolved.found) {
        throw wdError(
          `@include argument ${match[1]}={ ${expr} } in ${ctx.file} does not match any value in scope`,
          { code: "WD604", file: ctx.file }
        );
      }
      args[match[1]] = resolved.value;
    } else {
      args[match[1]] = parseScalar(value);
    }
  }
  return args;
}

/**
 * @param {string} header
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleContainer(header, bodyLines, ctx, index) {
  let rest = header.trim();
  let tag = "section";
  /** @type {string[]} Static classes baked into class="". */
  const extraClass = [];
  /** @type {[string, any[]][]} Reactive loop-item class bindings (data-wd-each-class): [class, exprAST]. */
  const eachClasses = [];
  /** @type {[string, any[]][]} Global state-driven class bindings (data-wd-class): [class, exprAST]. */
  const stateClasses = [];
  /** @type {[string, string][]} Whitelisted accessibility attributes: [name, value]. */
  const a11y = [];
  let id = "";
  // Leading tag/name token (anything not starting with . or #). "section" keeps
  // the <section> tag; a whitelisted semantic landmark (`nav`/`main`) emits that
  // real element AND keeps the name as a class hook (so `.nav`/`.main` skins
  // still cascade); any other name becomes a <div> and also a class. The tag is
  // always one of these fixed constants — never author text — so it can't inject.
  // …unless the header OPENS with an attribute (`::: role="region" .card`), which
  // `^([^\s.#]\S*)` would otherwise swallow whole and emit as a class:
  // `class="role=&quot;region&quot; card"`. An attribute in first position leaves
  // the tag at its default and falls through to the token loop below, so both
  // orders work — `::: nav role="navigation"` still gets the <nav> element.
  const lead = ATTR_START.test(rest) ? null : rest.match(/^([^\s.#]\S*)/);
  let nameToken = "section";
  if (lead) {
    nameToken = lead[1];
    rest = rest.slice(lead[0].length).trim();
  }
  if (nameToken === "section") {
    // default tag, no class
  } else if (SEMANTIC_CONTAINER_TAGS.has(nameToken)) {
    tag = nameToken;
    extraClass.push(nameToken);
  } else {
    tag = "div";
    extraClass.push(nameToken);
  }
  while (rest.length) {
    if (rest.startsWith("#")) {
      const m = rest.match(/^#(\S+)/);
      id = m ? m[1] : "";
      rest = rest.slice((m ? m[0] : rest).length).trim();
      continue;
    }
    // `role="…"` / `aria-…="…"` / `title="…"`, in any position among the class
    // and id tokens. A token that opens like an attribute but is not on the
    // whitelist throws here rather than reaching the generic unexpected-token
    // error, so the message names what IS allowed.
    const taken = takeA11yAttrs(rest, ctx, index, `container "::: ${header.trim()}"`);
    if (taken.attrs.length) {
      a11y.push(...taken.attrs);
      rest = taken.rest;
      continue;
    }
    const cm = rest.match(/^\.([A-Za-z_][\w-]*)/);
    if (!cm)
      throw wdError(
        `Unexpected token "${rest.split(/\s+/)[0]}" in container "::: ${header}" in ${at(ctx, index)}`,
        { code: "WD605", file: ctx.file, line: lineOf(ctx, index) }
      );
    const cls = cm[1];
    rest = rest.slice(cm[0].length).trim();
    // Optional `when <predicate>` makes the class reactive. The predicate runs to
    // the next ` .`/` #` token or the end of the header.
    // The predicate runs to the next ` .`/` #` token, the next ATTRIBUTE token,
    // or the end of the header — without the attribute stop, `.live when a == b
    // role="status"` swallowed the attribute into the predicate.
    const whenMatch = rest.match(/^when\s+(.+?)(?=\s+[.#]|\s+[A-Za-z][A-Za-z0-9-]*\s*=|$)/);
    if (whenMatch) {
      rest = rest.slice(whenMatch[0].length).trim();
      const compiled = compileWhen(whenMatch[1].trim(), ctx);
      if (compiled.static) {
        if (compiled.value) extraClass.push(cls);
      } else if (compiled.item)
        eachClasses.push([cls, astAt(compiled.body, ctx, index, '"::: … when"')]);
      else stateClasses.push([cls, astAt(compiled.body, ctx, index, '"::: … when"')]);
    } else {
      extraClass.push(cls);
    }
  }
  const explicitId = Boolean(id);
  if (!id) id = `wd-s${++ctx.comp.sectionCounter}`;

  ctx.sections.push(id);
  let inner;
  try {
    inner = ctx.compileBody(bodyLines, nestedCtx(ctx, index + 1));
  } finally {
    ctx.sections.pop();
  }
  const idAttr = explicitId ? ` id="${escapeHtml(id)}"` : "";
  const classAttr = extraClass.length ? ` class="${escapeHtml(extraClass.join(" "))}"` : "";
  const a11yAttr = a11yAttrHtml(a11y);
  let classBind = "";
  if (eachClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-each-class="${escapeHtml(JSON.stringify(eachClasses))}"`;
  }
  if (stateClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-class="${escapeHtml(JSON.stringify(stateClasses))}"`;
  }
  return `<${tag}${idAttr}${classAttr}${a11yAttr}${classBind}>\n${inner}\n</${tag}>`;
}

/**
 * `:carousel [autoplay=N]` … `:endcarousel` — a horizontally scroll-snapping
 * carousel. Contract: each DIRECT child element of the track is one slide, so put
 * each slide in its own block (e.g. a `::: slide` container) and give that block
 * the slide sizing in your skin — loose prose lines would each count as a slide.
 * Registers the `carousel` behavior (prev/next, dot nav, optional autoplay, mouse
 * drag); native CSS scroll-snap + the page skin handle layout and touch swipe.
 * `autoplay` is suppressed under `prefers-reduced-motion`. No runtime required.
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleCarousel(line, bodyLines, ctx, index) {
  const match = line.match(/^:carousel\s*(.*)$/);
  const rest = (match?.[1] || "").trim();
  let autoplayAttr = "";
  if (rest) {
    const auto = rest.match(/^autoplay=(\d+)$/);
    if (!auto) {
      const hint = `:carousel [autoplay=3000] … :endcarousel — e.g. ${CAROUSEL_EXAMPLE}`;
      throw wdError(`Malformed :carousel in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
        code: "WD606",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint,
        example: CAROUSEL_EXAMPLE
      });
    }
    autoplayAttr = ` data-wd-carousel-autoplay="${auto[1]}"`;
  }
  ctx.comp.assets.behaviors.add("carousel");
  const inner = ctx.compileBody(bodyLines, nestedCtx(ctx, index + 1));
  return `<div class="wd-carousel" data-wd-carousel${autoplayAttr}>\n<div class="wd-carousel-track" data-wd-carousel-track>\n${inner}\n</div>\n</div>`;
}

/**
 * Compile-time announcements for `:fetch` lifecycle regions: a bare
 * `:if <key>_loading` over a fetch-declared key becomes a `role="status"`
 * (polite) live region and `:if <key>_error` a `role="alert"` one, so the
 * runtime's existing show/hide flip is read by assistive tech with zero extra
 * runtime JS. Author-supplied `role`/`aria-live` inside the region always wins
 * (see handleInput) — nothing is added over it.
 *
 * The author-aria check reads the region's own RAW SOURCE lines, not its compiled
 * branch HTML: in the documented chained pattern (`:if x_loading` / `:else if
 * x_error` / `:else`) the loading region's falsy branch *contains* the nested
 * error region's framework-added `role="alert"`, and matching that would falsely
 * suppress the loading region's own `role="status"`. Framework-added attributes
 * never appear in source, so only genuine author `role`/`aria-live` can match.
 * @param {string} key Resolved state key of the `:if` region.
 * @param {string[]} sourceLines The region's own truthy + falsy source lines.
 * @param {Ctx} ctx
 * @returns {string}
 */
function fetchLiveAttr(key, sourceLines, ctx) {
  const match = key.match(/^(.*)_(loading|error)$/);
  if (!match || !ctx.comp.fetchKeys.has(match[1])) return "";
  if (/\b(?:role|aria-live)\s*=/.test(sourceLines.join("\n"))) return "";
  return match[2] === "loading" ? ' role="status" aria-live="polite"' : ' role="alert"';
}

/**
 * @param {string} line
 * @param {string[]} truthyLines
 * @param {string[]} falsyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {number} [falsyStart] 0-based index the falsy body starts at in the
 *   current slice, so nested errors in that branch report the true file line.
 * @returns {string}
 */
export function handleIf(line, truthyLines, falsyLines, ctx, index, falsyStart = index + 1) {
  const truthyCtx = nestedCtx(ctx, index + 1);
  const falsyCtx = nestedCtx(ctx, falsyStart);
  // `\s*` (not `\s+`) so a BARE `:if` yields an empty condition and lands on the
  // malformed-`:if` error below, instead of falling through with the literal
  // text `:if` as its condition and reporting a baffling unsupported operand.
  const condition = line.replace(/^:if\s*/, "").trim();
  recordSymbol(ctx, index, { kind: "if", name: condition, detail: `:if ${condition}` });
  // Fast path: a bare truthy dotted path (`:if open`, `:if item.done`). Keeps the
  // existing markup/behavior identical. Anything with operators (`>`, `==`, `and`,
  // `not`, …) falls through to the predicate path below.
  const match = condition.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
  if (match) {
    const segs = match[1].split(".");
    const head = segs[0];

    // Per-row meta vars in :if — only valid inside a loop.
    if (LOOP_META[head]) {
      if (!ctx.loopMeta)
        throw wdError(
          `":if ${match[1]}" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Use it inside a loop body.`,
          { code: "WD607", file: ctx.file }
        );
      if (ctx.loopItem) {
        const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
        const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
        return `<span data-wd-each-if data-wd-meta="${LOOP_META[head]}"><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
      }
      // static: the meta boolean is in scope — fall through to the static branch below.
    }

    // RESOLUTION ORDER: reactive loop item → static scope → declared state, the
    // framework-wide order `{ }` interpolation and `@loop … where` already use.
    // Static scope used to be tried FIRST here, so in a nested static-then-
    // reactive loop that reuses one item name, `{ it.name }` bound to the
    // reactive row while `:if it.done` folded against the OUTER static value and
    // hard-baked a branch with no `data-wd-each-if` — unfixable at runtime.
    if (ctx.loopItem && head === ctx.loopItem) {
      const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
      const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
      const rest = segs.slice(1).join(".");
      const pathAttr = ` data-wd-path="${escapeHtml(rest)}"`;
      return `<span data-wd-each-if${pathAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
    }

    const staticValue = lookupVar(ctx.scope, head);
    if (staticValue.found) {
      const active = Boolean(getPath(staticValue.value, segs.slice(1)));
      return ctx.compileBody(active ? truthyLines : falsyLines, active ? truthyCtx : falsyCtx);
    }

    const key = resolveStateKey(head, ctx);
    if (!key) {
      throw wdError(
        `:if ${match[1]} in ${ctx.file} does not match a :state or in-scope value. Declare it first.`,
        { code: "WD608", file: ctx.file }
      );
    }
    ctx.comp.assets.runtime = true;
    const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
    const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
    const restPath = segs.slice(1).join(".");
    const pathAttr = restPath ? ` data-wd-path="${escapeHtml(restPath)}"` : "";
    const liveAttr = restPath ? "" : fetchLiveAttr(key, [...truthyLines, ...falsyLines], ctx);
    const initialTruthy = Boolean(getPath(ctx.comp.state.get(key), segs.slice(1)));
    const active = initialTruthy ? truthy : falsy;
    // The key carries the `::: name #id` section prefix, which is author text.
    // It is escaped exactly like the `id="…"` attribute beside it — an unescaped
    // `&`/`"` in a section id closed the attribute early and produced broken
    // markup with a dead binding.
    return `<div data-wd-if="${escapeHtml(key)}"${pathAttr}${liveAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
  }

  // Predicate path: a comparison / logical condition. Compiles through the same
  // whitelist as `@loop … where` / `.class when` (with `not`), so it folds at
  // build when static, drives a per-row each-if when it reads the loop item, and
  // a global if-region (evaluated each render) when it reads state. No raw eval.
  if (!condition) {
    const hint = `":if name" or ":if a <op> b [and|or|not …]" — e.g. ${IF_EXAMPLE}`;
    throw wdError(`Malformed :if in ${at(ctx, index)}: ${line}. Use ${hint}`, {
      code: "WD609",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: IF_EXAMPLE
    });
  }
  const compiled = compileWhen(condition, ctx, '":if"');
  if (compiled.static)
    return ctx.compileBody(
      compiled.value ? truthyLines : falsyLines,
      compiled.value ? truthyCtx : falsyCtx
    );
  ctx.comp.assets.runtime = true;
  const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
  const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
  const exprAttr = ` data-wd-if-expr="${escapeHtml(serializeExprAt(compiled.body, ctx, index, '":if"'))}"`;
  if (compiled.item) {
    return `<span data-wd-each-if${exprAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
  }
  const initialTruthy = evalPredicate(compiled.body, undefined, ctx, '":if"');
  const active = initialTruthy ? truthy : falsy;
  return `<div data-wd-if=""${exprAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
}

/**
 * Render the documentation-demo directive `:try` (the "Try it" card the homepage
 * uses). `:note` and `:sprint` lived here too and were deleted: nothing in the
 * site, the docs, or the public directive set used them, and a directive the
 * catalog does not list is a trap for an AI author that discovers it in source.
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
export function renderDemoDirective(line, ctx) {
  const tryMatch = line.match(/^:try\s+"([^"]+)"\s+href="([^"]+)"$/);
  if (tryMatch) {
    const href = validateDemoHref(tryMatch[2], ctx);
    return `<a class="try-card" href="${escapeHtml(href)}"><span>Try</span>${escapeHtml(tryMatch[1])}</a>`;
  }
  return "";
}

/**
 * Validate demo-card links without adding arbitrary URL passthrough.
 * @param {string} href
 * @param {Ctx} ctx
 * @returns {string}
 */
function validateDemoHref(href, ctx) {
  const value = href.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects control characters in URLs/hrefs.
  if (value !== href || /[\u0000-\u001F\u007F]/.test(value)) {
    throw wdError(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`,
      { code: "WD610", file: ctx.file }
    );
  }
  if (value.startsWith("//")) {
    throw wdError(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http: or https: explicitly.`,
      { code: "WD611", file: ctx.file }
    );
  }
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("#")
  ) {
    return value;
  }
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && ["http", "https", "mailto"].includes(scheme[1].toLowerCase())) {
    return value;
  }
  throw wdError(
    `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`,
    { code: "WD610", file: ctx.file }
  );
}
