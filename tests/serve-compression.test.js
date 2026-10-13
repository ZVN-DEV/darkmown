import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import {
  appendVary,
  compressBody,
  contentType,
  isCompressibleType,
  negotiateEncoding,
  serve
} from "../src/statics.js";

// A dist tree with one of each content class: html, css, js, json, svg, png,
// woff2, a 404 page, and a routes.json marking every route static.
function makeDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-compress-"));
  fs.writeFileSync(path.join(dist, "index.html"), "<h1>Home</h1>");
  fs.writeFileSync(path.join(dist, "404.html"), "<h1>Custom not found</h1>");
  fs.writeFileSync(path.join(dist, "app.css"), "body { margin: 0; }");
  fs.writeFileSync(path.join(dist, "app.js"), "export const x = 1;");
  fs.writeFileSync(path.join(dist, "data.json"), JSON.stringify({ ok: true }));
  fs.writeFileSync(path.join(dist, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  fs.writeFileSync(path.join(dist, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dist, "body.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  return dist;
}

// Spin up the real static server wired exactly as `darkmown serve` wires it
// (the request's Accept-Encoding is offered for negotiation) and issue a GET.
function request(distRoot, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) =>
      serve(distRoot, req.url || "/", res, { acceptEncoding: req.headers["accept-encoding"] })
    );
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      const req = http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      });
      req.on("error", (error) => {
        server.close();
        reject(error);
      });
    });
  });
}

// --- negotiation (pure) -----------------------------------------------------

test("negotiateEncoding prefers br, falls back to gzip, else identity", () => {
  assert.equal(negotiateEncoding(undefined), null);
  assert.equal(negotiateEncoding(""), null);
  assert.equal(negotiateEncoding("gzip, deflate, br"), "br");
  assert.equal(negotiateEncoding("gzip"), "gzip");
  assert.equal(negotiateEncoding("GZIP"), "gzip", "tokens are case-insensitive");
  assert.equal(negotiateEncoding("identity"), null);
  assert.equal(negotiateEncoding("deflate"), null);
});

test("negotiateEncoding honors q-values and the wildcard", () => {
  // An explicit q=0 refusal beats the wildcard; gzip is then taken from *.
  assert.equal(negotiateEncoding("br;q=0, *;q=1"), "gzip");
  // A higher gzip q outranks a lower br q.
  assert.equal(negotiateEncoding("br;q=0.4, gzip;q=0.9"), "gzip");
  // br at least ties gzip.
  assert.equal(negotiateEncoding("br;q=0.5, gzip;q=0.5"), "br");
  // Wildcard alone accepts both; br wins.
  assert.equal(negotiateEncoding("*"), "br");
  // A non-q parameter is ignored, and an unparseable q reads as 0.
  assert.equal(negotiateEncoding("gzip; foo=bar"), "gzip");
  assert.equal(negotiateEncoding("gzip;q=nope"), null);
  // Empty list items are skipped.
  assert.equal(negotiateEncoding(", ,"), null);
});

test("isCompressibleType admits text and data types, refuses binaries", () => {
  for (const type of [
    "text/html; charset=utf-8",
    "text/css; charset=utf-8",
    "text/plain; charset=utf-8",
    "text/javascript; charset=utf-8",
    "application/javascript",
    "application/json",
    "application/xml",
    "image/svg+xml"
  ]) {
    assert.equal(isCompressibleType(type), true, type);
  }
  for (const type of [
    "image/png",
    "image/jpeg",
    "image/webp",
    "font/woff2",
    "font/ttf",
    "video/mp4",
    "audio/mpeg",
    "application/octet-stream"
  ]) {
    assert.equal(isCompressibleType(type), false, type);
  }
});

test("appendVary appends without clobbering or duplicating", () => {
  assert.equal(appendVary(undefined, "Accept-Encoding"), "Accept-Encoding");
  assert.equal(appendVary("Origin", "Accept-Encoding"), "Origin, Accept-Encoding");
  assert.equal(appendVary("accept-encoding", "Accept-Encoding"), "accept-encoding");
});

