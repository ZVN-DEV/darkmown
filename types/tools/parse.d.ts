/**
 * @typedef {object} ToolCall
 * @property {string} tool
 * @property {object} args
 */
/**
 * Pull the first complete JSON object out of a reply.
 *
 * Scans with a brace counter that is string- and escape-aware, because the one
 * thing a Darkmown edit reliably contains is `{ count }`, and a naive
 * `indexOf("}")` truncates exactly the calls that matter most.
 *
 * @param {string} reply
 * @returns {{ok: true, call: ToolCall} | {ok: false, error: string}}
 */
export function parseToolCall(reply: string): {
    ok: true;
    call: ToolCall;
} | {
    ok: false;
    error: string;
};
export type ToolCall = {
    tool: string;
    args: object;
};
