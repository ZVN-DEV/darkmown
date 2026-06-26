import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { injectDevClient } from "../src/dev.js";
import { resolvePublicFile, serve } from "../src/statics.js";

test("public file resolution stays inside dist", () => {
  const dist = "/tmp/example/dist";

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
  const dist = "/tmp/example/dist";
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
