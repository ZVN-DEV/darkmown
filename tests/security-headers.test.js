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
  assert.match(REACTIVE_CSP, /form-action 'self'/);
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
// static-CSP rules against the real demo build by resolving the CSP each FULL
// route path would actually receive on Vercel — so a NESTED static route (e.g.
// /blog/<slug>/) can't silently fall through to the relaxed (unsafe-eval) CSP.
//
// Vercel matches a header rule's `source` with path-to-regexp and applies every
// matching rule in order; for a repeated header key the LAST match wins. We mirror
// that here: compile each rule's `source` to a RegExp, run the route's served URL
// (clean-URL, no trailing slash) through them in order, and take the last CSP.
// ---------------------------------------------------------------------------

/**
 * Translate the subset of path-to-regexp syntax our vercel.json uses into a
 * RegExp, the way Vercel compiles a header rule `source`. Handles literal path
 * segments, a `(a|b|c)` alternation group, and a trailing `:path*` (zero-or-more
 * descendant segments). Anchored full-match, like Vercel.
 * @param {string} source
 * @returns {RegExp}
 */
function vercelSourceToRegExp(source) {
  let re = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") {
      // path-to-regexp passes a `(...)` group through as a raw regex (e.g. the
      // catch-all `(.*)` or the alternation `(docs|blog|…)` whose segment names
      // carry no regex metachars), so emit its contents verbatim.
      const end = source.indexOf(")", i);
      re += `(?:${source.slice(i + 1, end)})`;
      i = end;
    } else if (source.startsWith(":path*", i)) {
      // Zero-or-more trailing path segments. The preceding "/" is already emitted,
      // so make that slash + the rest optional: matches both `/blog` and `/blog/x`.
      re = `${re.replace(/\/$/, "")}(?:/.*)?`;
      i += ":path*".length - 1;
    } else {
      re += escapeRe(ch);
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Resolve the Content-Security-Policy a given URL path receives on Vercel: walk
 * every header rule in order, and for each rule whose `source` matches, take its
 * CSP — last writer wins (Vercel's behavior for a repeated header key).
 * @param {{ source: string, headers: { key: string, value: string }[] }[]} rules
 * @param {string} urlPath
 * @returns {string | null}
 */
function resolveVercelCsp(rules, urlPath) {
  let csp = null;
  for (const rule of rules) {
    if (!vercelSourceToRegExp(rule.source).test(urlPath)) continue;
    for (const h of rule.headers || []) {
      if (h.key === "Content-Security-Policy") csp = h.value;
    }
  }
  return csp;
}

test("vercel.json applies the strict CSP to EVERY static route — incl. nested — and relaxed to reactive", () => {
  const repoRoot = process.cwd();
  const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  const rules = vercel.headers || [];

  // Build the real demo (copied into a temp dir so we never clobber ./dist).
  const root = fixture();
  fs.cpSync(path.join(repoRoot, "site"), path.join(root, "site"), { recursive: true });
  buildSite(root);
  const routes = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));

  const staticRoutes = routes.filter((r) => r.assets.runtime === false);
  const reactiveRoutes = routes.filter((r) => r.assets.runtime === true);
  assert.ok(staticRoutes.length > 0, "expected at least one static demo route");
  assert.ok(reactiveRoutes.length > 0, "expected at least one reactive demo route");
  // The demo must include a NESTED static route, or this guard can't catch the bug
  // it exists to catch (a slug/pager route inheriting the relaxed CSP).
  assert.ok(
    staticRoutes.some((r) => r.route.replace(/^\/|\/$/g, "").includes("/")),
    "expected a nested static demo route (e.g. /blog/<slug>/) to exercise the guard"
  );

  // cleanUrls + trailingSlash:false → "/blog/shipping-feeds/" is served at
  // "/blog/shipping-feeds". The root "/" maps to "/".
  const servedPath = (route) => (route === "/" ? "/" : route.replace(/\/$/, ""));

  for (const r of staticRoutes) {
    const csp = resolveVercelCsp(rules, servedPath(r.route));
    assert.equal(
      csp,
      STATIC_CSP,
      `static route ${r.route} (served at ${servedPath(r.route)}) resolves to a CSP that is NOT the strict eval-free policy — it drifts to the relaxed (unsafe-eval) CSP on Vercel. Extend the vercel.json static-CSP source to cover it.`
    );
  }
  for (const r of reactiveRoutes) {
    const csp = resolveVercelCsp(rules, servedPath(r.route));
    assert.equal(
      csp,
      REACTIVE_CSP,
      `reactive route ${r.route} (served at ${servedPath(r.route)}) must keep the relaxed CSP — a strict CSP breaks its runtime new Function().`
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

// A native `:form action="/api/…"` POSTs same-origin; `form-action 'self'` permits
// it while blocking a form that tries to exfiltrate to a third-party origin. The
// directive must be present in BOTH CSP variants (headers.js → statics.js +
// dist/_headers) AND in every CSP string in the hand-maintained vercel.json copy,
// or a form silently breaks on one delivery surface. This guards that sync.
test("form-action 'self' is present in both CSP variants and in vercel.json", () => {
  for (const csp of [REACTIVE_CSP, STATIC_CSP]) {
    assert.match(csp, /form-action 'self'/, "headers.js CSP must authorize same-origin form posts");
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
  const cspValues = (vercel.headers || [])
    .flatMap((rule) => rule.headers || [])
    .filter((h) => h.key === "Content-Security-Policy")
    .map((h) => h.value);
  assert.ok(cspValues.length >= 1, "vercel.json must define at least one CSP");
  for (const value of cspValues) {
    assert.match(
      value,
      /form-action 'self'/,
      "vercel.json CSP is missing form-action 'self' — it drifted from headers.js, so native form posts break on Vercel"
    );
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
