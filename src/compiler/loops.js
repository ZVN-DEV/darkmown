// ---------------------------------------------------------------------------
// Loop pipeline: parse the `@loop` header + clauses, resolve the source (JSON
// file / in-scope value / declared :state / item-relative), and emit either a
// build-time static unroll (zero-JS) or a reactive `data-wd-loop` region whose
// row <template> + initial paint the runtime reconciles. Also the row-template
// string fill used for the initial paint (text binds, per-row `:if`, meta).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { compileBody } from "./body.js";
import { createScope } from "./context.js";
import { resolveInclude } from "./includes.js";
import { escapeHtml, getPath, lookupPath, resolveStateKey, stripQuotes } from "./interpolation.js";
import { compilePredicate, evalPredicate } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Predicate} Predicate
 * @typedef {import("./context.js").NumArg} NumArg
 * @typedef {import("./context.js").LoopOpts} LoopOpts
 */

// The fixed corrective suggestion shown for any malformed @loop header.
const LOOP_USAGE = "Use: @loop src into item [where …] [sort by …] [reverse] [offset N] [limit N]";

/**
 * Parse the optional clause tail of a `@loop` header in FIXED order:
 * `[where P] [sort by key [asc|desc]] [reverse] [offset N] [limit N]`.
 * @param {string} tail Everything after `@loop src into item`.
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ where: string|null, sort: {key:string,dir:string}|null, reverse: boolean, offset: NumArg|null, limit: NumArg|null, refsState: boolean }}
 */
function parseLoopClauses(tail, itemName, ctx) {
  // Peel clauses off the END in reverse fixed-order (limit, offset, reverse,
  // sort by). Parsing from the tail avoids mistaking a state operand named
  // `limit`/`offset` inside the `where` predicate for a clause keyword. Whatever
  // remains must be `where …` (or empty); a clause keyword surviving in the
  // remainder means the author wrote the clauses out of order.
  let s = tail.trim();
  /** @type {{key:string,dir:string}|null} */ let sort = null;
  let reverse = false;
  /** @type {NumArg|null} */ let offset = null;
  /** @type {NumArg|null} */ let limit = null;
  let refsState = false;
  /** @returns {never} */
  const bad = () => {
    throw new Error(`Malformed @loop clause in ${ctx.file}: "${tail.trim()}". ${LOOP_USAGE}`);
  };

  let m = s.match(/(^|\s)limit\s+(\d+|[A-Za-z_$][\w$]*)$/);
  if (m) {
    limit = parseNumArg(m[2], ctx);
    refsState = refsState || limit.kind === "key";
    s = s.slice(0, s.length - m[0].length + m[1].length).trim();
  }

  m = s.match(/(^|\s)offset\s+(\d+|[A-Za-z_$][\w$]*)$/);
  if (m) {
    offset = parseNumArg(m[2], ctx);
    refsState = refsState || offset.kind === "key";
    s = s.slice(0, s.length - m[0].length + m[1].length).trim();
  }

  m = s.match(/(^|\s)reverse$/);
  if (m) {
    reverse = true;
    s = s.slice(0, s.length - m[0].length + m[1].length).trim();
  }

  m = s.match(/(^|\s)sort\s+by\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s+(asc|desc))?$/);
  if (m) {
    const segs = m[2].split(".");
    if (segs[0] !== itemName)
      throw new Error(
        `@loop sort key "${m[2]}" must start with the loop item "${itemName}" in ${ctx.file}. ${LOOP_USAGE}`
      );
    const rest = segs.slice(1);
    if (rest.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(`Sort key "${m[2]}" is not allowed in @loop (${ctx.file})`);
    }
    sort = { key: rest.join("."), dir: m[3] || "asc" };
    s = s.slice(0, s.length - m[0].length + m[1].length).trim();
  }

  /** @type {string|null} */ let where = null;
  if (s.length) {
    m = s.match(/^where\s+(.+)$/);
    if (!m) return bad(); // leftover non-where text → clauses written out of order
    where = m[1].trim();
    // `sort by`/`reverse` are never valid where operands; their presence in the
    // predicate means a clause was written before `where` finished (wrong order).
    if (/(^|\s)(sort\s+by\s|reverse(\s|$))/.test(where)) bad();
  }
  return { where, sort, reverse, offset, limit, refsState };
}

