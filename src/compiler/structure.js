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

import path from "node:path";
import {
  at,
  createScope,
  LOOP_META,
  lineOf,
  nestedCtx,
  normalizeNewlines,
  recordSymbol,
  wdError
} from "./context.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  CHILDREN_SLOT_LINE,
  INCLUDE_CHILDREN,
  resolveInclude,
  scopedSkinFor,
  stampScope
} from "./includes.js";
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
 * Compile an `@include` line — inline form (`@include /nav.wd`) or block form
 * (`@include /card.wd … @endinclude`, with `childrenLines` holding the lines
 * between opener and closer, captured by {@link scanIncludeBlock}).
 *
 * Block form is compile-time macro expansion and nothing more: the children
 * lines compile in the CALLER's context (its scope, its `:state`, its loop
 * item when the call sits in a `@loop` body) BEFORE the target compiles, and
 * the resulting HTML rides into the include's scope under
 * {@link INCLUDE_CHILDREN}, where the body parser splices it at each
 * `{ children }` slot line. No runtime marker, no reactivity of its own.
 * Children compile ONCE even when the include places the slot twice, so state
 * a child line declares is declared once in the caller.
 *
 * The include file's own frontmatter may declare `defaults: [name="value" …]`
 * fallback values for `with` arguments (see {@link parseIncludeDefaults}); a
 * caller-provided argument always wins over a default, and an argument with
 * neither keeps the literal-braces behavior.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {string[]} [childrenLines] Lines between `@include` and `@endinclude`
 *   for the block form; undefined for the inline form.
 * @returns {string}
 */
export function handleInclude(line, ctx, index, childrenLines) {
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
  const component = includeComponentInfo(target, ctx);
  let childrenHtml = "";
  if (childrenLines) {
    // One nesting level is the contract: a block include's children (or an
    // include file's own body) may hold one block include, no more. Children
    // depth travels on the ctx (children compile in the caller's context);
    // include-FILE depth is the include stack's length (page = 1, its include
    // = 2, an include's include = 3 — too deep for a block).
    if ((ctx.includeBlockDepth ?? 0) >= 2 || ctx.stack.length > 2) {
      const hint = `${INCLUDE_BLOCK_USE}`;
      throw wdError(
        `Block-form @include nested too deep in ${at(ctx, index)}: ${line}. A children block or an include body may hold ONE level of @include … @endinclude. Use: ${hint}`,
        { code: "WD616", file: ctx.file, line: lineOf(ctx, index), hint, example: INCLUDE_EXAMPLE }
      );
    }
    childrenHtml = ctx.compileBody(childrenLines, {
      ...nestedCtx(ctx, index + 1),
      includeBlockDepth: (ctx.includeBlockDepth ?? 0) + 1
    });
    if (childrenHtml.trim() && !component.usesChildren) {
      ctx.comp.warnings.push(
        `${at(ctx, index)}: the @include block for "${match[1]}" passes children, but ${target} never uses a { children } line, so the content is dropped. Add { children } where the slot content should appear, or drop the block.`
      );
    }
  }
  // Caller args sit over defaults (the caller always wins); the children slot
  // sits alongside them. An inline call still sets the slot (""), so a nested
  // include never sees an OUTER include's children through the scope chain.
  const childScope = createScope(ctx.scope, {
    ...component.defaults,
    ...args,
    [INCLUDE_CHILDREN]: childrenHtml
  });
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

const INCLUDE_BLOCK_USE = `@include /partial.wd [with key="value"] … @endinclude — e.g. @include /card.wd with title="Pricing"`;

/**
 * Scan ahead from an `@include` opener for the `@endinclude` that pairs with
 * it. Pairing is nearest-opener-first: a nested `@include` line pushes, an
 * `@endinclude` line pops the most recent unclosed opener, and the first
 * `@endinclude` found with nothing on the stack belongs to THIS opener — so
 * nested blocks pair correctly, and an inline `@include` earlier in the file
 * than a block (the common nav-include-then-card-block page) is unaffected.
 * Fenced code is skipped, exactly as in the other block scanners.
 *
 * Returns null when no closer pairs — the include is the INLINE form, which
 * stays legal (backward compatible): an opener that never pairs is an inline
 * include followed by ordinary prose, and the two are indistinguishable, so
 * there is deliberately no "unclosed block" error.
 * @param {string[]} lines The current body slice.
 * @param {number} start 0-based index of the `@include` opener line.
 * @returns {{ body: string[], end: number } | null} The children lines and the
 *   closer's 0-based index, or null for the inline form.
 */
export function scanIncludeBlock(lines, start) {
  /** @type {number[]} */
  const stack = [];
  /** @type {string | null} */
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (/^@include\s/.test(line)) {
      stack.push(i);
      continue;
    }
    if (line.trim() === "@endinclude") {
      if (stack.length === 0) return { body: lines.slice(start + 1, i), end: i };
      stack.pop();
    }
  }
  return null;
}

