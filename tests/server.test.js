import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { injectDevClient } from "../src/dev.js";
import { resolvePublicFile } from "../src/server.js";

test("public file resolution stays inside dist", () => {
  const dist = "/tmp/example/dist";

  assert.equal(resolvePublicFile(dist, "/"), path.join(dist, "index.html"));
  assert.equal(resolvePublicFile(dist, "/docs/"), path.join(dist, "docs/index.html"));
  assert.equal(resolvePublicFile(dist, "/__wd/scripts/app.js"), path.join(dist, "__wd/scripts/app.js"));
  assert.equal(resolvePublicFile(dist, "/__wd/../../package.json"), null);
  assert.equal(resolvePublicFile(dist, "/__wd/%2e%2e/%2e%2e/package.json"), null);
});

test("dev client injection is a development-only html transform", () => {
  const html = "<html><body><h1>Demo</h1></body></html>";
  const injected = injectDevClient(html);
  assert.match(injected, /\/__wd\/dev-client\.js/);
  assert.match(injected, /<\/script>\n<\/body>/);
});
