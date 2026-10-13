import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { run } from "../src/cli.js";

// A minimal project root: a hand-written dist/ (serve never rebuilds) and
// whatever api/ handlers the test asks for.
function makeProject(apiFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-serve-api-"));
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), "<h1>Home</h1>");
  fs.writeFileSync(path.join(dist, "404.html"), "<h1>Custom not found</h1>");
  for (const [rel, source] of Object.entries(apiFiles)) {
    const abs = path.join(root, "api", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return root;
}

function envOf(cwd) {
  return { cwd, log: () => {}, warn: () => {}, error: () => {} };
}

// Start `darkmown serve` for a project on an ephemeral port.
async function startServe(root) {
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["serve"], envOf(root));
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
  }
  const { port } = /** @type {import("node:net").AddressInfo} */ (handle.server.address());
  return { handle, origin: `http://127.0.0.1:${port}` };
}

// Raw GET (no implicit Accept-Encoding, no transparent decompression).
function getRaw(origin, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}${urlPath}`, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      );
    });
    req.on("error", reject);
  });
}

function postRaw(origin, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${origin}${urlPath}`,
      { method: "POST", headers: { "content-type": "application/json", ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("serve runs a project api/ function (POST round-trip), like dev", async () => {
  const root = makeProject({
    "echo.mjs":
      "export default async (request) => Response.json({ ok: true, body: await request.json() })"
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await postRaw(origin, "/api/echo", JSON.stringify({ name: "ada" }));
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /application\/json/);
    assert.deepEqual(JSON.parse(res.body.toString()), { ok: true, body: { name: "ada" } });
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve passes [param] dynamic segments to the handler", async () => {
  const root = makeProject({
    "users/[id].mjs": "export default (request, ctx) => Response.json({ id: ctx.params.id })"
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/users/42");
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body.toString()), { id: "42" });
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve still 404s an /api path with no matching function", async () => {
  const root = makeProject({ "echo.mjs": "export default () => Response.json({})" });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/nope");
    assert.equal(res.status, 404);
    assert.match(res.body.toString(), /Custom not found/);
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve without an api/ directory behaves exactly as before", async () => {
  const root = makeProject();
  const { handle, origin } = await startServe(root);
  try {
    const home = await getRaw(origin, "/");
    assert.equal(home.status, 200);
    assert.match(home.body.toString(), /<h1>Home<\/h1>/);
    const api = await getRaw(origin, "/api/echo");
    assert.equal(api.status, 404, "no api/ dir: /api/* is just an unknown static route");
    const missing = await getRaw(origin, "/missing/");
    assert.equal(missing.status, 404);
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve compresses an api JSON response when gzip is accepted", async () => {
  const root = makeProject({
    "data.mjs": "export default () => Response.json({ ok: true, items: [1, 2, 3] })"
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/data", { "accept-encoding": "gzip, br" });
    assert.equal(res.status, 200);
    // br is preferred over gzip when both are accepted.
    assert.equal(res.headers["content-encoding"], "br");
    assert.equal(res.headers.vary, "Accept-Encoding");
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(res.body).toString()), {
      ok: true,
      items: [1, 2, 3]
    });
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve appends Vary to an api response that already carries one", async () => {
  const root = makeProject({
    "cached.mjs": `export default () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", vary: "Origin" }
      })`
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/cached", { "accept-encoding": "gzip" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(res.headers.vary, "Origin, Accept-Encoding");
    assert.deepEqual(JSON.parse(zlib.gunzipSync(res.body).toString()), { ok: true });
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve does not compress a binary api response", async () => {
  const root = makeProject({
    "bytes.mjs": `export default () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" }
      })`
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/bytes", { "accept-encoding": "br, gzip" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], undefined);
    assert.deepEqual([...res.body], [1, 2, 3]);
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve never double-compresses a handler-set Content-Encoding", async () => {
  const root = makeProject({
    "pre.mjs": `export default () =>
      new Response("plain", {
        headers: { "content-type": "text/plain", "content-encoding": "identity" }
      })`
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/pre", { "accept-encoding": "br" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], "identity", "handler encoding wins");
    assert.equal(res.body.toString(), "plain");
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve compresses static HTML through the full cli stack", async () => {
  const root = makeProject();
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/", { "accept-encoding": "br" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-encoding"], "br");
    assert.equal(res.headers.vary, "Accept-Encoding");
    assert.equal(zlib.brotliDecompressSync(res.body).toString(), "<h1>Home</h1>");
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve answers the dev-shaped 500 JSON when an api handler throws", async () => {
  const root = makeProject({
    "boom.mjs": 'export default () => { throw new Error("kaboom"); }'
  });
  const { handle, origin } = await startServe(root);
  try {
    const res = await getRaw(origin, "/api/boom");
    assert.equal(res.status, 500);
    const body = JSON.parse(res.body.toString());
    assert.equal(body.ok, false);
    assert.match(body.error, /kaboom/);
    assert.doesNotMatch(res.body.toString(), /at Object|node:internal/, "no stack trace");
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve answers 500 (no crash) on a malformed dynamic api segment", async () => {
  const root = makeProject({
    "users/[id].mjs": "export default (request, ctx) => Response.json({ id: ctx.params.id })"
  });
  const { handle, origin } = await startServe(root);
  try {
    // decodeURIComponent blows up on the param capture, rejecting the api
    // runner promise; the server answers instead of dying — same as dev.
    const res = await getRaw(origin, "/api/users/%E0%A4%A");
    assert.equal(res.status, 500);
    assert.match(res.headers["content-type"], /text\/plain/);
    // And the server is still alive for the next request.
    const home = await getRaw(origin, "/");
    assert.equal(home.status, 200);
  } finally {
    await handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
