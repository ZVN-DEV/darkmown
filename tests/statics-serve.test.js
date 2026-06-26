import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { contentType, serve } from "../src/statics.js";

test("contentType maps known extensions and defaults unknown ones to octet-stream", () => {
  assert.equal(contentType("/dist/__wd/media/logo.svg"), "image/svg+xml");
  assert.equal(contentType("/dist/__wd/media/hero.png"), "image/png");
  assert.equal(contentType("/dist/__wd/fonts/body.woff2"), "font/woff2");
  assert.equal(contentType("/dist/favicon.ico"), "image/x-icon");

  // Text formats stay UTF-8 tagged.
  assert.equal(contentType("/dist/index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("/dist/__wd/skins/app.css"), "text/css; charset=utf-8");
  assert.equal(contentType("/dist/__wd/runtime.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("/dist/routes.json"), "application/json");

  // Unknown / extensionless paths must not be served as HTML.
  assert.equal(contentType("/dist/data.bin"), "application/octet-stream");
  assert.equal(contentType("/dist/no-extension"), "application/octet-stream");
});

test("contentType is case-insensitive on the extension", () => {
  assert.equal(contentType("/dist/PHOTO.JPG"), "image/jpeg");
  assert.equal(contentType("/dist/ICON.SVG"), "image/svg+xml");
});

test("serve returns the dist/404.html body for a missing route when present", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-404-"));
  try {
    fs.writeFileSync(path.join(dist, "404.html"), "<h1>Custom not found</h1>");

    const captured = capture();
    serve(dist, "/does-not-exist/", captured.res);

    assert.equal(captured.res.statusCode, 404);
    assert.equal(captured.res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(captured.body(), "<h1>Custom not found</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve falls back to the inline 404 string when dist/404.html is absent", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-noindex-"));
  try {
    const captured = capture();
    serve(dist, "/does-not-exist/", captured.res);

    assert.equal(captured.res.statusCode, 404);
    assert.equal(captured.res.headers["content-type"], "text/html; charset=utf-8");
    assert.match(captured.body(), /Not found/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve sets security headers (incl. CSP) on a 200 HTML response", async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-csp-"));
  try {
    fs.writeFileSync(path.join(dist, "index.html"), "<h1>Home</h1>");
    const res = await request(dist, "/");

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
    const csp = res.headers["content-security-policy"];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(res.body, "<h1>Home</h1>");
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve does not attach the CSP to non-HTML assets", async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-asset-"));
  try {
    fs.mkdirSync(path.join(dist, "__wd"), { recursive: true });
    fs.writeFileSync(path.join(dist, "__wd", "runtime.js"), "export const x = 1;");
    const res = await request(dist, "/__wd/runtime.js");

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(res.headers["content-security-policy"], undefined);
    assert.equal(res.headers["x-content-type-options"], undefined);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("serve sets security headers on the 404 response", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "wd-serve-csp404-"));
  try {
    fs.writeFileSync(path.join(dist, "404.html"), "<h1>Custom not found</h1>");

    const captured = capture();
    serve(dist, "/does-not-exist/", captured.res);

    assert.equal(captured.res.statusCode, 404);
    assert.equal(captured.res.headers["X-Content-Type-Options"], "nosniff");
    assert.equal(captured.res.headers["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(captured.res.headers["X-Frame-Options"], "SAMEORIGIN");
    assert.match(captured.res.headers["Content-Security-Policy"], /default-src 'self'/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

// A minimal http.ServerResponse double that records status, headers, and body.
function capture() {
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
  return { res, body: () => chunks.join("") };
}

// Spin up the real static server (which streams 200 bodies via res.pipe) and
// make an actual HTTP request, returning status, headers, and body.
function request(distRoot, url) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => serve(distRoot, req.url || "/", res));
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      http
        .get({ host: "127.0.0.1", port, path: url }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString()
            });
          });
        })
        .on("error", (error) => {
          server.close();
          reject(error);
        });
    });
  });
}
