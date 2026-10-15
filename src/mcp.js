// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) server, stdio transport, hand-rolled.
//
// MCP over stdio is newline-delimited JSON-RPC 2.0: the client (Claude Code,
// Codex, Cursor, …) writes one JSON message per line on the server's stdin and
// reads one JSON response per line from its stdout. Everything else a server
// wants to say (startup banners, logs) goes to stderr — a single stray byte on
// stdout corrupts the frame stream, so `serveMcp` only ever writes responses
// there.
//
// This is a focused implementation of the subset a doc/validation server
// needs, protocol revision 2024-11-05:
//
//   initialize                 handshake: protocolVersion, capabilities, serverInfo
//   notifications/initialized  client ack — no response (as for every notification)
//   ping                       liveness — answers {}
//   tools/list                 the five Darkmown tools, with inputSchema
//   tools/call                 run one tool, answer MCP text content
//   resources/list             the darkmown://docs/* resources
//   resources/read             one resource's markdown text
//
// Deliberately NOT implemented (noted in the handshake's capabilities by their
// absence): prompts, logging, completion, sampling, subscriptions, and
// BATCHED requests — a JSON array on one line is answered with a single
// -32600 Invalid Request, which the spec permits a server to do. Tool/resource
// definitions are static for the life of the process, so the optional
// list-change notifications never fire.
//
// The module is dependency-free (Node built-ins only) and side-effect-free on
// import: `serveMcp` is called explicitly by the CLI's `mcp` command, and the
// dispatcher is a pure function tests drive in-process.
// ---------------------------------------------------------------------------

/** The one MCP protocol revision this server speaks. */
export const PROTOCOL_VERSION = "2024-11-05";

// Standard JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * One tool the server exposes over `tools/list` / `tools/call`.
 * @typedef {object} McpTool
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema A JSON Schema object describing the arguments.
 * @property {(args: Record<string, unknown>) => McpToolOutcome} run
 */

/**
 * What a tool run returns. `text` becomes the first MCP text content item; a
 * defined `data` is appended as a second text item carrying pretty-printed
 * JSON, so an agent gets both the human-readable answer and the structured
 * one. `isError` marks the result as a tool-level failure (a bad argument),
 * never a protocol error — those are JSON-RPC errors on the envelope.
 * @typedef {object} McpToolOutcome
 * @property {string} text
 * @property {object} [data]
 * @property {boolean} [isError]
 */

/**
 * One resource the server exposes over `resources/list` / `resources/read`.
 * @typedef {object} McpResource
 * @property {string} uri
 * @property {string} name
 * @property {string} description
 * @property {string} mimeType
 * @property {() => string} read
 */

/**
 * Everything the dispatcher needs to answer. Constructed by
 * `mcpConfig()` in src/mcp-tools.js; injected here so this module stays a
 * transport + envelope layer with no knowledge of Darkmown's docs.
 * @typedef {object} McpConfig
 * @property {{ name: string, version: string }} serverInfo
 * @property {McpTool[]} tools
 * @property {McpResource[]} resources
 */

/**
 * A JSON-RPC 2.0 message as it arrives on the wire. The server is liberal in
 * what it accepts: `id` may be a string, a number, or absent (a notification).
 * @typedef {{ jsonrpc?: string, id?: string | number | null, method?: unknown, params?: unknown }} McpMessage
 */

/**
 * Create the request dispatcher: one JSON-RPC message in, one response (or
 * `null` for a notification, which must never be answered) out.
 *
 * @param {McpConfig} config
 * @returns {(message: unknown) => object | null}
 */
