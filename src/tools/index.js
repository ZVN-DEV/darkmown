// ---------------------------------------------------------------------------
// The tool surface, as one dispatch point.
//
// Six tools, all derived from the compiler rather than written beside it, all
// answering in text a model can nearly paste.
//
//   grammar(categories)          only the cheatsheet rows this edit needs
//   outline(entry)               what is in the page, with line numbers
//   refs(name)                   every declare / write / read of a symbol
//   deps(entry)                  what this page pulls in, and what pulls it in
//   apply(entry, edits)          targeted edits against a snapshot
//   validate(entry)              compile it for real, or say exactly what broke
//
// A `Session` holds the project files so a model never has to restate them, and
// so `apply` and `outline` are guaranteed to be looking at the same snapshot.
// Everything is in memory: a full compile is milliseconds, which is what makes
// "validate after every edit" affordable rather than aspirational.
// ---------------------------------------------------------------------------

import { apply } from "./apply.js";
import { grammar } from "./grammar.js";
import { deps, outline, refs } from "./outline.js";
import { parseToolCall } from "./parse.js";
import { validate } from "./validate.js";

export { apply, deps, grammar, outline, parseToolCall, refs, validate };

/**
 * The tool list as a model should be told about it: name, when to reach for it,
 * and the exact argument shape. Kept here rather than in a prompt file so the
 * description can never drift from the dispatcher.
 */
export const TOOL_SPECS = [
  {
    name: "outline",
    args: "{}",
    use: "List everything declared in the page with its line number. Call this FIRST; every other tool's targets come from it."
  },
  {
    name: "refs",
    args: '{ "name": "cart" }',
    use: "Find every place a symbol is declared, written, or read. Call this before changing a symbol, to see what else moves."
  },
  {
    name: "deps",
    args: "{}",
    use: "What this page includes, and which other pages include it."
  },
  {
    name: "grammar",
    args: '{ "categories": ["state", "actions"] }',
    use: "Get the exact syntax for one area. Categories: state, loops, actions, forms, fetch, structure, media."
  },
  {
    name: "apply",
    args: '{ "edits": [{ "op": "replace", "line": 7, "text": ":store cart = [] persist" }] }',
    use: 'Make an edit. Say WHERE with one of "line" (from outline), "symbol" (e.g. "state:cart"), or "anchor" (exact source text). Ops: replace, insert_after, insert_before, delete.'
  },
  {
    name: "validate",
    args: "{}",
    use: "Compile the page for real. Do this after every apply."
  }
];

/**
 * A working copy of a project plus the tools that operate on it.
 *
 * Edits are staged in the session, not written to disk, so a caller can apply,
 * validate, and roll back without touching a filesystem. `history` exists so a
 * run can be scored later on how many calls it took, which is the number that
 * decides whether the tool surface is worth its context budget.
 */
export class Session {
  /**
   * @param {Record<string, string>} files Project-relative path → contents.
   * @param {string} entry The file being edited.
   */
  constructor(files, entry) {
    this.files = { ...files };
    this.entry = entry;
    this.original = files[entry];
    /** @type {{tool: string, args: object, ok: boolean}[]} */
    this.history = [];
  }

  /**
   * Dispatch one tool call.
   *
   * An unknown tool name is answered with the list rather than an exception,
   * because a model that guessed a name can recover from a list and cannot
   * recover from a stack trace.
   *
   * @param {string} tool
   * @param {object} [args]
   * @returns {{ok: boolean, text: string, data?: object}}
   */
  call(tool, args = {}) {
    const result = this.#dispatch(tool, args);
    this.history.push({ tool, args, ok: result.ok });
    return result;
  }

  /**
   * The union of every argument any tool takes. Declaring it beats `object`,
   * which type-checked nothing and let a renamed field through silently.
   *
   * @typedef {{entry?: string, name?: string, categories?: string[],
   *            edits?: object[]}} ToolArgs
   *
   * @param {string} tool
   * @param {ToolArgs} args
   * @returns {{ok: boolean, text: string, data?: object}}
   */
  #dispatch(tool, args) {
    switch (tool) {
      case "outline":
        return outline(this.files, args.entry ?? this.entry);
      case "refs":
        return refs(this.files, args.entry ?? this.entry, args.name);
      case "deps":
        return deps(this.files, args.entry ?? this.entry);
      case "grammar":
        return grammar(args.categories);
      case "validate":
        return validate(this.files, args.entry ?? this.entry);
      case "apply": {
        const target = args.entry ?? this.entry;
        const result = apply(this.files, target, args.edits);
        // Staging on success is what keeps outline and apply on one snapshot.
        if (result.ok)
          this.files = /** @type {{files: Record<string, string>}} */ (result.data).files;
        return result;
      }
      default:
        return {
          ok: false,
          text: `no tool called "${tool}". Available: ${TOOL_SPECS.map((t) => t.name).join(", ")}`
        };
    }
  }

  /** @returns {string} The current content of the file under edit. */
  content() {
    return this.files[this.entry];
  }

  /** Discard all staged edits. @returns {void} */
  reset() {
    this.files = { ...this.files, [this.entry]: this.original };
  }
}

/**
 * The tool list rendered for a system prompt.
 *
 * Same discipline as the cheatsheet: concrete argument examples, never
 * `[optional]` bracket notation, because small models copy schematic notation
 * into their output verbatim.
 *
 * @returns {string}
 */
export function toolPrompt() {
  return [
    "You have these tools. Call one at a time, as a single JSON object:",
    '{"tool": "outline", "args": {}}',
    "",
    ...TOOL_SPECS.map((t) => `${t.name}  args: ${t.args}\n  ${t.use}`)
  ].join("\n");
}
