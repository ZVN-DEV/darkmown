import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverApiRoutes, handleApiRequest, matchApiRoute } from "../src/api-runner.js";

/** Make a temp `api/` dir, write the given `{ relPath: source }` handlers. */
function makeApi(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-api-"));
  const apiDir = path.join(root, "api");
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(apiDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return apiDir;
}

/** Start an http server that runs the api runner, falling through to a marker. */
async function startServer(apiDir) {
  const server = http.createServer((req, res) => {
    handleApiRequest({ apiDir, req, res })
      .then((handled) => {
        if (!handled) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("STATIC_FALLTHROUGH");
        }
      })
      .catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { server, base: `http://127.0.0.1:${port}` };
}

test("discoverApiRoutes maps files to segments, collapses index, skips private", () => {
  const apiDir = makeApi({
    "echo.mjs": "export default () => Response.json({})",
    "users/index.mjs": "export default () => Response.json({})",
    "users/[id].mjs": "export default () => Response.json({})",
    "_helper.mjs": "export const x = 1",
    ".hidden.mjs": "export default () => Response.json({})"
  });
  const routes = discoverApiRoutes(apiDir);
  const segs = routes.map((r) => r.segments.join("/")).sort();
  assert.deepEqual(segs, ["echo", "users", "users/[id]"]);
});

test("discoverApiRoutes returns [] when api dir is absent", () => {
  assert.deepEqual(discoverApiRoutes(path.join(os.tmpdir(), "darkmown-no-such-api")), []);
});

test("matchApiRoute: static, index, dynamic capture, and misses", () => {
  const routes = [
    { file: "/a/echo.js", segments: ["echo"] },
    { file: "/a/users/index.js", segments: ["users"] },
    { file: "/a/users/list.js", segments: ["users", "list"] },
    { file: "/a/users/[id].js", segments: ["users", "[id]"] }
  ];
  assert.equal(matchApiRoute(routes, "/api/echo")?.file, "/a/echo.js");
  assert.equal(matchApiRoute(routes, "/api/users")?.file, "/a/users/index.js");
  // exact file beats the dynamic param
  assert.equal(matchApiRoute(routes, "/api/users/list")?.file, "/a/users/list.js");
  const dynamic = matchApiRoute(routes, "/api/users/42");
  assert.equal(dynamic?.file, "/a/users/[id].js");
  assert.deepEqual(dynamic?.params, { id: "42" });
  // misses
  assert.equal(matchApiRoute(routes, "/api/missing"), null);
  assert.equal(matchApiRoute(routes, "/dashboard"), null);
  assert.equal(matchApiRoute(routes, "/api/users/42/extra"), null);
});

test("handleApiRequest runs a GET handler and returns JSON", async () => {
  const apiDir = makeApi({
    "hello.mjs": 'export default () => Response.json({ ok: true, msg: "hi" })'
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/hello`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, msg: "hi" });
  } finally {
    server.close();
  }
});

test("handleApiRequest reads a urlencoded POST body", async () => {
  const apiDir = makeApi({
    "echo.mjs": `export default async (request) => {
      const form = Object.fromEntries(await request.formData());
      return Response.json({ method: request.method, form });
    }`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/echo`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40b.com&n=2"
    });
    assert.deepEqual(await res.json(), {
      method: "POST",
      form: { email: "a@b.com", n: "2" }
    });
  } finally {
    server.close();
  }
});

test("handleApiRequest reads a JSON POST body", async () => {
  const apiDir = makeApi({
    "j.mjs": `export default async (request) => Response.json(await request.json())`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/j`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 })
    });
    assert.deepEqual(await res.json(), { a: 1 });
  } finally {
    server.close();
  }
});

test("handleApiRequest preserves multiple Set-Cookie headers (no fold)", async () => {
  const apiDir = makeApi({
    "login.mjs": `export default () => {
      const headers = new Headers();
      headers.append("set-cookie", "session=abc; Path=/; HttpOnly");
      headers.append("set-cookie", "csrf=xyz; Path=/");
      headers.set("content-type", "text/plain");
      return new Response("ok", { headers });
    }`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/login`);
    // undici splits the two header lines back into discrete cookies; a folded
    // single "session=…, csrf=…" value would collapse to one entry here.
    const cookies = res.headers.getSetCookie();
    assert.deepEqual(cookies.sort(), ["csrf=xyz; Path=/", "session=abc; Path=/; HttpOnly"]);
    assert.equal(res.headers.get("content-type"), "text/plain");
  } finally {
    server.close();
  }
});

test("handleApiRequest passes dynamic params to the handler", async () => {
  const apiDir = makeApi({
    "users/[id].mjs": `export default (request, ctx) => Response.json({ id: ctx.params.id })`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/users/99`);
    assert.deepEqual(await res.json(), { id: "99" });
  } finally {
    server.close();
  }
});

test("handleApiRequest returns 500 JSON when a handler throws", async () => {
  const apiDir = makeApi({
    "boom.mjs": `export default () => { throw new Error("kaboom"); }`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/boom`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /kaboom/);
  } finally {
    server.close();
  }
});

test("handleApiRequest 500s when a handler returns a non-Response", async () => {
  const apiDir = makeApi({
    "bad.mjs": `export default () => ({ not: "a response" })`
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/bad`);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /must return a Response/);
  } finally {
    server.close();
  }
});

test("handleApiRequest 500s when the default export is not a function", async () => {
  const apiDir = makeApi({ "x.mjs": "export default 42;" });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/x`);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /must .* a function/);
  } finally {
    server.close();
  }
});

