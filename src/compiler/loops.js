// ---------------------------------------------------------------------------
// Loop pipeline: parse the `@loop` header + clauses, resolve the source (JSON
// file / in-scope value / declared :state / item-relative), and emit either a
// build-time static unroll (zero-JS) or a reactive `data-wd-loop` region whose
// row <template> + initial paint the runtime reconciles. Also the row-template
// string fill used for the initial paint (text binds, per-row `:if`, meta).
// ---------------------------------------------------------------------------

import { at, createScope, lineOf, nestedCtx, recordSymbol, wdError } from "./context.js";
import { astOf, evalAst, serializeExpr } from "./expr-ast.js";
import { applyPipeline, stagesFromAttr } from "./format.js";
import { resolveInclude } from "./includes.js";
import {
  escapeHtml,
  getPath,
  lookupPath,
  lookupVar,
  resolveStateKey,
  stripQuotes,
  unescapeHtml
} from "./interpolation.js";
import { compilePredicate, evalPredicate } from "./predicates.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Compilation} Compilation
 * @typedef {import("./context.js").Predicate} Predicate
 * @typedef {import("./context.js").NumArg} NumArg
 * @typedef {import("./context.js").LoopOpts} LoopOpts
 */

// One concrete, compilable @loop line, appended to the schematic hint so a small
// model copies a real line instead of echoing the `[…]` placeholders literally
// (the on-device finding: bracket-placeholders get pasted into source verbatim).
// Also the canonical @loop example the directive catalog + grammar draw from.
export const LOOP_EXAMPLE = "@loop /products.json into p where p.price < 50 sort by p.price asc";

// The fixed corrective suggestion shown for any malformed @loop header.
const LOOP_USAGE = `Use: @loop src into item [where …] [sort by …] [reverse] [offset N] [limit N] [paginate N] [sortable] — e.g. ${LOOP_EXAMPLE}`;

// The corrective suggestion for an expression the AST re-parser cannot read.
const EXPR_USAGE =
  'Use simpler operands — a field path, a declared :state, a plain number, or a "string".';

/**
 * Serialize an already-validated expression fragment into the compact AST
 * attribute payload the runtime reads, turning a residual parse failure into a
 * CODED compile error with `file:line` instead of the AST layer's raw internal
 * `Error`.
 *
 * `expr-ast.js` re-parses the compiler's own output, so a failure there is not
 * an author mistake and it throws a plain `Error` by design. But the operand
 * folds in `predicates.js` splice BUILD-TIME VALUES into that output, and a
 * value the fold cannot render as a readable literal escapes as an uncoded
 * `expr-ast: …` error with no file, no line, and no suggestion — the one gap in
 * the "every author-facing error carries a code" invariant. This is the seam
 * where that becomes an ordinary Darkmown compile error again.
 *
 * Lives here rather than beside its `structure.js` callers because the error-code
 * registry pins each source file to a subsystem block (`compiler/loops.js` owns
 * WD1xx), and this guard's reserved code is WD190.
 * @param {string} code Validated JS fragment over `I()`/`S()`/`C()`/`A()`.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the directive that owns it.
 * @param {string} what Directive label for the message, e.g. `":if"`.
 * @returns {any[]} The parsed AST.
 */
export function astAt(code, ctx, index, what) {
  try {
    return astOf(code);
  } catch {
    throw wdError(
      `${what} expression in ${at(ctx, index)} could not be compiled: "${code}". ${EXPR_USAGE}`,
      {
        code: "WD190",
        file: ctx.file,
        line: lineOf(ctx, index),
        hint: EXPR_USAGE.slice("Use ".length)
      }
    );
  }
}

/**
 * `JSON.stringify(astAt(…))` — the attribute payload, with the same coded error.
 * @param {string} code
 * @param {Ctx} ctx
 * @param {number} index
 * @param {string} what
 * @returns {string}
 */
export const serializeExprAt = (code, ctx, index, what) =>
  JSON.stringify(astAt(code, ctx, index, what));

/**
 * Parse the optional clause tail of a `@loop` header in FIXED order:
 * `[where P] [sort by key [asc|desc]] [reverse] [offset N] [limit N] [paginate N] [sortable]`.
 * @param {string} tail Everything after `@loop src into item`.
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ where: string|null, sort: import("./context.js").LoopOpts["sort"], reverse: boolean, offset: NumArg|null, limit: NumArg|null, refsState: boolean, sortable: boolean, paginate: number|null }}
 */