/**
 * @param {string} tok
 * @param {Ctx} ctx
 * @returns {NumArg}
 */
function parseNumArg(tok, ctx) {
  if (/^\d+$/.test(tok)) return { kind: "literal", value: Number(tok) };
  if (/^[A-Za-z_$][\w$]*$/.test(tok)) {
    const key = resolveStateKey(tok, ctx);
    if (!key)
      throw new Error(
        `@loop offset/limit "${tok}" in ${ctx.file} is neither a non-negative integer nor a declared :state. ${LOOP_USAGE}`
      );
    return { kind: "key", value: key };
  }
  throw new Error(`@loop offset/limit "${tok}" in ${ctx.file} is invalid. ${LOOP_USAGE}`);
}

/** @param {NumArg} arg @returns {string} */
function numArgAttr(arg) {
  return arg.kind === "literal" ? String(arg.value) : `key:${arg.value}`;
}

/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {string[] | null} emptyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
export function handleLoop(line, bodyLines, emptyLines, ctx) {
  const match = line.match(/^@loop\s+(.+?)\s+into\s+([A-Za-z_$][\w$]*)(\s+.+?)?\s*$/);
  if (!match) throw new Error(`Malformed @loop in ${ctx.file}: ${line}. ${LOOP_USAGE}`);
  const source = stripQuotes(match[1].trim());
  const itemName = match[2];
  const clauses = match[3]
    ? parseLoopClauses(match[3], itemName, ctx)
    : { where: null, sort: null, reverse: false, offset: null, limit: null, refsState: false };
  const where = clauses.where ? compilePredicate(clauses.where, itemName, ctx) : null;
  /** @type {LoopOpts} */
  const opts = {
    where,
    sort: clauses.sort,
    reverse: clauses.reverse,
    offset: clauses.offset,
    limit: clauses.limit,
    empty: emptyLines,
    clauseRefsState: clauses.refsState
  };

  if (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.endsWith(".json")
  ) {
    const dataFile = resolveInclude(source, ctx.file, ctx.context, true);
    const rows = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(rows)) throw new Error(`@loop data must be a JSON array: ${dataFile}`);
    return loopOverData(rows, itemName, bodyLines, ctx, opts);
  }

  const resolved = lookupPath(source, ctx);
  if (resolved.found) {
    if (!Array.isArray(resolved.value)) {
      throw new Error(
        `@loop ${source} in ${ctx.file} found an in-scope value, but it is not a list`
      );
    }
    return loopOverData(resolved.value, itemName, bodyLines, ctx, opts);
  }

  // A bare name OR a dotted path resolving to declared :state (e.g. team.members).
  const segs = source.split(".");
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(source)) {
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(`@loop source "${source}" is not allowed in ${ctx.file}`);
    }
    const key = resolveStateKey(segs[0], ctx);
    if (key) {
      const fullKey = segs.length > 1 ? `${key}.${segs.slice(1).join(".")}` : key;
      return reactiveLoop(fullKey, itemName, bodyLines, ctx, opts);
    }
    // Inside a reactive loop, `@loop <outerItem>.<path> into x` loops a field of
    // the enclosing row item — an ITEM-RELATIVE loop the runtime fills per row.
    if (ctx.loopItem && segs[0] === ctx.loopItem && segs.length > 1) {
      return itemRelativeLoop(segs.slice(1).join("."), itemName, bodyLines, ctx, opts);
    }
  }

  throw new Error(
    `@loop source "${source}" in ${ctx.file} was not found. Loop over a JSON file (@loop /data.json into row), an in-scope value, or a :state list.`
  );
}

// A static source (JSON file / in-scope value). No `where`, or a `where` that
// only reads the loop item → filter at build time and stay zero-JS. A `where`
// that reads :state → becomes a reactive filtered loop with the rows baked in.

/**
 * Build-time pipeline over already-resolved rows: filter → sort → reverse →
 * offset → limit. Used when source + every clause arg are static.
 * @param {unknown[]} rows
 * @param {Predicate | null} where
 * @param {LoopOpts} opts
 * @param {Ctx} ctx
 * @returns {unknown[]}
 */