/**
 * `@endinclude` reached the body dispatcher, meaning no `@include` opener
 * claimed it — the one-closer-too-many case (a typo'd closer, or a nested
 * block attempted inside a children block, where the inner opener already
 * took the closer the author meant for the outer one). Always throws.
 * @param {string} line The offending line, for the message.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line`.
 * @returns {never}
 */
export function strayEndinclude(line, ctx, index) {
  const hint = INCLUDE_BLOCK_USE;
  throw wdError(
    `Stray "${line.trim()}" with no unpaired @include before it in ${at(ctx, index)}. @endinclude pairs with the nearest preceding unpaired @include. Use: ${hint}`,
    { code: "WD614", file: ctx.file, line: lineOf(ctx, index), hint, example: INCLUDE_EXAMPLE }
  );
}

/**
 * The component-facing facts about an include target's source: its declared
 * argument `defaults` (frontmatter) and whether its body ever places the
 * `{ children }` slot. Reads the target once, ahead of the compileFile read.
 * @param {string} target Absolute include path.
 * @param {Ctx} ctx
 * @returns {{ defaults: Record<string, string>, usesChildren: boolean }}
 */
function includeComponentInfo(target, ctx) {
  const raw = normalizeNewlines(ctx.comp.reader.readText(target));
  const { meta, body } = parseFrontmatter(raw, target);
  return {
    defaults: parseIncludeDefaults(meta, raw, target),
    // A `.md` include never runs the directive/interpolation layer, so a
    // `{ children }` line in one is inert text, not a slot: the drop-hint must
    // treat the file as slotless.
    usesChildren: path.extname(target) !== ".md" && usesChildrenSlot(body)
  };
}

/**
 * Parse an include file's `defaults:` frontmatter: an inline array of
 * `name="value"` entries, e.g. `defaults: [title="Untitled", cta="Learn more"]`.
 * Values are STRINGS (frontmatter is string-typed) and apply only inside that
 * include; a caller-provided `with` argument always wins.
 *
 * The raw `defaults:` line is split quote-aware (so a value may contain a
 * comma) rather than trusting the generic frontmatter array items, whose
 * splitter only honors item-leading quotes. Reached only when
 * `parseFrontmatter` already produced an array for the key, so the source
 * line and its `[…]` shape are guaranteed present.
 * @param {import("./context.js").Meta} meta The include file's frontmatter.
 * @param {string} raw The include file's full (newline-normalized) source.
 * @param {string} target Absolute include path, for error messages.
 * @returns {Record<string, string>}
 */
function parseIncludeDefaults(meta, raw, target) {
  if (meta.defaults === undefined) return {};
  const use = 'an inline array of name="value" entries — e.g. defaults: [title="Untitled"]';
  if (!Array.isArray(meta.defaults)) {
    throw wdError(`Invalid defaults frontmatter in ${target}: the value must be ${use}.`, {
      code: "WD613",
      file: target,
      hint: use,
      example: 'defaults: [title="Untitled"]'
    });
  }
  const lines = raw.split("\n");
  const lineIndex = lines.findIndex((l) => /^defaults\s*:/.test(l));
  const valueText = lines[lineIndex].replace(/^defaults\s*:\s*/, "").trim();
  const inner = valueText.slice(1, -1); // strip the […] the array shape guarantees
  /** @type {Record<string, string>} */
  const defaults = {};
  for (const entry of splitDefaultEntries(inner)) {
    const match =
      entry.match(/^([A-Za-z0-9_-]+)="([^"]*)"$/) ?? entry.match(/^([A-Za-z0-9_-]+)='([^']*)'$/);
    if (!match) {
      throw wdError(
        `Invalid defaults frontmatter in ${target}:${lineIndex + 1}: entry "${entry}" must look like name="value". Use: ${use}.`,
        {
          code: "WD613",
          file: target,
          line: lineIndex + 1,
          hint: use,
          example: 'defaults: [title="Untitled"]'
        }
      );
    }
    defaults[match[1]] = match[2];
  }
  return defaults;
}

/**
 * Split the inside of a `defaults: […]` array on top-level commas, honoring
 * quotes ANYWHERE in an entry (the value follows `name=`, so the quote is not
 * entry-leading and the generic frontmatter splitter would break on a comma
 * inside it). An unterminated quote leaves its entry malformed, which the
 * caller's entry check rejects.
 * @param {string} inner
 * @returns {string[]} Trimmed, non-empty entries.
 */
function splitDefaultEntries(inner) {
  /** @type {string[]} */
  const entries = [];
  let buf = "";
  /** @type {string | null} */
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ",") {
      entries.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  entries.push(buf);
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Whether an include body ever places the `{ children }` slot: a standalone
 * slot-marker line outside fenced code. Fence-aware so a documentation fence
 * demonstrating `{ children }` does not count (its content is literal text —
 * the slot really is unused there, and the drop-hint should still fire).
 * @param {string} body The include file's post-frontmatter body.
 * @returns {boolean}
 */
function usesChildrenSlot(body) {
  /** @type {string | null} */
  let fence = null;
  for (const line of body.split("\n")) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (CHILDREN_SLOT_LINE.test(line)) return true;
  }
  return false;
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