function parseLoopClauses(tail, itemName, ctx) {
  // Peel clauses off the END in reverse fixed-order (limit, offset, reverse,
  // sort by). Parsing from the tail avoids mistaking a state operand named
  // `limit`/`offset` inside the `where` predicate for a clause keyword. Whatever
  // remains must be `where …` (or empty); a clause keyword surviving in the
  // remainder means the author wrote the clauses out of order.
  let s = tail.trim();
  /** @type {import("./context.js").LoopOpts["sort"]} */ let sort = null;
  let reverse = false;
  /** @type {NumArg|null} */ let offset = null;
  /** @type {NumArg|null} */ let limit = null;
  let refsState = false;
  let sortable = false;
  /** @type {number|null} */ let paginate = null;
  /** @returns {never} */
  const bad = () => {
    throw wdError(`Malformed @loop clause in ${ctx.file}: "${tail.trim()}". ${LOOP_USAGE}`, {
      code: "WD102",
      file: ctx.file
    });
  };

  // `sortable` is a position-independent flag (drag-reorder); peel it wherever it
  // sits so the rest of the fixed-order parse is unaffected. handleLoop rejects it
  // when combined with where/sort/reverse/offset/limit.
  const sm = s.match(/(^|\s)sortable(?=\s|$)/);
  if (sm) {
    sortable = true;
    s = (s.slice(0, sm.index) + s.slice((sm.index ?? 0) + sm[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

  // `paginate N` slices the listing into static pages. Peel it position-
  // independently (like `sortable`) so `paginate 2 limit 1` parses and handleLoop
  // can reject the combination with a precise message rather than failing the
  // fixed-order parse. The count is a positive integer literal — paginating "by a
  // state value" makes no sense for a build-time route split.
  const pm = s.match(/(^|\s)paginate\s+(\d+)(?=\s|$)/);
  if (pm) {
    paginate = Number(pm[2]);
    if (paginate < 1) bad();
    s = (s.slice(0, pm.index) + s.slice((pm.index ?? 0) + pm[0].length))
      .replace(/\s+/g, " ")
      .trim();
  }

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

  // The field and direction may each be a literal (`post.date` / `asc|desc`) or a
  // `{ state }` reference, which makes the sort reactive (clickable-header tables).
  m = s.match(
    /(^|\s)sort\s+by\s+(\{\s*[A-Za-z_$][\w$]*\s*\}|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s+(\{\s*[A-Za-z_$][\w$]*\s*\}|asc|desc))?$/
  );
  if (m) {
    sort = parseSortClause(m[2], m[3], itemName, ctx);
    if (sort.keyKind === "key" || sort.dirKind === "key") refsState = true;
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
  return { where, sort, reverse, offset, limit, refsState, sortable, paginate };
}

/**
 * Parse the `sort by` field + optional direction. Each is a literal (an
 * item-relative field path / `asc|desc`) or a `{ state }` reference; a reference
 * resolves to a declared `:state`/`:store` key and makes the sort reactive.
 * @param {string} fieldTok
 * @param {string | undefined} dirTok
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ key: string, keyKind: "literal" | "key", dir: string, dirKind: "literal" | "key" }}
 */
function parseSortClause(fieldTok, dirTok, itemName, ctx) {
  /** @param {string} tok */
  const stateRef = (tok) => tok.match(/^\{\s*([A-Za-z_$][\w$]*)\s*\}$/);

  /** @type {string} */ let key;
  /** @type {"literal" | "key"} */ let keyKind;
  const fieldState = stateRef(fieldTok);
  if (fieldState) {
    const resolved = resolveStateKey(fieldState[1], ctx);
    if (!resolved)
      throw wdError(
        `@loop sort by { ${fieldState[1]} } references unknown :state/:store in ${ctx.file}. ${LOOP_USAGE}`,
        { code: "WD103", file: ctx.file }
      );
    key = resolved;
    keyKind = "key";
  } else {
    const segs = fieldTok.split(".");
    if (segs[0] !== itemName)
      throw wdError(
        `@loop sort key "${fieldTok}" must start with the loop item "${itemName}" in ${ctx.file}. ${LOOP_USAGE}`,
        { code: "WD104", file: ctx.file }
      );
    const rest = segs.slice(1);
    if (rest.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg)))
      throw wdError(`Sort key "${fieldTok}" is not allowed in @loop (${ctx.file})`, {
        code: "WD105",
        file: ctx.file
      });
    key = rest.join(".");
    keyKind = "literal";
  }

  /** @type {string} */ let dir = "asc";
  /** @type {"literal" | "key"} */ let dirKind = "literal";
  if (dirTok) {
    const dirState = stateRef(dirTok);
    if (dirState) {
      const resolved = resolveStateKey(dirState[1], ctx);
      if (!resolved)
        throw wdError(
          `@loop sort direction { ${dirState[1]} } references unknown :state/:store in ${ctx.file}. ${LOOP_USAGE}`,
          { code: "WD106", file: ctx.file }
        );
      dir = resolved;
      dirKind = "key";
    } else {
      dir = dirTok;
    }
  }
  return { key, keyKind, dir, dirKind };
}

/**
 * @param {string} tok
 * @param {Ctx} ctx
 * @returns {NumArg}
 */
function parseNumArg(tok, ctx) {
  // Callers (parseLoopClauses) only ever pass a token the clause regex already
  // constrained to `\d+` or an identifier, so the two branches below are
  // exhaustive — a bare integer literal, or a name that must resolve to :state.
  if (/^\d+$/.test(tok)) return { kind: "literal", value: Number(tok) };
  const key = resolveStateKey(tok, ctx);
  if (!key)
    throw wdError(
      `@loop offset/limit "${tok}" in ${ctx.file} is neither a non-negative integer nor a declared :state. ${LOOP_USAGE}`,
      { code: "WD107", file: ctx.file }
    );
  return { kind: "key", value: key };
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
 * @param {number} index 0-based line index of the `@loop` opener.
 * @param {number} [emptyStart] 0-based index the empty branch starts at within
 *   the loop body, so its nested errors report the true file line.
 * @returns {string}
 */
export function handleLoop(line, bodyLines, emptyLines, ctx, index, emptyStart = 0) {
  const match = line.match(/^@loop\s+(.+?)\s+into\s+([A-Za-z_$][\w$]*)(\s+.+?)?\s*$/);
  if (!match)
    throw wdError(`Malformed @loop in ${at(ctx, index)}: ${line}. ${LOOP_USAGE}`, {
      code: "WD101",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint: LOOP_USAGE.slice("Use: ".length),
      example: LOOP_EXAMPLE
    });
  const source = stripQuotes(match[1].trim());
  const itemName = match[2];
  const clauses = match[3]
    ? parseLoopClauses(match[3], itemName, ctx)
    : {
        where: null,
        sort: null,
        reverse: false,
        offset: null,
        limit: null,
        refsState: false,
        sortable: false,
        paginate: null
      };
  const where = clauses.where ? compilePredicate(clauses.where, itemName, ctx) : null;
  // `sortable` reorders the list directly, so it can't combine with a clause that
  // re-derives the visible order (where/sort/reverse) or shows a partial view
  // (offset/limit/paginate) — those would break the 1:1 DOM↔array index mapping.
  if (
    clauses.sortable &&
    (where ||
      clauses.sort ||
      clauses.reverse ||
      clauses.offset ||
      clauses.limit ||
      clauses.paginate)
  ) {
    throw wdError(
      `@loop sortable cannot combine with where/sort/reverse/offset/limit/paginate in ${ctx.file}. ${LOOP_USAGE}`,
      { code: "WD108", file: ctx.file }
    );
  }
  // `paginate N` OWNS the page slice, so an explicit offset/limit alongside it is
  // a conflict (which one wins?). Reject it with a clear hint rather than silently
  // letting one override the other.
  if (clauses.paginate && (clauses.offset || clauses.limit)) {
    throw wdError(
      `@loop paginate cannot combine with offset/limit in ${ctx.file} — paginate already slices each page. ${LOOP_USAGE}`,
      { code: "WD109", file: ctx.file }
    );
  }
  /** @type {LoopOpts} */
  const opts = {
    where,
    sort: clauses.sort,
    reverse: clauses.reverse,
    offset: clauses.offset,
    limit: clauses.limit,
    empty: emptyLines,
    emptyStart,
    clauseRefsState: clauses.refsState,
    sortable: clauses.sortable,
    paginate: clauses.paginate
  };
  // Stamped by whichever branch below resolves the source. `reactive` is the one
  // fact a tool layer cannot recover from the source text alone, and it is the
  // fact that decides whether the page ships the runtime.
  const loopSymbol = recordSymbol(ctx, index, {
    kind: "loop",
    name: itemName,
    detail: line.replace(/^@loop\s+/, "@loop "),
    reactive: Boolean((where && where.refsState) || clauses.refsState)
  });
  // The loop body starts on the line after the opener; nested errors in it (and
  // in the empty branch, via `opts.emptyStart`) report the true file line. The
  // opener's location rides on the body ctx so a reactive loop nested inside this
  // one can point the depth error back at its own opener line.
  const bodyCtx = {
    ...nestedCtx(ctx, index + 1),
    loopOpener: { at: at(ctx, index), line: line.trim() }
  };

  if (
    source.startsWith("/") ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.endsWith(".json")
  ) {
    if (opts.paginate) throw paginateOnlyCollections(ctx);
    const dataFile = resolveInclude(
      source,
      ctx.file,
      ctx.context,
      true,
      at(ctx, index),
      ctx.comp.reader
    );
    ctx.comp.deps.add(dataFile);
    const rows = JSON.parse(ctx.comp.reader.readText(dataFile));
    if (!Array.isArray(rows))
      throw wdError(`@loop data must be a JSON array: ${dataFile}`, {
        code: "WD111",
        file: ctx.file
      });
    return loopOverData(rows, itemName, bodyLines, bodyCtx, opts);
  }

  const resolved = lookupPath(source, ctx);
  if (resolved.found) {
    if (opts.paginate) throw paginateOnlyCollections(ctx);
    // A missing/unset field (e.g. an optional frontmatter key) is an EMPTY
    // list, not an error — the `@empty` branch renders, matching the runtime.
    if (resolved.value === null || resolved.value === undefined) {
      return loopOverData([], itemName, bodyLines, bodyCtx, opts);
    }
    if (!Array.isArray(resolved.value)) {
      throw wdError(
        `@loop ${source} in ${at(ctx, index)} found an in-scope value, but it is not a list ` +
          `(got ${typeof resolved.value}). Use: a list value (e.g. \`tags: [a, b]\` in frontmatter) — ` +
          `or leave the field out entirely, which loops zero rows and renders the @empty branch.`,
        { code: "WD112", file: ctx.file, line: lineOf(ctx, index) }
      );
    }
    return loopOverData(resolved.value, itemName, bodyLines, bodyCtx, opts);
  }

  // A bare name OR a dotted path resolving to declared :state (e.g. team.members).
  const segs = source.split(".");
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(source)) {
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw wdError(`@loop source "${source}" is not allowed in ${ctx.file}`, {
        code: "WD113",
        file: ctx.file
      });
    }
    const key = resolveStateKey(segs[0], ctx);
    if (key) {
      if (opts.paginate) throw paginateOnlyCollections(ctx);
      const fullKey = segs.length > 1 ? `${key}.${segs.slice(1).join(".")}` : key;
      loopSymbol.reactive = true;
      loopSymbol.name = itemName;
      loopSymbol.target = fullKey;
      return reactiveLoop(fullKey, itemName, bodyLines, bodyCtx, opts);
    }
    // A bare name matching a collection (any `site/pages/<name>/` subdir) resolves
    // to its entry rows at build time and static-unrolls — zero JS. This is checked
    // after state so a declared `:state` of the same name still wins.
    const collection = segs.length === 1 ? ctx.comp.collections.get(source) : undefined;
    if (collection) {
      ctx.comp.collectionsUsed.add(source);
      return loopOverCollection(collection, source, itemName, bodyLines, bodyCtx, opts);
    }
    // Inside a reactive loop, `@loop <outerItem>.<path> into x` loops a field of
    // the enclosing row item — an ITEM-RELATIVE loop the runtime fills per row.
    if (ctx.loopItem && segs[0] === ctx.loopItem && segs.length > 1) {
      if (opts.sortable) {
        throw wdError(
          `@loop sortable is not supported on a nested (item-relative) loop in ${ctx.file}. ${LOOP_USAGE}`,
          { code: "WD114", file: ctx.file }
        );
      }
      if (opts.paginate) throw paginateOnlyCollections(ctx);
      loopSymbol.reactive = true;
      return itemRelativeLoop(segs.slice(1).join("."), itemName, bodyLines, bodyCtx, opts);
    }
  }

  throw unresolvedSourceError(source, ctx);
}

/**
 * The "source not found" error for an unresolved `@loop` bare name. Lists the
 * valid collection names (the `site/pages/<name>/` subdirs) so a typo'd
 * collection reference is immediately actionable.
 * @param {string} source
 * @param {Ctx} ctx
 * @returns {Error}
 */
function unresolvedSourceError(source, ctx) {
  const names = [...ctx.comp.collections.keys()].sort();
  const collectionsHint = names.length ? ` Available collections: ${names.join(", ")}.` : "";
  return wdError(
    `@loop source "${source}" in ${ctx.file} was not found. Loop over a collection ` +
      `(a site/pages/<name>/ subdirectory, by its bare name), a JSON file ` +
      `(@loop /data.json into row), an in-scope value, or a :state list.${collectionsHint}`,
    { code: "WD115", file: ctx.file }
  );
}

/**
 * The error for `paginate` on a non-collection source: pagination multiplies
 * static routes, which only makes sense for a build-time collection listing.
 * @param {Ctx} ctx
 * @returns {Error}
 */
function paginateOnlyCollections(ctx) {
  return wdError(
    `@loop paginate requires a collection source (a site/pages/<name>/ subdirectory) in ${ctx.file}. ${LOOP_USAGE}`,
    { code: "WD110", file: ctx.file }
  );
}

/**
 * Reject a reactive `@loop` that would open a THIRD reactive nesting level. The
 * runtime reconciles at most two nested `data-wd-loop` levels (an outer loop and
 * one inner loop); a third level's `data-wd-loop-out` paints empty. This guards
 * every reactive-region entry point ({@link reactiveLoop}, {@link itemRelativeLoop}),
 * so a state-key, item-relative, or state-filtered source is all covered. Static
 * (build-unrolled) loops carry the depth through without incrementing it, so an
 * interleaved static level neither triggers nor masks the limit.
 * `ctx.reactiveDepth` is the number of reactive loops already enclosing this one.
 * @param {Ctx} ctx
 * @returns {void}
 */
function assertReactiveDepth(ctx) {
  if ((ctx.reactiveDepth ?? 0) < 2) return;
  const opener = ctx.loopOpener ?? { at: ctx.file, line: "" };
  throw wdError(
    `Reactive @loop nesting is limited to one inner level in ${opener.at}: "${opener.line}". ` +
      `Unroll the outer data at build time (JSON/frontmatter source) or move the innermost list into build-time data.`,
    { code: "WD116", file: ctx.file }
  );
}

/**
 * Loop over a build-time collection's entry rows. With no `paginate`, this is a
 * plain static unroll (filter/sort/reverse/offset/limit at build time, zero JS).
 * With `paginate N`, it records the pagination intent (so the builder multiplies
 * routes), then renders only the current page's slice using the injected `page`
 * pager — `offset = (page.current - 1) * N`, `limit = N`.
 * @param {import("./collections.js").CollectionRow[]} rows
 * @param {string} name Collection name, for the pagination record.
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {LoopOpts} opts
 * @returns {string}
 */
function loopOverCollection(rows, name, itemName, bodyLines, ctx, opts) {
  if (!opts.paginate) {
    // No pagination → behave exactly like a JSON-file/in-scope source: a pure
    // listing static-unrolls (zero JS); a `where` that reads :state turns it into
    // a reactive baked-rows loop. `loopOverData` makes that call.
    return loopOverData(rows, itemName, bodyLines, ctx, opts);
  }
  // Count rows AFTER where/sort/reverse but BEFORE the page slice, so `total`
  // reflects what the reader will actually page through. Reuse pipelineRows with
  // offset/limit stripped for the count.
  const filtered = pipelineRows(rows, opts.where, { ...opts, offset: null, limit: null }, ctx);
  const perPage = opts.paginate;
  const total = Math.max(1, Math.ceil(filtered.length / perPage));
  ctx.comp.pagination = { perPage, total, collection: name };
  // `page.current` is the 1-based page the builder is rendering (it seeds the
  // document scope). Slice this page out of the already-filtered/sorted list.
  const current = currentPage(ctx);
  const start = (current - 1) * perPage;
  return staticUnroll(
    filtered.slice(start, start + perPage),
    itemName,
    bodyLines,
    ctx,
    opts.empty,
    opts.emptyStart
  );
}

/**
 * The 1-based page the builder is currently rendering, read from the injected
 * `page.current` scope var. Defaults to page 1 (the discovery compile, before the
 * builder knows the total, runs with `page.current = 1`).
 * @param {Ctx} ctx
 * @returns {number}
 */
function currentPage(ctx) {
  const page = lookupVar(ctx.scope, "page");
  if (page.found && page.value && typeof page.value === "object") {
    const current = /** @type {Record<string, unknown>} */ (page.value).current;
    if (typeof current === "number" && current >= 1) return current;
  }
  return 1;
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
        // The index tiebreaker keeps EQUAL rows in source order, so it must not
        // be flipped with the comparator: `(c || tie) * dir` negated the tie too
        // and made `desc` unstable, reversing runs of equal keys.
        return c ? c * dir : a.index - b.index;
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
  if (opts.sortable) {
    throw wdError(
      `@loop sortable requires a :state or :store list to reorder, not a JSON file or in-scope value, in ${ctx.file}. ${LOOP_USAGE}`,
      { code: "WD117", file: ctx.file }
    );
  }
  // Reactive when the where reads state OR an offset/limit references a state key.
  const reactive = (opts.where && opts.where.refsState) || opts.clauseRefsState;
  if (reactive) return reactiveLoop(null, itemName, bodyLines, ctx, { ...opts, data: rows });
  return staticUnroll(
    pipelineRows(rows, opts.where, opts, ctx),
    itemName,
    bodyLines,
    ctx,
    opts.empty,
    opts.emptyStart
  );
}

/**
 * @param {unknown[]} rows
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {string[] | null} [empty] Empty-branch body, rendered when 0 rows.
 * @param {number} [emptyStart] 0-based index the empty branch starts at within
 *   the loop body, so its nested errors report the true file line.
 * @returns {string}
 */
function staticUnroll(rows, itemName, bodyLines, ctx, empty = null, emptyStart = 0) {
  if (rows.length === 0 && empty)
    return ctx.compileBody(empty, { ...nestedCtx(ctx, emptyStart), loopMeta: true });
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
    out.push(ctx.compileBody(bodyLines, rowCtx));
  }
  return joinRows(out);
}

// The block tags a static unroll stitches back together across a row seam. Each
// row body is compiled as its OWN markdown document, so a row whose body is a
// list item closes its own `<ul>`/`<ol>` and a row whose body is a table closes
// its own `<table>`: `- { p.name }` over three rows produced three separate
// lists, `1. { p.name }` produced three lists each numbered 1, and a table body
// produced three tables. Splicing at the seam gives the ONE list / ONE correctly
// numbered list / ONE table an author wrote.
const SEAM_TAGS = ["ul", "ol"];

/**
 * Join the compiled row bodies of a static unroll, splicing a block that a row
 * seam split in two back into one element. A seam that does not match any
 * mergeable shape falls back to the plain `"\n"` join the unroll always used, so
 * every other body shape emits byte-identical HTML.
 * @param {string[]} parts Compiled HTML, one entry per row.
 * @returns {string}
 */
function joinRows(parts) {
  if (!parts.length) return "";
  let html = parts[0];
  for (let i = 1; i < parts.length; i++) html = spliceRow(html, parts[i]);
  return html;
}

/**
 * Splice one row's HTML onto the accumulated output at their shared seam.
 * @param {string} prev Everything emitted so far.
 * @param {string} next The next row's compiled HTML.
 * @returns {string}
 */
function spliceRow(prev, next) {
  const left = prev.trimEnd();
  const right = next.trimStart();
  for (const tag of SEAM_TAGS) {
    if (left.endsWith(`</${tag}>`) && right.startsWith(`<${tag}>`)) {
      return `${left.slice(0, -(tag.length + 3)).trimEnd()}\n${right.slice(tag.length + 2).trimStart()}`;
    }
  }
  return spliceTable(left, right) ?? `${prev}\n${next}`;
}

/**
 * Splice two single-row tables into one by concatenating their `<tbody>`
 * contents. Only when both carry the SAME markup before `<tbody>`: a header that
 * interpolates the row is genuinely a table per row, and merging would drop it.
 * @param {string} left
 * @param {string} right
 * @returns {string | null} The spliced HTML, or null when they do not merge.
 */
function spliceTable(left, right) {
  if (!left.endsWith("</table>") || !right.startsWith("<table>")) return null;
  const rightBody = right.indexOf("<tbody>");
  const leftBody = left.lastIndexOf("</tbody>");
  if (rightBody === -1 || leftBody === -1) return null;
  if (left.slice(0, left.indexOf("<tbody>")) !== right.slice(0, rightBody)) return null;
  const head = left.slice(0, leftBody).trimEnd();
  const tail = right.slice(rightBody + "<tbody>".length).trimStart();
  return `${head}\n${tail}`;
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
  assertReactiveDepth(ctx);
  ctx.comp.assets.runtime = true;
  /** @type {Ctx} */
  const templateCtx = {
    ...ctx,
    loopItem: itemName,
    loopKey: key ?? undefined,
    loopMeta: true,
    reactiveDepth: (ctx.reactiveDepth ?? 0) + 1,
    scope: createScope(ctx.scope)
  };
  const templateHtml = ctx.compileBody(bodyLines, templateCtx).trim();

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
  // A reactive `sort by { field }` / `{ dir }` carries the resolved STATE KEY in
  // `sort.key`/`sort.dir`, not a field path and not `asc`/`desc` — the runtime
  // reads the current value per render. The initial paint has to resolve it the
  // same way (exactly as `num()` already does for a state-keyed offset/limit),
  // or the key is used as a literal field path (which no row has), the direction
  // never equals "desc", and the pre-hydration HTML ships in source order and
  // visibly reorders the moment the runtime boots.
  const initialSort = sort
    ? {
        ...sort,
        key: sort.keyKind === "key" ? String(ctx.comp.state.get(sort.key) ?? "") : sort.key,
        dir: sort.dirKind === "key" ? String(ctx.comp.state.get(sort.dir) ?? "asc") : sort.dir
      }
    : null;
  const rows = pipelineRows(
    allRows,
    where,
    {
      where,
      sort: initialSort,
      reverse,
      offset:
        offset && offset.kind === "key" ? { kind: "literal", value: num(offset) || 0 } : offset,
      limit:
        limit && limit.kind === "key"
          ? { kind: "literal", value: num(limit) ?? allRows.length }
          : limit,
      empty: null,
      clauseRefsState: false,
      sortable: false,
      paginate: null
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
      return unmaskItemLoops(
        fillTemplateString(withLoopKey(masked, itemKey), item, meta, ctx.comp),
        regions
      );
    })
    .join("");

  const emptyTemplate = loopEmptyTemplate(emptyLines, ctx, opts?.emptyStart);
  const initialOut =
    count === 0 && emptyLines
      ? ctx
          .compileBody(emptyLines, { ...nestedCtx(ctx, opts?.emptyStart ?? 0), loopMeta: true })
          .trim()
      : initial;

  // `sortable` tags the region for the drag-reorder behavior (emitted only here)
  // and points it at the state key whose list it rewrites on drop.
  const sortable = opts?.sortable || false;
  if (sortable && key) ctx.comp.assets.behaviors.add("sortable");
  const attrs =
    loopClauseAttrs({ where, sort, reverse, offset, limit }) +
    (baked ? ` data-wd-loop-data="${escapeHtml(JSON.stringify(baked))}"` : "") +
    (sortable && key ? ` data-wd-sortable="${escapeHtml(key)}"` : "");
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
 * @param {number} [emptyStart] 0-based index the empty branch starts at within
 *   the loop body, so its nested errors report the true file line.
 * @returns {string}
 */
function loopEmptyTemplate(emptyLines, ctx, emptyStart = 0) {
  return emptyLines
    ? `<template data-wd-loop-empty>${ctx.compileBody(emptyLines, { ...nestedCtx(ctx, emptyStart), loopMeta: true }).trim()}</template>`
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
    (c.where ? ` data-wd-loop-where="${escapeHtml(serializeExpr(c.where.body))}"` : "") +
    (c.sort
      ? ` data-wd-loop-sort="${escapeHtml(c.sort.keyKind === "key" ? `key:${c.sort.key}` : c.sort.key)}" data-wd-loop-sort-dir="${escapeHtml(c.sort.dirKind === "key" ? `key:${c.sort.dir}` : c.sort.dir)}"`
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
  assertReactiveDepth(ctx);
  /** @type {Ctx} */
  // loopKey: undefined — an item-relative loop's source is a path off the outer
  // row, not a top-level state key, so a per-row `remove` inside it has no valid
  // target and must be rejected (rather than inheriting the outer loop's key).
  const templateCtx = {
    ...ctx,
    loopItem: itemName,
    loopKey: undefined,
    loopMeta: true,
    reactiveDepth: (ctx.reactiveDepth ?? 0) + 1,
    scope: createScope(ctx.scope)
  };
  const templateHtml = ctx.compileBody(bodyLines, templateCtx).trim();

  const { wrapperTag, itemTemplate } = wrapRowTemplate(templateHtml);

  const emptyTemplate = loopEmptyTemplate(opts.empty || null, ctx, opts.emptyStart);
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
 * @param {Record<string, unknown>} meta Per-row meta values for the initial paint.
 * @param {Compilation} comp Declared state, for a per-row `:if` predicate that
 *   also reads `:state`/`:store`.
 * @returns {string}
 */
function fillTemplateString(template, item, meta, comp) {
  // Resolve per-item :if regions first (recursively, so nested conditionals are
  // pre-rendered for the initial paint), then fill text binds and meta markers.
  return fillEachMeta(fillEachText(fillEachIfRegions(template, item, meta, comp), item), meta);
}

/**
 * Fill `<span data-wd-each-meta="…">` markers with their per-row value.
 * @param {string} str
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function fillEachMeta(str, meta) {
  return str.replace(
    /<span data-wd-each-meta="([a-z]+)"(?: data-wd-fmt="([^"]*)")?><\/span>/g,
    (_, name, fmt) => {
      let value = name in meta ? meta[name] : "";
      if (fmt) value = applyPipeline(value, stagesFromAttr(unescapeHtml(fmt)));
      const fmtAttr = fmt ? ` data-wd-fmt="${fmt}"` : "";
      return `<span data-wd-each-meta="${name}"${fmtAttr}>${escapeHtml(value ?? "")}</span>`;
    }
  );
}

// Walk the string resolving only the OUTERMOST data-wd-each-if regions; each
// chosen branch is recursed so nested conditionals resolve too. The <template>
// markup is left pristine so the runtime can keep toggling branches.
/**
 * @param {string} str
 * @param {unknown} item
 * @param {Record<string, unknown>} meta
 * @param {Compilation} comp
 * @returns {string}
 */
function fillEachIfRegions(str, item, meta, comp) {
  const marker = "<span data-wd-each-if ";
  let result = "";
  let i = 0;
  for (;;) {
    const start = str.indexOf(marker, i);
    if (start === -1) return result + str.slice(i);
    result += str.slice(i, start);
    const end = matchElement(str, start, "span");
    result += fillOneEachIf(str.slice(start, end), item, meta, comp);
    i = end;
  }
}

/**
 * @param {string} region
 * @param {unknown} item
 * @param {Record<string, unknown>} meta
 * @param {Compilation} comp
 * @returns {string}
 */
function fillOneEachIf(region, item, meta, comp) {
  const metaMatch = region.match(/^<span data-wd-each-if data-wd-meta="([a-z]+)">/);
  // A per-row `:if` with an OPERATOR (`:if r.qty > 1`) ships its condition as a
  // serialized AST, not a path — the same payload the runtime walks. Without
  // this branch the path fell back to "", `getPath(item, [])` handed back the
  // row object, and `Boolean(row)` was true for every row: every operator `:if`
  // in every reactive loop shipped its TRUE branch in the pre-hydration HTML,
  // which is what a crawler and a no-JS reader see.
  const exprMatch = region.match(/^<span data-wd-each-if data-wd-if-expr="([^"]*)">/);
  const path = (region.match(/^<span data-wd-each-if data-wd-path="([^"]*)">/) || ["", ""])[1];
  const trueStart = region.indexOf("<template data-wd-if-true>");
  const trueEnd = matchElement(region, trueStart, "template");
  const falseStart = region.indexOf("<template data-wd-if-false>", trueEnd);
  const falseEnd = matchElement(region, falseStart, "template");
  const open = "<template data-wd-if-true>".length;
  const close = "</template>".length;
  const truthy = region.slice(trueStart + open, trueEnd - close);
  const falsy = region.slice(falseStart + "<template data-wd-if-false>".length, falseEnd - close);
  let test;
  if (exprMatch) {
    // The compiler serialized this AST itself, so the parse cannot fail; the
    // walk is the same closed evaluator the runtime uses, so the initial paint
    // and the first render agree.
    test = Boolean(evalAst(JSON.parse(unescapeHtml(exprMatch[1])), item, comp));
  } else if (metaMatch) {
    test = Boolean(meta[metaMatch[1]]);
  } else {
    test = Boolean(getPath(item, path ? path.split(".") : []));
  }
  const branch = test ? truthy : falsy;
  const head = region.slice(0, falseEnd);
  return `${head}<span data-wd-each-if-out>${fillEachIfRegions(branch, item, meta, comp)}</span></span>`;
}

/**
 * @param {string} str
 * @param {unknown} item
 * @returns {string}
 */
function fillEachText(str, item) {
  return str.replace(
    /<span data-wd-each(?: data-wd-path="([^"]*)")?(?: data-wd-fmt="([^"]*)")?><\/span>/g,
    (_, p, fmt) => {
      let value = p ? getPath(item, p.split(".")) : item;
      if (fmt) value = applyPipeline(value, stagesFromAttr(unescapeHtml(fmt)));
      const pathAttr = p ? ` data-wd-path="${p}"` : "";
      const fmtAttr = fmt ? ` data-wd-fmt="${fmt}"` : "";
      return `<span data-wd-each${pathAttr}${fmtAttr}>${escapeHtml(value ?? "")}</span>`;
    }
  );
}

// Return the index just past the balanced close of the element of `tag` that
// begins at `start`. Counts nested same-tag opens/closes so regions that embed
// their own spans/templates (nested :if) match correctly. Falls back to the end
// of the string for an unbalanced (never-closed) region — defensive, since the
// compiler only feeds it its own balanced output. Exported for that contract to
// be unit-tested directly.
/**
 * @param {string} str
 * @param {number} start
 * @param {string} tag
 * @returns {number}
 */
export function matchElement(str, start, tag) {
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
  const raw =
    item && typeof item === "object"
      ? String(
          /** @type {Record<string, unknown>} */ (item).id ??
            /** @type {Record<string, unknown>} */ (item).key ??
            JSON.stringify(item)
        )
      : String(item);
  // Escape every literal `#` in the value BEFORE the `#n` disambiguator is
  // appended, so a real key can never be mistaken for a duplicate suffix. A row
  // with `id: "a#1"` and the second row with `id: "a"` both serialized to `a#1`,
  // and because the runtime's reuse Map is keyed on this attribute the collision
  // made a 3-item list grow a row on every render, unbounded.
  const base = raw.replace(/#/g, "##");
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}
