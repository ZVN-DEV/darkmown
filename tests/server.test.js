import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { injectDevClient } from "../src/dev.js";
import { isServableFile, pipeFile, resolvePublicFile, serve } from "../src/statics.js";

test("public file resolution stays inside dist", () => {
  // Resolve, don't hardcode: `resolvePublicFile` resolves internally, and on
  // Windows a bare "/tmp/…" literal has no drive letter so the comparison
  // would fail on a path shape rather than on containment behavior.
  const dist = path.resolve("/tmp/example/dist");

  assert.equal(resolvePublicFile(dist, "/"), path.join(dist, "index.html"));
  assert.equal(resolvePublicFile(dist, "/docs/"), path.join(dist, "docs/index.html"));
  assert.equal(
    resolvePublicFile(dist, "/__wd/scripts/app.js"),
    path.join(dist, "__wd/scripts/app.js")
  );
  assert.equal(resolvePublicFile(dist, "/__wd/../../package.json"), null);
  assert.equal(resolvePublicFile(dist, "/__wd/%2e%2e/%2e%2e/package.json"), null);
});

test("malformed percent-encoded request paths resolve to not found", () => {
  // Resolve, don't hardcode: `resolvePublicFile` resolves internally, and on
  // Windows a bare "/tmp/…" literal has no drive letter so the comparison
  // would fail on a path shape rather than on containment behavior.
  const dist = path.resolve("/tmp/example/dist");
  assert.equal(resolvePublicFile(dist, "/%E0%A4%A"), null);
});

test("static serve returns a generic 404 for malformed request paths", () => {
  const chunks = [];
  const res = {
    statusCode: 0,
    headers: {},
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk) chunks.push(String(chunk));
    }
  };

  serve("/tmp/example/dist", "/%E0%A4%A", res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.doesNotMatch(chunks.join(""), /URIError|stack|decodeURIComponent/);
});

test("dev client injection is a development-only html transform", () => {
  const html = "<html><body><h1>Demo</h1></body></html>";
  const injected = injectDevClient(html);
  assert.match(injected, /\/__wd\/dev-client\.js/);
  assert.match(injected, /<\/script>\n<\/body>/);
});

// ---------------------------------------------------------------------------
// Dotted route segments (`/v1.2/`, `/node.js/`): `path.extname` reports an
// extension for ANY dotted last segment, so these skipped the `index.html` join
// and resolved to the DIRECTORY. `fs.createReadStream(dir).pipe(res)` has no
// error handler, so the EISDIR was an unhandled 'error' event and the dev /
// preview server DIED on one request. Every assertion below is also a liveness
// assertion: an unhandled stream error would take this test process with it.
// ---------------------------------------------------------------------------

/** A dist tree with dotted-segment routes, a plain route, and a 404 page. */
function dottedDist() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-dotted-"));
  const page = (title) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
  for (const [dir, title] of [
    ["v1.2", "Version 1.2"],
    ["node.js", "Node JS"],
    ["2024.01", "January"],
    ["docs", "Docs"]
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "index.html"), page(title));
  }
  // A directory with no index.html — a real miss, not a crash.
  fs.mkdirSync(path.join(root, "empty.dir"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), page("Home"));
  fs.writeFileSync(path.join(root, "404.html"), page("Not found"));
  fs.writeFileSync(path.join(root, "app.v2.js"), "export const x = 1;\n");
  return root;
}

/** GET every path in `urls` against one `serve`-backed server; returns responses. */
async function getAll(distRoot, urls) {
  const server = http.createServer((req, res) => serve(distRoot, req.url || "/", res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    /** @type {{ status: number, type: string, body: string }[]} */
    const out = [];
    for (const url of urls) {
      const response = await fetch(`http://127.0.0.1:${port}${url}`);
      out.push({
        status: response.status,
        type: response.headers.get("content-type") || "",
        body: await response.text()
      });
    }
    return out;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a dotted route segment resolves to its index.html, not to the directory", () => {
  const dist = dottedDist();
  assert.equal(resolvePublicFile(dist, "/v1.2/"), path.join(dist, "v1.2/index.html"));
  assert.equal(resolvePublicFile(dist, "/v1.2"), path.join(dist, "v1.2/index.html"));
  assert.equal(resolvePublicFile(dist, "/node.js/"), path.join(dist, "node.js/index.html"));
  assert.equal(resolvePublicFile(dist, "/2024.01/"), path.join(dist, "2024.01/index.html"));
  // A genuinely dotted FILE is untouched — the directory check only fires on a
  // path that is actually a directory on disk.
  assert.equal(resolvePublicFile(dist, "/app.v2.js"), path.join(dist, "app.v2.js"));
  assert.equal(resolvePublicFile(dist, "/docs/"), path.join(dist, "docs/index.html"));
});

test("serving a dotted route answers the page and leaves the server alive", async () => {
  const dist = dottedDist();
  const [v12, v12Bare, nodejs, empty, home] = await getAll(dist, [
    "/v1.2/",
    "/v1.2",
    "/node.js/",
    "/empty.dir/",
    "/"
  ]);

  assert.equal(v12.status, 200);
  assert.match(v12.body, /Version 1\.2/);
  assert.match(v12.type, /text\/html/);
  assert.equal(v12Bare.status, 200);
  assert.match(v12Bare.body, /Version 1\.2/);
  assert.equal(nodejs.status, 200);
  assert.match(nodejs.body, /Node JS/);

  // A directory with no index.html is a 404 (the built 404 page), never a crash.
  assert.equal(empty.status, 404);
  assert.match(empty.body, /Not found/);

  // The request AFTER the dotted ones proves the process survived them, which
  // is the actual regression: one `/v1.2/` used to kill `darkmown dev`.
  assert.equal(home.status, 200);
  assert.match(home.body, /Home/);
});

test("isServableFile refuses a directory, so a read stream never sees one", () => {
  const dist = dottedDist();
  assert.equal(isServableFile(path.join(dist, "index.html")), true);
  assert.equal(isServableFile(path.join(dist, "v1.2")), false, "a directory is not servable");
  assert.equal(isServableFile(path.join(dist, "nope.html")), false, "an absent file is not either");
});

test("a read failure mid-response answers instead of throwing an unhandled error", async () => {
  const dist = dottedDist();
  // Stream a path that does not exist: `createReadStream` emits 'error' with no
  // listener, which is an uncaught exception. `pipeFile` answers 500 instead.
  const server = http.createServer((_req, res) => pipeFile(path.join(dist, "gone.html"), res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 500);
    assert.match(await response.text(), /500 Internal Server Error/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
