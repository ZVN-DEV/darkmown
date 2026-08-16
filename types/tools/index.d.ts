/**
 * The tool list rendered for a system prompt.
 *
 * Same discipline as the cheatsheet: concrete argument examples, never
 * `[optional]` bracket notation, because small models copy schematic notation
 * into their output verbatim.
 *
 * @returns {string}
 */
export function toolPrompt(): string;
/**
 * The tool list as a model should be told about it: name, when to reach for it,
 * and the exact argument shape. Kept here rather than in a prompt file so the
 * description can never drift from the dispatcher.
 */
export const TOOL_SPECS: {
    name: string;
    args: string;
    use: string;
}[];
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
    constructor(files: Record<string, string>, entry: string);
    files: {
        [x: string]: string;
    };
    entry: string;
    original: string;
    /** @type {{tool: string, args: object, ok: boolean}[]} */
    history: {
        tool: string;
        args: object;
        ok: boolean;
    }[];
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
    call(tool: string, args?: object): {
        ok: boolean;
        text: string;
        data?: object;
    };
    /** @returns {string} The current content of the file under edit. */
    content(): string;
    /** Discard all staged edits. @returns {void} */
    reset(): void;
    #private;
}
import { apply } from "./apply.js";
import { deps } from "./outline.js";
import { grammar } from "./grammar.js";
import { outline } from "./outline.js";
import { parseToolCall } from "./parse.js";
import { refs } from "./outline.js";
import { validate } from "./validate.js";
export { apply, deps, grammar, outline, parseToolCall, refs, validate };