test("handleApiRequest falls through (returns false) for non-api paths", async () => {
  const apiDir = makeApi({ "x.mjs": "export default () => Response.json({})" });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/some/page`);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "STATIC_FALLTHROUGH");
  } finally {
    server.close();
  }
});

test("handleApiRequest hot-reloads an edited handler (mtime cache-bust)", async () => {
  const apiDir = makeApi({ "v.mjs": `export default () => Response.json({ v: 1 })` });
  const file = path.join(apiDir, "v.mjs");
  const { server, base } = await startServer(apiDir);
  try {
    assert.deepEqual(await (await fetch(`${base}/api/v`)).json(), { v: 1 });
    fs.writeFileSync(file, `export default () => Response.json({ v: 2 })`);
    // Force a distinct mtime so the cache-buster import sees a new module URL.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    assert.deepEqual(await (await fetch(`${base}/api/v`)).json(), { v: 2 });
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Security guards: malformed URL encoding (400), the request-body cap (413),
// and the dev/serve error-disclosure split.
// ---------------------------------------------------------------------------

/** Start an http server like startServer, but with handleApiRequest options. */
async function startServerWithOptions(apiDir, options = {}) {
  const server = http.createServer((req, res) => {
    handleApiRequest({ apiDir, req, res, ...options })
      .then((handled) => {
        if (!handled) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("STATIC_FALLTHROUGH");
        }
      })
      .catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return { server, base: `http://127.0.0.1:${port}` };
}

test("matchApiRoute reports a malformed dynamic segment instead of throwing", () => {
  const routes = [{ file: "/a/users/[id].js", segments: ["users", "[id]"] }];
  assert.deepEqual(matchApiRoute(routes, "/api/users/%E0%A4%A"), { malformed: true });
  // A static route that matches the raw segment anyway still wins: malformed
  // is only reported when nothing else claimed the path. (Discovery sorts
  // static routes before dynamic ones, mirrored here.)
  const both = [
    { file: "/a/users/literal.js", segments: ["users", "%E0%A4%A"] },
    { file: "/a/users/[id].js", segments: ["users", "[id]"] }
  ];
  assert.deepEqual(matchApiRoute(both, "/api/users/%E0%A4%A"), {
    file: "/a/users/literal.js",
    params: {}
  });
  // Unrelated paths still miss cleanly.
  assert.equal(matchApiRoute(routes, "/api/users"), null);
  assert.equal(matchApiRoute(routes, "/other/%E0%A4%A"), null);
});

test("handleApiRequest answers a clean 400 for a malformed dynamic segment", async () => {
  const apiDir = makeApi({
    "users/[id].mjs": "export default (request, ctx) => Response.json({ id: ctx.params.id })"
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/users/%E0%A4%A`);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "Malformed URL encoding" });
    // The server survives and keeps routing.
    const ok = await fetch(`${base}/api/users/42`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: "42" });
  } finally {
    server.close();
  }
});

test("handleApiRequest answers 413 JSON when a body crosses the 10 MB cap", async () => {
  const apiDir = makeApi({
    "up.mjs":
      "export default async (request) => Response.json({ size: (await request.arrayBuffer()).byteLength })"
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/up`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)
    });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { ok: false, error: "Request body too large" });
    // The over-cap upload did not wedge the server.
    const ok = await fetch(`${base}/api/up`, {
      method: "POST",
      body: Buffer.alloc(4, 0x61)
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { size: 4 });
  } finally {
    server.close();
  }
});

test("handleApiRequest buffers a body at exactly the 10 MB cap", async () => {
  const apiDir = makeApi({
    "up.mjs":
      "export default async (request) => Response.json({ size: (await request.arrayBuffer()).byteLength })"
  });
  const { server, base } = await startServer(apiDir);
  try {
    const res = await fetch(`${base}/api/up`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(10 * 1024 * 1024, 0x62)
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { size: 10 * 1024 * 1024 });
  } finally {
    server.close();
  }
});

test("discloseErrors: false answers the generic production-shaped 500", async () => {
  const apiDir = makeApi({
    "boom.mjs": 'export default () => { throw new Error("kaboom /private/path"); }'
  });
  const { server, base } = await startServerWithOptions(apiDir, { discloseErrors: false });
  try {
    const res = await fetch(`${base}/api/boom`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: "Internal error" });
  } finally {
    server.close();
  }
});

test("the default (dev) disclosure keeps the real error message", async () => {
  const apiDir = makeApi({
    "boom.mjs": 'export default () => { throw new Error("kaboom"); }'
  });
  const { server, base } = await startServerWithOptions(apiDir);
  try {
    const res = await fetch(`${base}/api/boom`);
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /kaboom/);
  } finally {
    server.close();
  }
});
