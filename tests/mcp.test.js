import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createDispatcher, PROTOCOL_VERSION } from "../src/mcp.js";
import { docSections, mcpConfig } from "../src/mcp-tools.js";

// In-process coverage of the MCP dispatcher and every tool/resource. The stdio
// framing loop (serveMcp) and the real child-process round trip live in
// tests/mcp-stdio.test.js; here the dispatcher is driven as a pure function.

const config = mcpConfig();
const handle = createDispatcher(config);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));

/** Shorthand for a request frame. */
function request(id, method, params) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}

/** Call a tool and return the result payload (asserts the envelope). */
function callTool(id, name, args) {
  const response = handle(
    request(id, "tools/call", { name, ...(args ? { arguments: args } : {}) })
  );
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, id);
  assert.ok(response.result, `expected a result, got ${JSON.stringify(response)}`);
  return response.result;
}

/** The first text content item of a tool result. */
function firstText(result) {
  return result.content[0].text;
}

// --- handshake ---------------------------------------------------------------

test("initialize answers protocolVersion, capabilities, and serverInfo", () => {
  const response = handle(
    request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" }
    })
  );
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(PROTOCOL_VERSION, "2024-11-05");
  assert.ok(response.result.capabilities.tools, "tools capability advertised");
  assert.ok(response.result.capabilities.resources, "resources capability advertised");
  assert.deepEqual(response.result.serverInfo, { name: "darkmown", version: pkg.version });
});

test("ping answers an empty result", () => {
  assert.deepEqual(handle(request(9, "ping")), { jsonrpc: "2.0", id: 9, result: {} });
});

test("notifications/initialized (and any notification) gets no response", () => {
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/cancelled", id: null }), null);
  assert.equal(handle({ jsonrpc: "2.0", method: "tools/list" }), null);
});

test("unknown method answers -32601 Method not found", () => {
  const response = handle(request(4, "prompts/list"));
  assert.equal(response.error.code, -32601);
  assert.match(response.error.message, /Method not found: prompts\/list/);
});

test("non-object frames and batches answer -32600 Invalid Request", () => {
  assert.equal(handle("nope").error.code, -32600);
  assert.equal(handle(null).error.code, -32600);
  assert.equal(handle([request(1, "ping")]).error.code, -32600, "batches are not supported");
  const missingMethod = handle({ jsonrpc: "2.0", id: 7 });
  assert.equal(missingMethod.error.code, -32600);
  assert.equal(missingMethod.id, 7);
  const badMethod = handle({ jsonrpc: "2.0", method: 42 });
  assert.equal(badMethod.error.code, -32600);
  assert.equal(badMethod.id, null);
});

// --- tools/list ----------------------------------------------------------------