function pipelineRows(rows, where, opts, ctx) {
  let list = where ? rows.filter((row) => evalPredicate(where.body, row, ctx)) : rows.slice();
  if (opts.sort) {
    const k = opts.sort.key;
    const dir = opts.sort.dir === "desc" ? -1 : 1;
    list = list
      .map((value, index) => ({ value, index }))
      .sort((a, b) => {
        const av = getPath(a.value, k ? k.split(".") : []);
        const bv = getPath(b.value, k ? k.split(".") : []);
        const c =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return (c || a.index - b.index) * dir;
      })
      .map((w) => w.value);
  }
  if (opts.reverse) list.reverse();
  const off = opts.offset && opts.offset.kind === "literal" ? opts.offset.value : 0;
  if (off) list = list.slice(off);
  if (opts.limit && opts.limit.kind === "literal") list = list.slice(0, opts.limit.value);
  return list;
}

/**
 * @param {unknown[]} rows
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {LoopOpts} opts
 * @returns {string}
 */
function loopOverData(rows, itemName, bodyLines, ctx, opts) {
  // Reactive when the where reads state OR an offset/limit references a state key.
  const reactive = (opts.where && opts.where.refsState) || opts.clauseRefsState;
  if (reactive) return reactiveLoop(null, itemName, bodyLines, ctx, { ...opts, data: rows });
  return staticUnroll(
    pipelineRows(rows, opts.where, opts, ctx),
    itemName,
    bodyLines,
    ctx,
    opts.empty
  );
}

/**
 * @param {unknown[]} rows
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {string[] | null} [empty] Empty-branch body, rendered when 0 rows.
 * @returns {string}
 */
function staticUnroll(rows, itemName, bodyLines, ctx, empty = null) {
  if (rows.length === 0 && empty) return compileBody(empty, { ...ctx, loopMeta: true });
  const out = [];
  const count = rows.length;
  for (let i = 0; i < count; i++) {
    const meta = {
      $index: i,
      $number: i + 1,
      $first: i === 0,
      $last: i === count - 1,
      $count: count
    };
    const rowCtx = {
      ...ctx,
      loopMeta: true,
      scope: createScope(ctx.scope, { [itemName]: rows[i], ...meta })
    };
    out.push(compileBody(bodyLines, rowCtx));
  }
  return out.join("\n");
}

/**
 * Emit a reactive loop region (template + initial rows + clause config) for the
 * runtime. `key` may be a dotted path (e.g. `team.members`); the runtime reads
 * it via getPath. `opts` carries where/sort/reverse/offset/limit/empty.
 * @param {string | null} key State key/path of the list, or null for baked data.
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {Partial<LoopOpts> & { data?: unknown[] } | null} [opts]
 * @returns {string}
 */
