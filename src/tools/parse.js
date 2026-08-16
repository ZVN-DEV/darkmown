// ---------------------------------------------------------------------------
// Reading a tool call out of a small model's reply.
//
// Its own module so it can be tested without a GPU. It first lived inside the
// runner, which meant importing the parser started a 50-task sweep — a thing
// worth not repeating.
//
// Deliberately forgiving about the wrapper and strict about the content. Small
// models fence their JSON about half the time and narrate around it the rest,
// and none of that is a capability failure worth scoring. What IS worth scoring
// is malformed or invented calls, so every rejection returns a reason the model
// can act on rather than throwing.
// ---------------------------------------------------------------------------

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
export function parseToolCall(reply) {
  const text = String(reply ?? "").replace(/```(?:json)?/g, "");
  const start = text.indexOf("{");
  if (start === -1) {
    return {
      ok: false,
      error: 'no JSON object in that reply. Reply with exactly {"tool": "outline", "args": {}}'
    };
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth !== 0) continue;
      const slice = text.slice(start, i + 1);
      let parsed;
      try {
        parsed = JSON.parse(slice);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `that is not valid JSON (${why})` };
      }
      if (typeof parsed?.tool !== "string") {
        return { ok: false, error: 'that JSON object has no "tool" field' };
      }
      return {
        ok: true,
        call: { tool: parsed.tool, args: parsed.args ?? parsed.arguments ?? {} }
      };
    }
  }
  return { ok: false, error: "that JSON object is never closed" };
}