export function createDispatcher({ serverInfo, tools, resources }) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const resourcesByUri = new Map(resources.map((resource) => [resource.uri, resource]));

  /**
   * @param {string | number | null} id
   * @param {unknown} value
   */
  const ok = (id, value) => ({ jsonrpc: "2.0", id, result: value });
  /**
   * @param {string | number | null} id
   * @param {number} code
   * @param {string} message
   */
  const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  /**
   * `tools/call`: find the tool, run it, shape the MCP result. A tool that
   * throws is a tool-level error result (the spec's `isError` channel), not a
   * protocol error — the client asked a fair question and the tool failed.
   * @param {string | number | null} id
   * @param {unknown} params
   */
  function callTool(id, params) {
    const args = /** @type {{ name?: unknown, arguments?: unknown }} */ (
      params && typeof params === "object" ? params : {}
    );
    const tool = typeof args.name === "string" ? toolsByName.get(args.name) : undefined;
    if (!tool) {
      const known = tools.map((t) => t.name).join(", ");
      return fail(id, INVALID_PARAMS, `Unknown tool: ${String(args.name)}. Available: ${known}`);
    }
    /** @type {McpToolOutcome} */
    let outcome;
    try {
      outcome = tool.run(
        /** @type {Record<string, unknown>} */ (
          args.arguments && typeof args.arguments === "object" ? args.arguments : {}
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return ok(id, {
        content: [{ type: "text", text: `Tool "${tool.name}" failed: ${message}` }],
        isError: true
      });
    }
    const content = [{ type: "text", text: outcome.text }];
    if (outcome.data !== undefined) {
      content.push({ type: "text", text: JSON.stringify(outcome.data, null, 2) });
    }
    return ok(id, { content, ...(outcome.isError ? { isError: true } : {}) });
  }

  /**
   * `resources/read`: one resource's full text. An unknown URI is an invalid
   * params error naming what the server actually has.
   * @param {string | number | null} id
   * @param {unknown} params
   */
  function readResource(id, params) {
    const args = /** @type {{ uri?: unknown }} */ (
      params && typeof params === "object" ? params : {}
    );
    const resource = typeof args.uri === "string" ? resourcesByUri.get(args.uri) : undefined;
    if (!resource) {
      const known = resources.map((r) => r.uri).join(", ");
      return fail(id, INVALID_PARAMS, `Unknown resource: ${String(args.uri)}. Available: ${known}`);
    }
    return ok(id, {
      contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.read() }]
    });
  }

  /**
   * Dispatch one decoded message. Returns the response to write back, or
   * `null` when the message is a notification (answered with silence, per
   * JSON-RPC) or otherwise needs no reply.
   * @param {unknown} message
   * @returns {object | null}
   */
  function handle(message) {
    if (!message || typeof message !== "object") {
      // A bare scalar, or a JSON array (a batch — not supported): one error.
      return fail(null, INVALID_REQUEST, "Invalid Request: expected a JSON-RPC object");
    }
    const { id, method, params } = /** @type {McpMessage} */ (message);
    if (typeof method !== "string") {
      return fail(id ?? null, INVALID_REQUEST, "Invalid Request: missing method");
    }
    // No id means notification: `notifications/initialized` and anything else
    // the client fires one-way. Notifications are never answered, even when
    // the method is unknown.
    if (id === undefined || id === null) return null;

    switch (method) {
      case "initialize":
        return ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false }
          },
          serverInfo
        });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema
          }))
        });
      case "tools/call":
        return callTool(id, params);
      case "resources/list":
        return ok(id, {
          resources: resources.map(({ uri, name, description, mimeType }) => ({
            uri,
            name,
            description,
            mimeType
          }))
        });
      case "resources/read":
        return readResource(id, params);
      default:
        return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return handle;
}

/**
 * Run the stdio loop: read newline-delimited JSON-RPC from `input`, write one
 * JSON response per line to `output`. Resolves when `input` ends, which is
 * how an MCP host stops a stdio server.
 *
 * A line that is not valid JSON answers with a -32700 Parse error and the loop
 * carries on — one garbage line from a misbehaving client must not kill the
 * server. A trailing partial line at end-of-input is answered too: MCP clients
 * always terminate frames, but a hand-rolled `echo '{…}' | darkmown mcp` smoke
 * test may not.
 *
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream,
 *   dispatcher: (message: unknown) => object | null }} io
 * @returns {Promise<{ command: "mcp" }>}
 */
export function serveMcp({ input, output, dispatcher }) {
  const send = (/** @type {object} */ message) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  const answer = (/** @type {string} */ line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    /** @type {unknown} */
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: PARSE_ERROR, message: "Parse error: line is not valid JSON" }
      });
      return;
    }
    const response = dispatcher(message);
    if (response) send(response);
  };

  let buffer = "";
  return new Promise((resolve) => {
    input.on("data", (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        answer(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    });
    input.on("end", () => {
      if (buffer) answer(buffer);
      resolve({ command: "mcp" });
    });
  });
}