function reactiveLoop(key, itemName, bodyLines, ctx, opts = null) {
  ctx.comp.assets.runtime = true;
  /** @type {Ctx} */
  const templateCtx = {
    ...ctx,
    loopItem: itemName,
    loopKey: key ?? undefined,
    loopMeta: true,
    scope: createScope(ctx.scope)
  };
  const templateHtml = compileBody(bodyLines, templateCtx).trim();

  const { wrapperTag, itemTemplate } = wrapRowTemplate(templateHtml);

  const where = opts?.where || null;
  const sort = opts?.sort || null;
  const reverse = opts?.reverse || false;
  const offset = opts?.offset || null;
  const limit = opts?.limit || null;
  const emptyLines = opts?.empty || null;
  const baked = opts?.data || null; // rows for a static source filtered by state
  // Resolve the (possibly dotted) source for the initial paint.
  const segs = key ? key.split(".") : [];
  const stateRows = key ? getPath(ctx.comp.state.get(segs[0]), segs.slice(1)) : null;
  /** @type {unknown[]} */
  const allRows = key ? (Array.isArray(stateRows) ? stateRows : []) : baked || [];
  // Initial paint runs the same pipeline the runtime will, reading state-key
  // offset/limit from their current declared values.
  /** @param {NumArg|null} a */
  const num = (a) =>
    a ? (a.kind === "literal" ? a.value : Number(ctx.comp.state.get(a.value) ?? 0)) : null;
  const rows = pipelineRows(
    allRows,
    where,
    {
      where,
      sort,
      reverse,
      offset:
        offset && offset.kind === "key" ? { kind: "literal", value: num(offset) || 0 } : offset,
      limit:
        limit && limit.kind === "key"
          ? { kind: "literal", value: num(limit) ?? allRows.length }
          : limit,
      empty: null,
      clauseRefsState: false
    },
    ctx
  );
  /** @type {Map<string, number>} */
  const counts = new Map();
  const count = rows.length;
  // Inner ITEM-RELATIVE loop regions are filled per row by the runtime, not at
  // build time; mask them so the outer initial-paint string fill leaves their
  // pristine <template>/empty-out markup untouched, then restore.
  const { masked, regions } = maskItemLoops(itemTemplate);
  const initial = rows
    .map((/** @type {unknown} */ item, i) => {
      const itemKey = loopKeyOf(item, counts);
      const meta = { index: i, number: i + 1, first: i === 0, last: i === count - 1, count };
      return unmaskItemLoops(fillTemplateString(withLoopKey(masked, itemKey), item, meta), regions);
    })
    .join("");

  const emptyTemplate = loopEmptyTemplate(emptyLines, ctx);
  const initialOut =
    count === 0 && emptyLines
      ? compileBody(emptyLines, { ...ctx, loopMeta: true }).trim()
      : initial;

  const attrs =
    loopClauseAttrs({ where, sort, reverse, offset, limit }) +
    (baked ? ` data-wd-loop-data="${escapeHtml(JSON.stringify(baked))}"` : "");
  return `<div data-wd-loop="${escapeHtml(key || "")}"${attrs}><template data-wd-loop-template>${itemTemplate}</template>${emptyTemplate}<${wrapperTag} data-wd-loop-out>${initialOut}</${wrapperTag}></div>`;
}

/**
 * Unwrap a compiled row body into a wrapper tag + row template. A body that is a
 * single-`<li>` `<ul>`/`<ol>` becomes an `<li>` row under that list wrapper;
 * anything else is wrapped in a `<div data-wd-loop-piece>` under a `<div>`. Shared
 * by top-level reactive loops and item-relative (nested) loops.
 * @param {string} templateHtml
 * @returns {{ wrapperTag: string, itemTemplate: string }}
 */
function wrapRowTemplate(templateHtml) {
  const listMatch = templateHtml.match(/^<(ul|ol)>\s*([\s\S]*?)\s*<\/\1>$/);
  if (listMatch && (listMatch[2].match(/<li>/g) || []).length === 1) {
    return { wrapperTag: listMatch[1], itemTemplate: listMatch[2].trim() };
  }
  return { wrapperTag: "div", itemTemplate: `<div data-wd-loop-piece>${templateHtml}</div>` };
}

/**
 * Compile an `@empty` branch body into a `<template data-wd-loop-empty>` (or "" when
 * there is no empty branch). Shared by top-level and item-relative loops.
 * @param {string[] | null} emptyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
function loopEmptyTemplate(emptyLines, ctx) {
  return emptyLines
    ? `<template data-wd-loop-empty>${compileBody(emptyLines, { ...ctx, loopMeta: true }).trim()}</template>`
    : "";
}

/**
 * Serialize the shared `where`/`sort`/`reverse`/`offset`/`limit` clause config to
 * the `data-wd-loop-*` attribute string consumed by the runtime pipeline. Shared
 * by top-level reactive loops and item-relative (nested) loops.
 * @param {Pick<LoopOpts, "where" | "sort" | "reverse" | "offset" | "limit">} c
 * @returns {string}
 */
function loopClauseAttrs(c) {
  return (
    (c.where ? ` data-wd-loop-where="${escapeHtml(c.where.body)}"` : "") +
    (c.sort
      ? ` data-wd-loop-sort="${escapeHtml(c.sort.key)}" data-wd-loop-sort-dir="${c.sort.dir}"`
      : "") +
    (c.reverse ? ` data-wd-loop-reverse` : "") +
    (c.offset ? ` data-wd-loop-offset="${numArgAttr(c.offset)}"` : "") +
    (c.limit ? ` data-wd-loop-limit="${numArgAttr(c.limit)}"` : "")
  );
}

