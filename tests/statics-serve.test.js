import assert from "node:assert/strict";
import fs from "node:fs";
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
