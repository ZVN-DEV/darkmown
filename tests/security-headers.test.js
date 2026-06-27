import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, renderCloudflareHeaders } from "../src/builder.js";
import {
  BASE_SECURITY_HEADERS,
  REACTIVE_CSP,
  STATIC_CSP,
  securityHeaders
} from "../src/headers.js";

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

test("CSP pre-authorizes exactly the media/embed targets the framework emits", () => {
  // :video/:audio allow relative or http(s) sources; :embed only ever rewrites to
  // the YouTube no-cookie and Vimeo player origins. Both CSP variants share these.
  for (const csp of [REACTIVE_CSP, STATIC_CSP]) {
    assert.match(csp, /media-src 'self' https:/);
    assert.match(
      csp,
      /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com/
    );
    // Scoped to named hosts — never a wildcard frame-src.
    assert.doesNotMatch(csp, /frame-src[^;]*\*/);
  }
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
    {
      route: "/docs/",
      file: "site/pages/docs/index.wd",
      assets: { skins: [], scripts: [], runtime: false }
    }
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
  write(
    root,
    "site/pages/index.wd",
    [":state count = 0", "Count: { count }", ':button "Increment" -> count++'].join("\n")
  );
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

// ---------------------------------------------------------------------------
// Drift guard: vercel.json is hand-maintained (Vercel reads it before the build,
// so it can't be generated from the manifest like _headers). Cross-check its
// static-CSP route list against the real demo build so a new static route can't
// silently miss the eval-free CSP on Vercel.
// ---------------------------------------------------------------------------

test("vercel.json static-CSP route list covers every runtime:false demo route", () => {
  const repoRoot = process.cwd();
  const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  const staticRule = (vercel.headers || []).find((h) =>
    (h.headers || []).some(
      (x) => x.key === "Content-Security-Policy" && !x.value.includes("unsafe-eval")
    )
  );
  assert.ok(staticRule, "vercel.json must define a static (eval-free) CSP rule");
  const alts = (staticRule.source.match(/\(([^)]+)\)/) || ["", ""])[1].split("|").filter(Boolean);

  // Build the real demo (copied into a temp dir so we never clobber ./dist).
  const root = fixture();
  fs.cpSync(path.join(repoRoot, "site"), path.join(root, "site"), { recursive: true });
  buildSite(root);
  const routes = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));

  const staticRoutes = routes.filter((r) => r.assets.runtime === false);
  assert.ok(staticRoutes.length > 0, "expected at least one static demo route");
  for (const r of staticRoutes) {
    const segment = r.route.replace(/^\//, "").split("/")[0] || "";
    assert.ok(
      alts.includes(segment),
      `static route ${r.route} (segment "${segment}") is missing from vercel.json static-CSP source /(${alts.join("|")})/ — add it or its CSP drifts to the relaxed (unsafe-eval) policy on Vercel.`
    );
  }
});

// Why the static-route rule exists: static routes ship zero framework JS, so they
// never call `new Function`; this second, more-specific rule drops 'unsafe-eval'
// for them. Vercel applies all matching header rules and the last match wins per
// key, so it overrides the catch-all CSP. (`connect-src 'self'` fits same-origin
// :fetch — widen it if your :fetch targets a remote host.) This note lives HERE,
// not in vercel.json: Vercel validates vercel.json against a strict schema and
// REJECTS unknown properties (a stray `"comment"` key once broke every deploy).
test("vercel.json header rules contain only Vercel-allowed properties", () => {
  // Guards the deploy-breaking class: Vercel rejects unknown keys in a headers[]
  // entry (e.g. a `comment`), failing the build before it starts. Keep this green.
  const ALLOWED = new Set(["source", "headers", "has", "missing"]);
  const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
  for (const [i, rule] of (vercel.headers || []).entries()) {
    for (const key of Object.keys(rule)) {
      assert.ok(
        ALLOWED.has(key),
        `vercel.json headers[${i}] has invalid property "${key}" — Vercel rejects unknown keys and fails the build. Allowed: ${[...ALLOWED].join(", ")}.`
      );
    }
  }
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
