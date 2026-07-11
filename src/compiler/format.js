// ---------------------------------------------------------------------------
// Format pipes — the value layer. `{ value | name:arg:arg | name2 }` runs a
// resolved value through a whitelist of formatters; `{ list | sum:"price" }`
// aggregates a list. The same formatter math is mirrored, compactly, in
// src/runtime.js for the reactive path — tests/format.test.js + the compile↔
// runtime parity test guard against drift. Nothing here is eval'd: pipe stages
// are a fixed, compile-time-validated registry, exactly like the predicate and
// action grammars.
//
// Folds at build time when the piped value is static (zero-JS); a value that
// reads :state/:store emits `data-wd-fmt` and re-formats in the runtime.
// ---------------------------------------------------------------------------

/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {{ name: string, args: Array<string | number | boolean | null> }} Stage
 */

// --- shared math (kept tiny and mirrored in the runtime) -------------------

/** @param {unknown} v @returns {number} */
const toNum = (v) => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};
/** @param {unknown} v @returns {any[]} */
const toList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
/** Read one shallow field off a row, or the row itself when no field is given. */
const pick = (/** @type {any} */ row, /** @type {string} */ f) =>
  f != null && f !== "" ? (row == null ? undefined : row[f]) : row;
/** @param {any[]} list @param {string} f @returns {number[]} */
const nums = (list, f) => list.map((row) => toNum(pick(row, f)));

/**
 * Coerce ISO strings, epoch milliseconds (number or numeric string), or a Date
 * into a Date. Returns an invalid Date for unparseable input (formatters guard).
 * @param {unknown} v
 * @returns {Date}
 */
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const s = String(v).trim();
  return /^-?\d+$/.test(s) ? new Date(Number(s)) : new Date(s);
}

/** @param {Date} d @param {Intl.DateTimeFormatOptions} opts @param {string} fallback */
const fmtDate = (d, opts, fallback) =>
  Number.isNaN(d.getTime()) ? String(fallback) : new Intl.DateTimeFormat(undefined, opts).format(d);

/**
 * A date-ONLY ISO string (`2026-06-22`, no time) parses as UTC midnight, so
 * formatting it in the build machine's local zone can shift the calendar date a
 * day (e.g. `Jun 21` west of UTC). Format those in UTC so the output is
 * deterministic and matches the written date; full datetimes keep local behavior.
 * @param {unknown} v
 * @returns {{ timeZone: "UTC" } | undefined}
 */
const dateOnlyTZ = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? { timeZone: "UTC" } : undefined;

// --- aggregates (shared by pipes and `:computed`) --------------------------

/** @type {Record<string, (list: any[], field?: string) => number>} */
export const AGGREGATES = {
  sum: (list, f) => nums(list, f || "").reduce((a, n) => a + n, 0),
  avg: (list, f) => (list.length ? AGGREGATES.sum(list, f) / list.length : 0),
  min: (list, f) => (list.length ? Math.min(...nums(list, f || "")) : 0),
  max: (list, f) => (list.length ? Math.max(...nums(list, f || "")) : 0),
  count: (list) => list.length
};

// --- the formatter registry ------------------------------------------------

/**
 * The whitelist. Each formatter is a pure function of (value, args) — no clock,
 * no DOM, no globals beyond `Intl` — so a static value folds deterministically at
 * build time and a reactive value formats identically in the browser.
 * @type {Record<string, (value: any, args: any[]) => string | number>}
 */
