import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { serve } from "../src/statics.js";

// Validator-based caching on `darkmown serve` (2.12.0): every static file
// response carries Last-Modified + a strong ETag + a Cache-Control by file
// class, and conditional requests (If-None-Match, then If-Modified-Since) get
// a bare 304. The dev server calls serve() without the validators option and
// sees none of this.

// A dist tree with one of each cache class: HTML, a /__wd/ framework asset, a
// media file outside /__wd/, a root data file, and a built 404 page.
function makeDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-cache-"));
  fs.writeFileSync(path.join(dist, "index.html"), "<h1>Home</h1>");
  fs.writeFileSync(path.join(dist, "404.html"), "<h1>Custom not found</h1>");
  fs.mkdirSync(path.join(dist, "__wd"), { recursive: true });
  fs.writeFileSync(path.join(dist, "__wd", "runtime.js"), "export const x = 1;");
  fs.writeFileSync(path.join(dist, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dist, "data.json"), JSON.stringify({ ok: true }));
  return dist;
}

// Spin up the static server wired exactly as `darkmown serve` wires it (the
// request's conditional headers are forwarded as the validators option) and
// issue a GET.
function request(distRoot, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) =>
      serve(distRoot, req.url || "/", res, {
        acceptEncoding: req.headers["accept-encoding"],
        validators: {
          ifNoneMatch: req.headers["if-none-match"],
          ifModifiedSince: req.headers["if-modified-since"]
        }
      })
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