test("compressBody round-trips through brotli and gzip", () => {
  const body = Buffer.from("<h1>compressible</h1>");
  assert.deepEqual(zlib.brotliDecompressSync(compressBody(body, "br")), body);
  assert.deepEqual(zlib.gunzipSync(compressBody(body, "gzip")), body);
});

// --- static serving over HTTP ------------------------------------------------

test("serve compresses HTML as br when accepted, with Vary and security headers", async () => {
  const dist = makeDist();
  try {
    const res = await request(dist, "/", { "accept-encoding": "gzip, deflate, br" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-encoding"], "br");
    assert.equal(res.headers.vary, "Accept-Encoding");
    // Compression must not disturb the existing header set.
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.equal(zlib.brotliDecompressSync(res.body).toString(), "<h1>Home</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve compresses CSS/JS/JSON/SVG as gzip when only gzip is accepted", async () => {
  const dist = makeDist();
  try {
    for (const urlPath of ["/app.css", "/app.js", "/data.json", "/logo.svg"]) {
      const res = await request(dist, urlPath, { "accept-encoding": "gzip" });
      assert.equal(res.statusCode, 200, urlPath);
      assert.equal(res.headers["content-encoding"], "gzip", urlPath);
      assert.equal(res.headers.vary, "Accept-Encoding", urlPath);
      assert.deepEqual(
        zlib.gunzipSync(res.body),
        fs.readFileSync(path.join(dist, urlPath.slice(1))),
        urlPath
      );
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve never compresses a .png or a font, even when br is accepted", async () => {
  const dist = makeDist();
  try {
    for (const urlPath of ["/hero.png", "/body.woff2"]) {
      const res = await request(dist, urlPath, { "accept-encoding": "br, gzip" });
      assert.equal(res.statusCode, 200, urlPath);
      assert.equal(res.headers["content-encoding"], undefined, urlPath);
      assert.equal(res.headers.vary, undefined, urlPath);
      assert.deepEqual(res.body, fs.readFileSync(path.join(dist, urlPath.slice(1))), urlPath);
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve sends identity (still with Vary) when no Accept-Encoding arrives", async () => {
  const dist = makeDist();
  try {
    const res = await request(dist, "/");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(res.headers.vary, "Accept-Encoding");
    assert.equal(res.body.toString(), "<h1>Home</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve compresses the 404 page and keeps its status and headers", async () => {
  const dist = makeDist();
  try {
    const res = await request(dist, "/missing/", { "accept-encoding": "gzip" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(res.headers.vary, "Accept-Encoding");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(zlib.gunzipSync(res.body).toString(), "<h1>Custom not found</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve falls back to the inline 404 (compressible) when dist/404.html is absent", async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-noindex-br-"));
  try {
    const res = await request(dist, "/missing/", { "accept-encoding": "br" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["content-encoding"], "br");
    assert.match(zlib.brotliDecompressSync(res.body).toString(), /Not found/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve answers 500 (never crashes) when a negotiated file turns unreadable", async () => {
  const dist = makeDist();
  const target = path.join(dist, "app.js");
  try {
    // Readable at stat time, unreadable at read time: the EACCES mirrors the
    // rebuild-deletes-file race pipeFile guards in the streaming path.
    fs.chmodSync(target, 0o000);
    const res = await request(dist, "/app.js", { "accept-encoding": "gzip" });
    assert.equal(res.statusCode, 500);
    assert.match(res.body.toString(), /500 Internal Server Error/);
  } finally {
    fs.chmodSync(target, 0o644);
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve maps the compressed content-types from real files (sanity)", () => {
  assert.equal(isCompressibleType(contentType("/dist/x.md")), false, ".md is octet-stream here");
  assert.equal(isCompressibleType(contentType("/dist/x.txt")), true);
});
