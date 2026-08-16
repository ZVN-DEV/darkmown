// ---------------------------------------------------------------------------
// TOOL: grammar(categories)
//
// Hands back only the cheatsheet rows an edit actually needs, plus the closed
// enum of action tokens when the edit involves an action.
//
// Why this is a tool rather than a fixed prompt block. Measured against small
// local models, the cheatsheet behaves as a load-bearing runtime asset and not
// as documentation: revising it moved a 1.5B model by 22 points, and a single
// bad example line was copied verbatim into four consecutive attempts. A model
// shown only the rows it needs has fewer wrong rows available to copy, and
// spends fewer tokens getting them.
//
// Everything here is derived from `directiveCatalog()`, which the compiler
// generates from its own tables. Nothing is hand-transcribed, so a directive
// that changes in the compiler changes here in the same commit or the drift
// guard in the tests fails.
// ---------------------------------------------------------------------------

import { CATALOG_ACTION_TOKENS, directiveCatalog } from "../catalog.js";

/**
 * Every directive name, grouped into the category a person would ask for.
 *
 * Deliberately exhaustive and deliberately hand-maintained: `tools.test.mjs`
 * asserts that this covers the catalog exactly, so adding a directive to the
 * compiler without categorising it here fails a test rather than silently
 * dropping the directive out of every grammar slice.
 *
 * The names match `errorAreas` in the catalog, so a compile error in area
 * "loops" can be answered with `grammar(["loops"])` without a second mapping.
 */
export const CATEGORIES = {
  state: [":state", ":store", ":computed", ":theme"],
  loops: ["@loop"],
  actions: [":button", ":effect", ":every"],
  forms: [
    ":form",
    ":input",
    ":textarea",
    ":select",
    ":checkbox",
    ":radio",
    ":submit",
    ":bind",
    ":slider"
  ],
  fetch: [":fetch"],
  structure: ["@include", ":::", ":if", ":carousel"],
  media: [":video", ":audio", ":embed"]
};

/** Categories that also need the loop clause list and loop variables. */
const NEEDS_LOOP_EXTRAS = new Set(["loops"]);
/** Categories that also need the closed action-token enum. */
const NEEDS_ACTION_TOKENS = new Set(["actions"]);
/** Categories whose expressions use the comparison operators. */
const NEEDS_PREDICATES = new Set(["loops", "structure", "state"]);

/** @returns {string[]} Every category name, for callers that want to enumerate. */
export function categoryNames() {
  return Object.keys(CATEGORIES);
}

/**
 * One directive rendered as the model should write it.
 *
 * Syntax line then a concrete example, because small models copy `[optional]`
 * bracket notation into the file verbatim. The example is always a real
 * compilable line.
 *
 * @param {{name: string, syntax: string, description: string, example: string}} d
 * @returns {string}
 */
function renderDirective(d) {
  const lines = [`${d.name}  ${d.syntax}`, `  ${d.description}`];
  if (d.example && d.example !== d.syntax) lines.push(`  e.g. ${d.example}`);
  return lines.join("\n");
}

/**
 * TOOL ENTRY POINT.
 *
 * @param {string[]} [categories] Category names. Omitted or empty means all of
 *   them, which is the whole cheatsheet and is the thing this tool exists to
 *   avoid sending.
 * Failures use the same {ok, text, data} shape as every other tool. It used to
 * answer {ok: false, error}, which `Session` never reads, so an unknown category
 * handed the model an undefined message.
 *
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function grammar(categories) {
  const all = categoryNames();
  const want = !categories || categories.length === 0 ? all : categories;

  const unknown = want.filter((c) => !all.includes(c));
  if (unknown.length) {
    return {
      ok: false,
      text: `unknown categor${unknown.length === 1 ? "y" : "ies"} ${unknown.map((u) => `"${u}"`).join(", ")}. Available: ${all.join(", ")}`,
      data: { code: "TOOL_ARGS" }
    };
  }

  const catalog = directiveCatalog();
  const byName = new Map(catalog.directives.map((d) => [d.name, d]));
  const wanted = want.flatMap((c) => CATEGORIES[/** @type {keyof CATEGORIES} */ (c)] ?? []);
  const directives = /** @type {NonNullable<ReturnType<typeof byName.get>>[]} */ (
    wanted.map((n) => byName.get(n)).filter(Boolean)
  );

  const sections = [directives.map(renderDirective).join("\n\n")];
  // Widened up front: the optional sections below add their own keys, and an
  // inferred literal type would reject each one.
  /** @type {{categories: string[], directives: string[], loopClauses?: string[],
   *          actionTokens?: string[], predicateOps?: string[]}} */
  const data = { categories: want, directives: directives.map((d) => d.name) };

  if (want.some((c) => NEEDS_LOOP_EXTRAS.has(c))) {
    sections.push(
      "Loop clauses, all optional, in this exact order after `into <item>`:\n" +
        catalog.loopClauses.map((c) => `  ${c.name}  ${c.syntax ?? ""}`.trimEnd()).join("\n") +
        "\nInside a loop body you may also use: " +
        catalog.loopVariables.map((v) => `{ ${v.name} }`).join("  ")
    );
    data.loopClauses = catalog.loopClauses.map((c) => c.name);
  }

  if (want.some((c) => NEEDS_ACTION_TOKENS.has(c))) {
    sections.push(
      "Action tokens. This list is closed; anything else is a compile error:\n" +
        catalog.actionOps.map((a) => `  ${a.syntax}   ${a.description}`).join("\n")
    );
    data.actionTokens = [...CATALOG_ACTION_TOKENS];
  }

  if (want.some((c) => NEEDS_PREDICATES.has(c))) {
    sections.push(
      "Comparison operators for `where` and `:if`: " +
        catalog.predicateOps.map((o) => o.name).join(" ") +
        `\nJoin conditions with: ${catalog.predicateJoiners.join(" ")}`
    );
    data.predicateOps = catalog.predicateOps.map((o) => o.name);
  }

  return { ok: true, text: sections.join("\n\n"), data };
}

/**
 * How much a slice saves against sending everything.
 *
 * The plan claims filtering the cheatsheet is both a context saving and a
 * hallucination guard. The saving half is measurable, so it gets measured
 * rather than asserted.
 *
 * @param {string[]} categories
 * @returns {{sliceChars: number, fullChars: number, saved: number, savedPct: number}}
 */
export function grammarCost(categories) {
  const slice = grammar(categories);
  const full = grammar();
  const sliceChars = slice.ok ? slice.text.length : 0;
  const fullChars = full.ok ? full.text.length : 0;
  return {
    sliceChars,
    fullChars,
    saved: fullChars - sliceChars,
    savedPct: fullChars ? Math.round((100 * (fullChars - sliceChars)) / fullChars) : 0
  };
}
