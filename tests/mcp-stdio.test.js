import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliError, helpText, run } from "../src/cli.js";
import { createDispatcher, serveMcp } from "../src/mcp.js";
import { mcpConfig } from "../src/mcp-tools.js";

// The stdio half of the MCP server: the framing loop driven over in-memory
// streams, plus a real child-process round trip through `node src/cli.js mcp`.

const cli = path.resolve("src/cli.js");

test("serveMcp frames responses, survives garbage, and resolves on end", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = "";
  output.on("data", (chunk) => {
    raw += chunk;
  });

  const done = serveMcp({ input, output, dispatcher: createDispatcher(mcpConfig()) });

  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  input.write("this is not json\n");
  input.write("\n"); // blank lines are skipped, not answered
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  // A frame split across two chunks must be reassembled before parsing.
  input.write('{"jsonrpc":"2.0","id":2,"meth');
  input.write('od":"tools/list"}\n');
  // A trailing frame with no newline is still answered at end-of-input.
  input.end('{"jsonrpc":"2.0","id":3,"method":"ping"}');

  assert.deepEqual(await done, { command: "mcp" });

  const frames = raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(frames.length, 4, "ping, parse error, tools/list, ping; the notification is silent");
  assert.deepEqual(frames[0], { jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(frames[1].id, null);
  assert.equal(frames[1].error.code, -32700);
  assert.match(frames[1].error.message, /Parse error/);
  assert.equal(frames[2].id, 2);
  assert.equal(frames[2].result.tools.length, 5);
  assert.deepEqual(frames[3], { jsonrpc: "2.0", id: 3, result: {} });
});

test("serveMcp writes nothing for an input that only ends", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = "";
  output.on("data", (chunk) => {
    raw += chunk;
  });
  const done = serveMcp({ input, output, dispatcher: createDispatcher(mcpConfig()) });
  input.end();
  await done;
  assert.equal(raw, "");
});

test("run('mcp', extra) rejects unknown arguments with a usage line", async () => {
  const stderr = [];
  const env = {
    log: () => {},
    warn: () => {},
    error: (line) => stderr.push(String(line))
  };
  await assert.rejects(() => run(["mcp", "--bogus"], env), CliError);
  assert.ok(stderr.some((line) => /Unknown argument for mcp: --bogus/.test(line)));
  assert.ok(stderr.some((line) => /Usage: darkmown mcp/.test(line)));
});

test("help text mentions the mcp command", () => {
  assert.match(helpText(), /darkmown mcp +Run the MCP server on stdio/);
});

test("node src/cli.js mcp speaks JSON-RPC over real child-process stdio", async () => {
  const child = spawn(process.execPath, [cli, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "validate", arguments: { source: ":state\n" } }
  });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "darkmown://docs/readme" }
  });
  send({ jsonrpc: "2.0", id: 4, method: "bogus/method" });
  child.stdin.end();

  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, `server exits cleanly when the host closes stdin. stderr: ${stderr}`);
  assert.match(stderr, /Darkmown MCP server v\d+\.\d+\.\d+ on stdio/);
  assert.match(stderr, /Ctrl-C/);

  // Every stdout line is a protocol frame: the banner must stay on stderr.
  const frames = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(frames.length, 4, "one response per request, silence for the notification");
  assert.equal(frames[0].result.serverInfo.name, "darkmown");
  assert.equal(frames[0].result.protocolVersion, "2024-11-05");
  assert.match(frames[1].result.content[0].text, /^WD201 at index\.wd:1/);
  assert.match(frames[2].result.contents[0].text, /^# Darkmown/m);
  assert.equal(frames[3].error.code, -32601);
});

test("node src/cli.js mcp --bogus exits 1 without touching stdio", async () => {
  const child = spawn(process.execPath, [cli, "mcp", "--bogus"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown argument for mcp: --bogus/);
});
