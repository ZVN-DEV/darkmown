// ---------------------------------------------------------------------------
// Structure: the directives that shape a page's tree — `@include` (sub-file
// compile + scoped-skin stamp), `::: container` sections, `:if` conditional
// regions, the `:carousel` block — plus the documentation-demo directives
// (`:try`/`:note`/`:sprint`). Nested block bodies recurse through
// `ctx.compileBody` (and `@include` through `ctx.compileFile`), threaded in by
// the per-file compile so the module graph stays an import-cycle-free DAG.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, createScope, LOOP_META, nestedCtx } from "./context.js";
import { resolveInclude, scopedSkinFor, stampScope } from "./includes.js";
import {
  escapeHtml,
  getPath,
  lookupPath,
  lookupVar,
  parseScalar,
  resolveStateKey
} from "./interpolation.js";
import { compileWhen, evalPredicate } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInclude(line, ctx, index) {
  const match = line.match(/^@include\s+(\S+)(?:\s+with\s+(.+))?$/);
  if (!match) throw new Error(`Malformed @include in ${at(ctx, index)}: ${line}`);
  const target = resolveInclude(match[1], ctx.file, ctx.context);
  const args = parseIncludeArgs(match[2] || "", ctx);
  const childScope = createScope(ctx.scope, args);
  const child = ctx.compileFile(
    target,
    ctx.context,
    ctx.stack,
    childScope,
    ctx.comp,
    ctx.sections,
    ctx.loopItem
  );
  // An include with its OWN scoped colocated skin stamps just its returned
  // subtree — so a scoped `.card` in the include can't collide with a `.card`
  // anywhere else on the page, and the scope never leaks to the include's
  // siblings (only this child HTML is stamped). The CSS rewrite (builder) uses
  // the same path-derived id, so attribute and stylesheet line up.
  const scopedSkin = scopedSkinFor(target, ctx.context);
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
        throw new Error(
          `@include argument ${match[1]}={ ${expr} } in ${ctx.file} does not match any value in scope`
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
  /** @type {[string, string][]} Reactive loop-item class bindings (data-wd-each-class). */
  const eachClasses = [];
  /** @type {[string, string][]} Global state-driven class bindings (data-wd-class). */
  const stateClasses = [];
  let id = "";
  // Leading tag/name token (anything not starting with . or #). "section" keeps
  // the <section> tag; any other name becomes a <div> and also a class.
  const lead = rest.match(/^([^\s.#]\S*)/);
  let nameToken = "section";
  if (lead) {
    nameToken = lead[1];
    rest = rest.slice(lead[0].length).trim();
  }
  if (nameToken !== "section") {
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
    const cm = rest.match(/^\.([A-Za-z_][\w-]*)/);
    if (!cm)
      throw new Error(
        `Unexpected token "${rest.split(/\s+/)[0]}" in container "::: ${header}" in ${at(ctx, index)}`
      );
    const cls = cm[1];
    rest = rest.slice(cm[0].length).trim();
    // Optional `when <predicate>` makes the class reactive. The predicate runs to
    // the next ` .`/` #` token or the end of the header.
    const whenMatch = rest.match(/^when\s+(.+?)(?=\s+[.#]|$)/);
    if (whenMatch) {
      rest = rest.slice(whenMatch[0].length).trim();
      const compiled = compileWhen(whenMatch[1].trim(), ctx);
      if (compiled.static) {
        if (compiled.value) extraClass.push(cls);
      } else if (compiled.item) eachClasses.push([cls, compiled.body]);
      else stateClasses.push([cls, compiled.body]);
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
  let classBind = "";
  if (eachClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-each-class="${escapeHtml(JSON.stringify(eachClasses))}"`;
  }
  if (stateClasses.length) {
    ctx.comp.assets.runtime = true;
    classBind += ` data-wd-class="${escapeHtml(JSON.stringify(stateClasses))}"`;
  }
  return `<${tag}${idAttr}${classAttr}${classBind}>\n${inner}\n</${tag}>`;
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
    if (!auto)
      throw new Error(
        `Malformed :carousel in ${at(ctx, index)}: ${line}. Use: :carousel [autoplay=3000] … :endcarousel`
      );
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
 * @param {string} key Resolved state key of the `:if` region.
 * @param {string} branches Compiled truthy + falsy branch HTML.
 * @param {Ctx} ctx
 * @returns {string}
 */
function fetchLiveAttr(key, branches, ctx) {
  const match = key.match(/^(.*)_(loading|error)$/);
  if (!match || !ctx.comp.fetchKeys.has(match[1])) return "";
  if (/\b(?:role|aria-live)\s*=/.test(branches)) return "";
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
  const condition = line.replace(/^:if\s+/, "").trim();
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
        throw new Error(
          `":if ${match[1]}" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Use it inside a loop body.`
        );
      if (ctx.loopItem) {
        const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
        const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
        return `<span data-wd-each-if data-wd-meta="${LOOP_META[head]}"><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
      }
      // static: the meta boolean is in scope — fall through to the static branch below.
    }

    const staticValue = lookupVar(ctx.scope, head);
    if (staticValue.found) {
      const active = Boolean(getPath(staticValue.value, segs.slice(1)));
      return ctx.compileBody(active ? truthyLines : falsyLines, active ? truthyCtx : falsyCtx);
    }

    if (ctx.loopItem && head === ctx.loopItem) {
      const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
      const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
      const rest = segs.slice(1).join(".");
      const pathAttr = ` data-wd-path="${escapeHtml(rest)}"`;
      return `<span data-wd-each-if${pathAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
    }

    const key = resolveStateKey(head, ctx);
    if (!key) {
      throw new Error(
        `:if ${match[1]} in ${ctx.file} does not match a :state or in-scope value. Declare it first.`
      );
    }
    ctx.comp.assets.runtime = true;
    const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
    const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
    const restPath = segs.slice(1).join(".");
    const pathAttr = restPath ? ` data-wd-path="${escapeHtml(restPath)}"` : "";
    const liveAttr = restPath ? "" : fetchLiveAttr(key, truthy + falsy, ctx);
    const initialTruthy = Boolean(getPath(ctx.comp.state.get(key), segs.slice(1)));
    const active = initialTruthy ? truthy : falsy;
    return `<div data-wd-if="${key}"${pathAttr}${liveAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
  }

  // Predicate path: a comparison / logical condition. Compiles through the same
  // whitelist as `@loop … where` / `.class when` (with `not`), so it folds at
  // build when static, drives a per-row each-if when it reads the loop item, and
  // a global if-region (evaluated each render) when it reads state. No raw eval.
  if (!condition)
    throw new Error(
      `Malformed :if in ${at(ctx, index)}: ${line}. Use ":if name" or ":if a <op> b [and|or|not …]".`
    );
  const compiled = compileWhen(condition, ctx, '":if"');
  if (compiled.static)
    return ctx.compileBody(
      compiled.value ? truthyLines : falsyLines,
      compiled.value ? truthyCtx : falsyCtx
    );
  ctx.comp.assets.runtime = true;
  const truthy = ctx.compileBody(truthyLines, truthyCtx).trim();
  const falsy = ctx.compileBody(falsyLines, falsyCtx).trim();
  const exprAttr = ` data-wd-if-expr="${escapeHtml(compiled.body)}"`;
  if (compiled.item) {
    return `<span data-wd-each-if${exprAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
  }
  const initialTruthy = evalPredicate(compiled.body, undefined, ctx);
  const active = initialTruthy ? truthy : falsy;
  return `<div data-wd-if=""${exprAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
}

/**
 * Render the documentation-demo directives (`:try`, `:note`, `:sprint`).
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
  const note = line.match(/^:note\s+"([^"]+)"$/);
  if (note) return `<aside class="note">${escapeHtml(note[1])}</aside>`;
  const sprint = line.match(/^:sprint\s+min=(\d+)\s+max=(\d+)\s+roles="([^"]+)"$/);
  if (sprint) {
    const roles = sprint[3]
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    return `<section class="sprint-board" data-min="${sprint[1]}" data-max="${sprint[2]}">${roles.map((role) => `<article><strong>${escapeHtml(role)}</strong><span>active lane</span></article>`).join("")}</section>`;
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
    throw new Error(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`
    );
  }
  if (value.startsWith("//")) {
    throw new Error(
      `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http: or https: explicitly.`
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
  throw new Error(
    `Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`
  );
}