export const FORMATTERS = {
  // numbers / money
  money: (v, [currency = "USD", locale]) =>
    new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: String(currency || "USD")
    }).format(toNum(v)),
  number: (v, [dec]) =>
    new Intl.NumberFormat(
      undefined,
      dec == null ? {} : { minimumFractionDigits: +dec, maximumFractionDigits: +dec }
    ).format(toNum(v)),
  percent: (v, [dec = 0]) =>
    new Intl.NumberFormat(undefined, {
      style: "percent",
      minimumFractionDigits: +dec,
      maximumFractionDigits: +dec
    }).format(toNum(v)),
  round: (v, [dec = 0]) => {
    const p = 10 ** +dec;
    return Math.round(toNum(v) * p) / p;
  },
  // dates (format a given instant — pure, no "now"; date-only strings in UTC)
  date: (v, [style = "medium"]) =>
    fmtDate(toDate(v), { dateStyle: /** @type {any} */ (style), ...dateOnlyTZ(v) }, v),
  time: (v, [style = "short"]) =>
    fmtDate(toDate(v), { timeStyle: /** @type {any} */ (style), ...dateOnlyTZ(v) }, v),
  datetime: (v, [ds = "medium", ts = "short"]) =>
    fmtDate(
      toDate(v),
      { dateStyle: /** @type {any} */ (ds), timeStyle: /** @type {any} */ (ts), ...dateOnlyTZ(v) },
      v
    ),
  // text
  upper: (v) => String(v ?? "").toUpperCase(),
  lower: (v) => String(v ?? "").toLowerCase(),
  capitalize: (v) => {
    const s = String(v ?? "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  },
  truncate: (v, [length = 50, suffix = "…"]) => {
    const s = String(v ?? "");
    return s.length > +length ? s.slice(0, +length).trimEnd() + String(suffix) : s;
  },
  trim: (v) => String(v ?? "").trim(),
  pluralize: (v, [singular = "", plural]) => {
    const n = toNum(v);
    const word =
      Math.abs(n) === 1 ? String(singular) : plural != null ? String(plural) : `${singular}s`;
    return `${new Intl.NumberFormat().format(n)} ${word}`;
  },
  default: (v, [fallback = ""]) => {
    const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
    return empty ? String(fallback) : v;
  },
  // aggregates (operate on a list)
  sum: (v, [f]) => AGGREGATES.sum(toList(v), f),
  avg: (v, [f]) => AGGREGATES.avg(toList(v), f),
  min: (v, [f]) => AGGREGATES.min(toList(v), f),
  max: (v, [f]) => AGGREGATES.max(toList(v), f),
  count: (v) => AGGREGATES.count(toList(v)),
  join: (v, [sep = ", ", f]) =>
    toList(v)
      .map((row) => pick(row, /** @type {string} */ (f)))
      .join(String(sep))
};

/** Formatter names, for error messages and the runtime mirror check. */
export const FORMATTER_NAMES = Object.keys(FORMATTERS);

// --- parsing ---------------------------------------------------------------

/**
 * Split a string on a separator that is not inside a quoted run. Keeps pipe
 * arguments like `"a | b"` or `":"` intact.
 * @param {string} s
 * @param {string} sep single character
 * @returns {string[]}
 */
function splitTop(s, sep) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let quote = "";
  for (const c of s) {
    if (quote) {
      cur += c;
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** @param {string} t @returns {string | number | boolean | null} */
function parseArg(t) {
  const v = t.trim();
  if (/^"[^"]*"$/.test(v) || /^'[^']*'$/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  return v;
}

/**
 * Parse the inside of a `{ … }` binding into its path and an ordered list of
 * pipe stages. `{ price | money }` → `{ path: "price", stages: [{name:"money",args:[]}] }`.
 * Stage validation (unknown formatter) happens in {@link validatePipes}.
 * @param {string} inner
 * @returns {{ path: string, stages: Stage[] }}
 */
export function parsePipes(inner) {
  const segs = splitTop(inner, "|");
  const path = segs[0].trim();
  /** @type {Stage[]} */
  const stages = [];
  for (let i = 1; i < segs.length; i++) {
    const raw = segs[i].trim();
    const m = /^([A-Za-z][A-Za-z0-9_]*)\s*(?::([\s\S]*))?$/.exec(raw);
    if (!m) return { path, stages: [{ name: raw, args: [] }] }; // malformed → flagged by validate
    stages.push({ name: m[1], args: m[2] == null ? [] : splitTop(m[2], ":").map(parseArg) });
  }
  return { path, stages };
}

/**
 * Compile-time validation: every stage must name a known formatter. Throws a
 * corrective compile error otherwise. Returns the parsed `{ path, stages }`.
 * @param {string} inner
 * @param {Ctx} ctx
 * @returns {{ path: string, stages: Stage[] }}
 */
export function validatePipes(inner, ctx) {
  const parsed = parsePipes(inner);
  for (const stage of parsed.stages) {
    if (!Object.hasOwn(FORMATTERS, stage.name)) {
      throw new Error(
        `Unknown formatter "${stage.name}" in { ${inner} } (${ctx.file}). Available: ${FORMATTER_NAMES.join(", ")}.`
      );
    }
  }
  return parsed;
}

/**
 * Run a resolved value through a pipe chain at build time. Returns the final
 * value (a string or number); the caller stringifies for output. Mirrors the
 * runtime's `applyFmt`.
 * @param {any} value
 * @param {Stage[]} stages
 * @returns {any}
 */
export function applyPipeline(value, stages) {
  let out = value;
  for (const stage of stages) out = FORMATTERS[stage.name](out, stage.args);
  return out;
}

/** Serialize stages to the compact `[[name,[args]]]` form carried in data-wd-fmt. */
export const fmtAttr = (/** @type {Stage[]} */ stages) =>
  JSON.stringify(stages.map((s) => [s.name, s.args]));

/**
 * Parse a `data-wd-fmt` JSON payload (already HTML-decoded) back into stages.
 * Mirrors the runtime's own parse so the initial paint and the live update agree.
 * @param {string} json
 * @returns {Stage[]}
 */
export const stagesFromAttr = (json) =>
  /** @type {[string, any[]][]} */ (JSON.parse(json)).map(([name, args]) => ({ name, args }));