test("tools/list exposes the five tools, each with an inputSchema", () => {
  const response = handle(request(2, "tools/list"));
  const names = response.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["catalog", "grammar", "validate", "error", "doc"]);
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} has a JSON Schema object`);
    assert.ok(tool.description.length > 20, `${tool.name} has a real description`);
    assert.equal("run" in tool, false, "the wire shape must not leak the implementation");
  }
});

test("tools/call rejects an unknown tool, a missing name, and non-object params", () => {
  const unknown = handle(request(3, "tools/call", { name: "nope" }));
  assert.equal(unknown.error.code, -32602);
  assert.match(
    unknown.error.message,
    /Unknown tool: nope\. Available: catalog, grammar, validate, error, doc/
  );

  const missing = handle(request(3, "tools/call", {}));
  assert.equal(missing.error.code, -32602);

  const scalar = handle(request(3, "tools/call", "catalog"));
  assert.equal(scalar.error.code, -32602);
});

test("a tool that throws becomes an isError result, not a protocol error", () => {
  const boom = createDispatcher({
    serverInfo: { name: "darkmown", version: "0" },
    tools: [
      {
        name: "boom",
        description: "always throws",
        inputSchema: { type: "object" },
        run: () => {
          throw new Error("kaput");
        }
      }
    ],
    resources: []
  });
  const response = boom(request(5, "tools/call", { name: "boom" }));
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /Tool "boom" failed: kaput/);
});

// --- catalog tool ----------------------------------------------------------------

test("catalog with no mode returns the full JSON catalog", () => {
  const result = callTool(10, "catalog");
  const catalog = JSON.parse(firstText(result));
  assert.equal(catalog.format, ".wd");
  assert.equal(catalog.version, pkg.version);
  assert.ok(catalog.directives.length >= 25);
  assert.ok(catalog.errors.some((e) => e.code === "WD201"));
});

test("catalog modes llms and llms-full render the markdown surfaces", () => {
  const llms = callTool(11, "catalog", { mode: "llms" });
  assert.match(firstText(llms), /# Darkmown \.wd cheatsheet/);

  const full = callTool(12, "catalog", { mode: "llms-full" });
  assert.match(firstText(full), /full reference/);
  assert.match(firstText(full), /## Compile error codes/);
});

test("catalog rejects an unknown or non-string mode", () => {
  const bad = callTool(13, "catalog", { mode: "yaml" });
  assert.equal(bad.isError, true);
  assert.match(firstText(bad), /unknown catalog mode "yaml"\. Valid modes: json, llms, llms-full/);

  const numeric = callTool(14, "catalog", { mode: 5 });
  assert.equal(numeric.isError, true);
  assert.match(firstText(numeric), /unknown catalog mode 5/);
});

// --- grammar tool ----------------------------------------------------------------

test("grammar returns a category slice and the action/predicate extras", () => {
  const result = callTool(20, "grammar", { categories: ["actions"] });
  const text = firstText(result);
  assert.match(text, /:button/);
  assert.match(text, /Action tokens/);
  const data = JSON.parse(result.content[1].text);
  assert.deepEqual(data.categories, ["actions"]);
  assert.ok(data.actionTokens.includes("++"));
});

test("grammar with no categories returns every category", () => {
  const result = callTool(21, "grammar");
  assert.match(firstText(result), /:state/);
  assert.match(firstText(result), /@loop/);
  assert.match(firstText(result), /:carousel/);
});

test("grammar gbnf:true returns the GBNF grammar", () => {
  const result = callTool(22, "grammar", { gbnf: true });
  assert.match(firstText(result), /root ::= directive \| closer \| binding/);
});

test("grammar answers an unknown category with the valid list, and skips non-string entries", () => {
  const bad = callTool(23, "grammar", { categories: ["state", "wizardry", 42] });
  assert.equal(bad.isError, true);
  assert.match(firstText(bad), /unknown category "wizardry"/);
});

// --- validate tool -----------------------------------------------------------------

test("validate compiles a clean source and reports ok:true", () => {
  const result = callTool(30, "validate", {
    source: "---\ntitle: Hi\n---\n\n# Hello\n"
  });
  assert.match(firstText(result), /^compiles\./);
  const data = JSON.parse(result.content[1].text);
  assert.equal(data.ok, true);
  assert.equal(data.runtime, false);
});

test("validate reports a reactive page as shipping the runtime", () => {
  const result = callTool(31, "validate", {
    source: ':state count = 0\n\n{ count }\n\n:button "Go" -> count++\n'
  });
  const data = JSON.parse(result.content[1].text);
  assert.equal(data.ok, true);
  assert.equal(data.runtime, true);
  assert.match(firstText(result), /reactive/);
});

test("validate on a bare :state answers WD201 with file and line", () => {
  const result = callTool(32, "validate", { source: ":state\n" });
  const text = firstText(result);
  assert.match(text, /^WD201 at index\.wd:1/);
  assert.match(text, /use: :state name = value/);
  const data = JSON.parse(result.content[1].text);
  assert.equal(data.ok, false);
  assert.equal(data.code, "WD201");
  assert.equal(data.file, "index.wd");
  assert.equal(data.line, 1);
});

test("validate honors a filename argument, with or without site/ and a leading slash", () => {
  const named = callTool(33, "validate", { source: ":state\n", filename: "about.wd" });
  assert.match(firstText(named), /^WD201 at about\.wd:1/);

  const pathed = callTool(34, "validate", { source: ":state\n", filename: "/site/pages/deep.wd" });
  assert.match(firstText(pathed), /^WD201 at deep\.wd:1/);
});

test("validate requires a source string", () => {
  const result = callTool(35, "validate", {});
  assert.equal(result.isError, true);
  assert.match(firstText(result), /needs a "source" string/);
});

// --- error tool --------------------------------------------------------------------

test("error WD201 returns title, cause, fix, and example", () => {
  const result = callTool(40, "error", { code: "wd201" });
  const text = firstText(result);
  assert.match(text, /^WD201 /);
  assert.match(text, /cause: /);
  assert.match(text, /fix: /);
  assert.match(text, /e\.g\. :state count = 0/);
  const data = JSON.parse(result.content[1].text);
  assert.equal(data.code, "WD201");
});

test("error for a code without an example omits the example line", () => {
  const result = callTool(41, "error", { code: "WD001" });
  assert.match(firstText(result), /^WD001 Unterminated frontmatter/);
  assert.doesNotMatch(firstText(result), /e\.g\./);
});

test("error WD999 answers with the list of valid codes", () => {
  const result = callTool(42, "error", { code: "WD999" });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /unknown error code "WD999"\. Valid codes: WD001/);
  const data = JSON.parse(result.content[1].text);
  assert.ok(data.codes.includes("WD201"));
  assert.ok(!data.codes.includes("WD999"));
});

test("error requires a code", () => {
  const result = callTool(43, "error", {});
  assert.equal(result.isError, true);
  assert.match(firstText(result), /unknown error code/);
});

// --- doc tool --------------------------------------------------------------------

test("doc with no topic lists every section of README and AGENTS", () => {
  const result = callTool(50, "doc");
  const text = firstText(result);
  assert.match(text, /Available doc sections:/);
  assert.match(text, /\(README\.md\)/);
  assert.match(text, /\(AGENTS\.md\)/);
  const data = JSON.parse(result.content[1].text);
  assert.ok(data.topics.length > 40, "both docs contribute their sections");
});

test("doc sections ignore heading-shaped lines inside fenced code", () => {
  const topics = docSections().map((s) => s.topic);
  // README's sample robots.txt and example pages contain lines like
  // "# Hello, Darkmown" inside fences; they must not become sections.
  assert.ok(!topics.includes("Hello, Darkmown"));
  assert.ok(topics.includes("Quick start"));
});

test("doc finds a section by fuzzy topic", () => {
  const includes = callTool(51, "doc", { topic: "includes" });
  assert.match(firstText(includes), /@include/);

  const exact = callTool(52, "doc", { topic: "loops" });
  assert.match(firstText(exact), /^# Loops /);

  const words = callTool(53, "doc", { topic: "escape logic" });
  assert.match(firstText(words), /escape hatch/i);
});

test("doc answers an unmatched topic with the section list", () => {
  const result = callTool(54, "doc", { topic: "zzzqqq" });
  assert.equal(result.isError, true);
  assert.match(firstText(result), /no doc section matches "zzzqqq"/);
});

test("doc treats a non-string topic as empty and lists sections", () => {
  const result = callTool(55, "doc", { topic: 42 });
  assert.match(firstText(result), /Available doc sections:/);
});

// --- resources -----------------------------------------------------------------

test("resources/list exposes the shipped docs at darkmown://docs URIs", () => {
  const response = handle(request(60, "resources/list"));
  const resources = response.result.resources;
  assert.deepEqual(
    resources.map((r) => r.uri),
    [
      "darkmown://docs/readme",
      "darkmown://docs/agents",
      "darkmown://docs/changelog",
      "darkmown://docs/errors",
      "darkmown://docs/cli"
    ]
  );
  for (const resource of resources) {
    assert.equal(resource.mimeType, "text/markdown");
    assert.ok(resource.description.length > 10);
  }
});

test("resources/read returns each doc's markdown from the installed package", () => {
  const readme = handle(request(61, "resources/read", { uri: "darkmown://docs/readme" }));
  const [content] = readme.result.contents;
  assert.equal(content.uri, "darkmown://docs/readme");
  assert.equal(content.mimeType, "text/markdown");
  assert.match(content.text, /^# Darkmown/m);

  const expected = {
    "darkmown://docs/agents": /agent guide/,
    "darkmown://docs/changelog": /##/,
    "darkmown://docs/errors": /WD201/,
    "darkmown://docs/cli": /darkmown build/
  };
  for (const [uri, pattern] of Object.entries(expected)) {
    const response = handle(request(62, "resources/read", { uri }));
    assert.match(response.result.contents[0].text, pattern, `${uri} reads its file`);
  }
});

test("resources/read rejects an unknown URI and a missing uri", () => {
  const unknown = handle(request(63, "resources/read", { uri: "darkmown://docs/nope" }));
  assert.equal(unknown.error.code, -32602);
  assert.match(
    unknown.error.message,
    /Unknown resource: darkmown:\/\/docs\/nope\. Available: darkmown:\/\/docs\/readme/
  );

  const missing = handle(request(64, "resources/read", {}));
  assert.equal(missing.error.code, -32602);

  const scalar = handle(request(65, "resources/read", "darkmown://docs/readme"));
  assert.equal(scalar.error.code, -32602);
});