/**
 * Emit ONE level of nested reactive loop: a `@loop <outerItem>.<path> into x`
 * whose rows are read off the enclosing loop row at runtime. The region carries
 * its own row <template> + clause config but, unlike a top-level loop, its source
 * is the relative `path` (not a global state key) — `fillItem` resolves the rows
 * off the current outer item and reconciles per row. The output starts empty; the
 * runtime fills it on first render (the page already ships the runtime).
 * @param {string} path Dotted sub-path off the outer item (e.g. `items`).
 * @param {string} itemName Inner loop item name.
 * @param {string[]} bodyLines Inner loop body.
 * @param {Ctx} ctx
 * @param {Partial<LoopOpts>} opts
 * @returns {string}
 */
function itemRelativeLoop(path, itemName, bodyLines, ctx, opts) {
  /** @type {Ctx} */
  // loopKey: undefined — an item-relative loop's source is a path off the outer
  // row, not a top-level state key, so a per-row `remove` inside it has no valid
  // target and must be rejected (rather than inheriting the outer loop's key).
  const templateCtx = {
    ...ctx,
    loopItem: itemName,
    loopKey: undefined,
    loopMeta: true,
    scope: createScope(ctx.scope)
  };
  const templateHtml = compileBody(bodyLines, templateCtx).trim();

  const { wrapperTag, itemTemplate } = wrapRowTemplate(templateHtml);

  const emptyTemplate = loopEmptyTemplate(opts.empty || null, ctx);
  const attrs = loopClauseAttrs({
    where: opts.where || null,
    sort: opts.sort || null,
    reverse: opts.reverse || false,
    offset: opts.offset || null,
    limit: opts.limit || null
  });
  return `<div data-wd-loop-item="${escapeHtml(path)}"${attrs}><template data-wd-loop-template>${itemTemplate}</template>${emptyTemplate}<${wrapperTag} data-wd-loop-out></${wrapperTag}></div>`;
}

/**
 * Replace each top-level `data-wd-loop-item` region in a row template with an
 * opaque placeholder so the outer initial-paint string fill cannot reach inside
 * its pristine markup. Returns the masked string and the excised regions in order.
 * @param {string} template
 * @returns {{ masked: string, regions: string[] }}
 */
function maskItemLoops(template) {
  const marker = "<div data-wd-loop-item=";
  /** @type {string[]} */
  const regions = [];
  let masked = "";
  let i = 0;
  for (;;) {
    const start = template.indexOf(marker, i);
    if (start === -1) return { masked: masked + template.slice(i), regions };
    const end = matchElement(template, start, "div");
    masked += template.slice(i, start) + `\x00WDLI${regions.length}\x00`;
    regions.push(template.slice(start, end));
    i = end;
  }
}

/**
 * Restore the masked `data-wd-loop-item` regions into a filled row string.
 * @param {string} str
 * @param {string[]} regions
 * @returns {string}
 */
function unmaskItemLoops(str, regions) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x00 is the internal nested-loop sentinel (paired with the mask above); it cannot appear in user content.
  return regions.length ? str.replace(/\x00WDLI(\d+)\x00/g, (_, n) => regions[Number(n)]) : str;
}

/**
 * @param {string} template
 * @param {string} itemKey
 * @returns {string}
 */
function withLoopKey(template, itemKey) {
  return template.replace(
    /^<([a-zA-Z][a-zA-Z0-9-]*)/,
    `<$1 data-wd-loop-key="${escapeHtml(itemKey)}"`
  );
}

/**
 * @param {string} template
 * @param {unknown} item
 * @param {Record<string, unknown>} [meta] Per-row meta values for the initial paint.
 * @returns {string}
 */
function fillTemplateString(template, item, meta = {}) {
  // Resolve per-item :if regions first (recursively, so nested conditionals are
  // pre-rendered for the initial paint), then fill text binds and meta markers.
  return fillEachMeta(fillEachText(fillEachIfRegions(template, item, meta), item), meta);
}