function etagOf(dist, rel) {
  const stat = fs.statSync(path.join(dist, rel));
  return `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
}

test("HTML carries validators: strong ETag, Last-Modified, Cache-Control no-cache", async () => {
  const dist = makeDist();
  try {
    const res = await request(dist, "/");
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.etag, etagOf(dist, "index.html"));
    assert.equal(
      res.headers["last-modified"],
      fs.statSync(path.join(dist, "index.html")).mtime.toUTCString()
    );
    assert.equal(res.headers["cache-control"], "no-cache");
    assert.equal(res.body.toString(), "<h1>Home</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("Cache-Control by class: /__wd/ and media extensions cache an hour, other files revalidate", async () => {
  const dist = makeDist();
  try {
    const runtime = await request(dist, "/__wd/runtime.js");
    assert.equal(runtime.headers["cache-control"], "public, max-age=3600", "framework asset");
    assert.equal(runtime.headers.etag, etagOf(dist, "__wd/runtime.js"));

    const image = await request(dist, "/hero.png");
    assert.equal(image.headers["cache-control"], "public, max-age=3600", "media extension");

    const data = await request(dist, "/data.json");
    assert.equal(data.headers["cache-control"], "no-cache", "no caching contract: revalidate");
    assert.ok(data.headers.etag, "validators still ride along");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("If-None-Match with the current ETag answers a bare 304", async () => {
  const dist = makeDist();
  try {
    const first = await request(dist, "/");
    const res = await request(dist, "/", { "if-none-match": first.headers.etag });
    assert.equal(res.statusCode, 304);
    assert.equal(res.body.length, 0, "no body");
    assert.equal(res.headers.etag, first.headers.etag, "the validators come again");
    assert.equal(res.headers["last-modified"], first.headers["last-modified"]);
    assert.equal(res.headers["cache-control"], "no-cache");
    assert.equal(res.headers.vary, "Accept-Encoding", "HTML is a compressible variant");
    assert.equal(res.headers["content-type"], undefined, "no representation headers");
    assert.equal(res.headers["content-encoding"], undefined);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("If-None-Match: a list containing the ETag matches, a wildcard matches, a non-compressible 304 has no Vary", async () => {
  const dist = makeDist();
  try {
    const png = await request(dist, "/hero.png");
    const listed = await request(dist, "/hero.png", {
      "if-none-match": `"other-1", ${png.headers.etag}`
    });
    assert.equal(listed.statusCode, 304);
    const wildcard = await request(dist, "/hero.png", { "if-none-match": "*" });
    assert.equal(wildcard.statusCode, 304);
    assert.equal(wildcard.headers.vary, undefined, "a font/image variant does not vary");
    assert.equal(wildcard.headers["cache-control"], "public, max-age=3600");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("If-None-Match wins over If-Modified-Since (a stale ETag is a 200 even with a future date)", async () => {
  const dist = makeDist();
  try {
    const res = await request(dist, "/", {
      "if-none-match": '"stale-etag"',
      "if-modified-since": new Date(Date.now() + 60_000).toUTCString()
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.toString(), "<h1>Home</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("If-Modified-Since: an unchanged file 304s, a changed mtime serves 200 again", async () => {
  const dist = makeDist();
  try {
    const target = path.join(dist, "index.html");
    const stat = fs.statSync(target);

    const fresh = await request(dist, "/", {
      "if-modified-since": new Date(stat.mtimeMs + 10_000).toUTCString()
    });
    assert.equal(fresh.statusCode, 304);
    assert.equal(fresh.body.length, 0);

    const old = await request(dist, "/", {
      "if-modified-since": new Date(stat.mtimeMs - 10_000).toUTCString()
    });
    assert.equal(old.statusCode, 200, "the file is newer than the cached copy");

    // A rebuild touches the file: the OLD ETag no longer matches either.
    const before = await request(dist, "/");
    fs.writeFileSync(target, "<h1>Home, rebuilt</h1>");
    const after = await request(dist, "/", { "if-none-match": before.headers.etag });
    assert.equal(after.statusCode, 200);
    assert.equal(after.body.toString(), "<h1>Home, rebuilt</h1>");
    assert.notEqual(after.headers.etag, before.headers.etag);

    // An unparseable date is simply ignored.
    const bogus = await request(dist, "/", { "if-modified-since": "not a date" });
    assert.equal(bogus.statusCode, 200);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("the built 404 carries validators and revalidates to a 304", async () => {
  const dist = makeDist();
  try {
    const first = await request(dist, "/missing/");
    assert.equal(first.statusCode, 404);
    assert.equal(first.headers.etag, etagOf(dist, "404.html"));
    assert.equal(first.headers["cache-control"], "no-cache");
    assert.ok(first.headers["last-modified"]);

    const res = await request(dist, "/missing/", { "if-none-match": first.headers.etag });
    assert.equal(res.statusCode, 304);
    assert.equal(res.body.length, 0);
    assert.equal(res.headers.etag, first.headers.etag);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("the inline 404 fallback (no dist/404.html) has no file, so no validators", async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-cache-inline-"));
  try {
    const res = await request(dist, "/missing/");
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers.etag, undefined);
    assert.equal(res.headers["last-modified"], undefined);
    assert.match(res.body.toString(), /Not found/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("compression still negotiates alongside validators, and a 304 skips the compression work", async () => {
  const dist = makeDist();
  try {
    const first = await request(dist, "/", { "accept-encoding": "br" });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["content-encoding"], "br", "brotli still negotiated");
    assert.ok(first.headers.etag, "validators on the compressed 200");
    assert.equal(zlib.brotliDecompressSync(first.body).toString(), "<h1>Home</h1>");

    const res = await request(dist, "/", {
      "accept-encoding": "br",
      "if-none-match": first.headers.etag
    });
    assert.equal(res.statusCode, 304);
    assert.equal(res.headers["content-encoding"], undefined, "a 304 names no encoding");
    assert.equal(res.body.length, 0);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("without the validators option (the dev-server call shape) nothing changes", async () => {
  const dist = makeDist();
  try {
    const server = http.createServer((req, res) =>
      serve(dist, req.url || "/", res, { acceptEncoding: req.headers["accept-encoding"] })
    );
    const res = await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
        http
          .get({ host: "127.0.0.1", port, path: "/" }, (r) => {
            r.resume();
            r.on("end", () => {
              server.close();
              resolve(r);
            });
          })
          .on("error", reject);
      });
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.etag, undefined);
    assert.equal(res.headers["last-modified"], undefined);
    assert.equal(res.headers["cache-control"], undefined);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
