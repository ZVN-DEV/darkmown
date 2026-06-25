import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, renderCloudflareHeaders } from "../src/builder.js";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP, STATIC_CSP, securityHeaders } from "../src/headers.js";

// ---------------------------------------------------------------------------
// Header constants — the CSP the framework's own output actually satisfies.
// ---------------------------------------------------------------------------

test("reactive CSP allows unsafe-eval (new Function) and unsafe-inline", () => {
  assert.match(REACTIVE_CSP, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
  assert.match(REACTIVE_CSP, /style-src 'self' 'unsafe-inline'/);
  assert.match(REACTIVE_CSP, /img-src 'self' data: https:/);
  assert.match(REACTIVE_CSP, /default-src 'self'/);
  assert.match(REACTIVE_CSP, /object-src 'none'/);
  assert.match(REACTIVE_CSP, /base-uri 'self'/);
  assert.match(REACTIVE_CSP, /frame-ancestors 'self'/);
});

test("static CSP drops unsafe-eval but keeps inline script/style for speculationrules and view-transition styles", () => {
  assert.match(STATIC_CSP, /script-src 'self' 'unsafe-inline'(?!.*unsafe-eval)/);
  assert.doesNotMatch(STATIC_CSP, /unsafe-eval/);
  assert.match(STATIC_CSP, /style-src 'self' 'unsafe-inline'/);
});

test("securityHeaders bundles the baseline headers with the right CSP per route kind", () => {
  const reactive = securityHeaders(true);
  const stat = securityHeaders(false);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    assert.equal(reactive[name], value);
    assert.equal(stat[name], value);
  }
  assert.equal(reactive["Content-Security-Policy"], REACTIVE_CSP);
  assert.equal(stat["Content-Security-Policy"], STATIC_CSP);
});

// ---------------------------------------------------------------------------
// Cloudflare _headers rendering.
// ---------------------------------------------------------------------------

test("renderCloudflareHeaders emits a catch-all with baseline headers + reactive CSP", () => {
  const out = renderCloudflareHeaders([]);
  assert.match(out, /^\/\*\n/);
  assert.match(out, /X-Content-Type-Options: nosniff/);
  assert.match(out, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(out, /X-Frame-Options: SAMEORIGIN/);
  assert.match(out, new RegExp(`Content-Security-Policy: ${escapeRe(REACTIVE_CSP)}`));
});

test("renderCloudflareHeaders overrides static routes with the eval-free CSP and leaves reactive ones to the catch-all", () => {
  const manifest = [
    { route: "/", file: "site/pages/index.wd", assets: { skins: [], scripts: [], runtime: true } },
    { route: "/docs/", file: "site/pages/docs/index.wd", assets: { skins: [], scripts: [], runtime: false } }
  ];
  const out = renderCloudflareHeaders(manifest);

  // Reactive root has no dedicated block — it inherits the catch-all relaxed CSP.
  assert.doesNotMatch(out, /^\/\n/m);
  assert.doesNotMatch(out, /^\/index\.html\n/m);

  // Static /docs gets both clean-URL forms with the strict CSP.
  assert.match(out, /^\/docs\n {2}Content-Security-Policy:/m);
  assert.match(out, /^\/docs\/\*\n {2}Content-Security-Policy:/m);
  assert.match(out, new RegExp(`/docs\\n {2}Content-Security-Policy: ${escapeRe(STATIC_CSP)}`));
});

// ---------------------------------------------------------------------------
// End-to-end: a real build writes dist/_headers.
// ---------------------------------------------------------------------------

test("npm run build writes dist/_headers with the CSP for static and reactive routes", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    "Count: { count }",
    ":button \"Increment\" -> count++"
  ].join("\n"));
  write(root, "site/pages/about.wd", "# About\n\nPlain static copy.");

  buildSite(root);

  const headersPath = path.join(root, "dist/_headers");
  assert.equal(fs.existsSync(headersPath), true);
  const headers = fs.readFileSync(headersPath, "utf8");

  // Catch-all baseline + relaxed CSP.
  assert.match(headers, /^\/\*\n/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Content-Security-Policy:.*'unsafe-eval'/);

  // The static /about route gets a dedicated eval-free override; the reactive
  // root does not (it inherits the relaxed catch-all CSP).
  assert.match(headers, /^\/about\n/m);
  assert.doesNotMatch(headers, /^\/\n/m);
});

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-security-headers-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