/**
 * Fill `<span data-wd-each-meta="…">` markers with their per-row value.
 * @param {string} str
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function fillEachMeta(str, meta) {
  return str.replace(/<span data-wd-each-meta="([a-z]+)"><\/span>/g, (_, name) => {
    const value = name in meta ? meta[name] : "";
    return `<span data-wd-each-meta="${name}">${escapeHtml(value ?? "")}</span>`;
  });
}

// Walk the string resolving only the OUTERMOST data-wd-each-if regions; each
// chosen branch is recursed so nested conditionals resolve too. The <template>
// markup is left pristine so the runtime can keep toggling branches.
/**
 * @param {string} str
 * @param {unknown} item
 * @param {Record<string, unknown>} [meta]
 * @returns {string}
 */
function fillEachIfRegions(str, item, meta = {}) {
  const marker = "<span data-wd-each-if ";
  let result = "";
  let i = 0;
  for (;;) {
    const start = str.indexOf(marker, i);
    if (start === -1) return result + str.slice(i);
    result += str.slice(i, start);
    const end = matchElement(str, start, "span");
    result += fillOneEachIf(str.slice(start, end), item, meta);
    i = end;
  }
}

/**
 * @param {string} region
 * @param {unknown} item
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function fillOneEachIf(region, item, meta) {
  const metaMatch = region.match(/^<span data-wd-each-if data-wd-meta="([a-z]+)">/);
  const path = (region.match(/^<span data-wd-each-if data-wd-path="([^"]*)">/) || ["", ""])[1];
  const trueStart = region.indexOf("<template data-wd-if-true>");
  const trueEnd = matchElement(region, trueStart, "template");
  const falseStart = region.indexOf("<template data-wd-if-false>", trueEnd);
  const falseEnd = matchElement(region, falseStart, "template");
  const open = "<template data-wd-if-true>".length;
  const close = "</template>".length;
  const truthy = region.slice(trueStart + open, trueEnd - close);
  const falsy = region.slice(falseStart + "<template data-wd-if-false>".length, falseEnd - close);
  const test = metaMatch
    ? Boolean(meta[metaMatch[1]])
    : Boolean(getPath(item, path ? path.split(".") : []));
  const branch = test ? truthy : falsy;
  const head = region.slice(0, falseEnd);
  return `${head}<span data-wd-each-if-out>${fillEachIfRegions(branch, item, meta)}</span></span>`;
}

/**
 * @param {string} str
 * @param {unknown} item
 * @returns {string}
 */
function fillEachText(str, item) {
  return str.replace(/<span data-wd-each(?: data-wd-path="([^"]*)")?><\/span>/g, (_, p) => {
    const value = p ? getPath(item, p.split(".")) : item;
    const pathAttr = p ? ` data-wd-path="${p}"` : "";
    return `<span data-wd-each${pathAttr}>${escapeHtml(value ?? "")}</span>`;
  });
}

// Return the index just past the balanced close of the element of `tag` that
// begins at `start`. Counts nested same-tag opens/closes so regions that embed
// their own spans/templates (nested :if) match correctly.
/**
 * @param {string} str
 * @param {number} start
 * @param {string} tag
 * @returns {number}
 */
function matchElement(str, start, tag) {
  const openPrefix = `<${tag}`;
  const closeTag = `</${tag}>`;
  let depth = 0;
  let i = start;
  while (i < str.length) {
    if (
      str.startsWith(openPrefix, i) &&
      (str[i + openPrefix.length] === " " || str[i + openPrefix.length] === ">")
    ) {
      depth++;
      const gt = str.indexOf(">", i);
      i = gt === -1 ? str.length : gt + 1;
    } else if (str.startsWith(closeTag, i)) {
      depth--;
      i += closeTag.length;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return str.length;
}

/**
 * Stable per-render key for a loop row, disambiguating duplicates with `#n`.
 * @param {unknown} item
 * @param {Map<string, number>} counts Mutable seen-count accumulator.
 * @returns {string}
 */
export function loopKeyOf(item, counts) {
  const base =
    item && typeof item === "object"
      ? String(
          /** @type {Record<string, unknown>} */ (item).id ??
            /** @type {Record<string, unknown>} */ (item).key ??
            JSON.stringify(item)
        )
      : String(item);
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}
