import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, renderCloudflareHeaders } from "../src/builder.js";
import { parseFrontmatter } from "../src/compiler.js";
import {
  BASE_SECURITY_HEADERS,
  REACTIVE_CSP,
  SPECULATION_RULES_HASH,
  SPECULATION_RULES_JSON,
  STATIC_CSP,
  securityHeaders
} from "../src/headers.js";

// ---------------------------------------------------------------------------
// Header constants — the CSP the framework's own output actually satisfies.
// ---------------------------------------------------------------------------

test("reactive CSP is eval-free (no unsafe-eval, no unsafe-inline on script-src) — identical to static", () => {
  // Since 2.1 the runtime walks a validated expression AST instead of building a
  // `new Function`, so the reactive policy needs no 'unsafe-eval' and is byte-for-
  // byte identical to the static one.
  assert.match(
    REACTIVE_CSP,
    new RegExp(
      `script-src 'self' ${escapeRe(SPECULATION_RULES_HASH)} 'inline-speculation-rules'(?:;| )`
    )
  );
  assert.doesNotMatch(REACTIVE_CSP, /'unsafe-eval'/);
  assert.equal(REACTIVE_CSP, STATIC_CSP, "reactive and static CSP are the same eval-free policy");
  assert.match(REACTIVE_CSP, /style-src 'self' 'unsafe-inline'/);
  assert.match(REACTIVE_CSP, /img-src 'self' data: https:/);
  assert.match(REACTIVE_CSP, /default-src 'self'/);
  assert.match(REACTIVE_CSP, /object-src 'none'/);
  assert.match(REACTIVE_CSP, /base-uri 'self'/);
  assert.match(REACTIVE_CSP, /form-action 'self'/);
  assert.match(REACTIVE_CSP, /frame-ancestors 'self'/);
});

test("neither CSP variant grants unsafe-inline on script-src", () => {
  // The state seed is a non-executable application/json data block (script-src
  // does not gate it) and the only inline script — speculationrules — is
  // authorized by its build-time sha256 hash, so unsafe-inline is gone. It must
  // only ever appear on style-src (view-transition inline <style>).
  for (const csp of [REACTIVE_CSP, STATIC_CSP]) {
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "));
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
    assert.match(scriptSrc, new RegExp(escapeRe(SPECULATION_RULES_HASH)));
    assert.match(scriptSrc, /'inline-speculation-rules'/);
  }
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

test("static CSP drops unsafe-eval and keeps inline style for view-transition styles", () => {
  assert.doesNotMatch(STATIC_CSP, /unsafe-eval/);
  assert.match(STATIC_CSP, /style-src 'self' 'unsafe-inline'/);
});

// ---------------------------------------------------------------------------
// Drift guard: the hash source must match the speculationrules block the page
// compiler actually emits. If page.js changes the rules, this fails before the
// deployed CSP silently starts blocking prerender.
// ---------------------------------------------------------------------------

test("the CSP hash matches the inline speculationrules script a built page emits", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "---\ntransitions: true\n---\n\n# Hi\n");
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const m = /<script type="speculationrules">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "expected a transitions: true page to emit a speculationrules script");
  assert.equal(m[1], SPECULATION_RULES_JSON);
  const hash = createHash("sha256").update(m[1]).digest("base64");
  assert.equal(SPECULATION_RULES_HASH, `'sha256-${hash}'`);
});

test("every inline script a reactive page emits is CSP-safe without unsafe-inline", () => {
  // Inventory check: inline <script> elements must be either non-executable
  // application/json data blocks (not gated by script-src) or the hashed
  // speculationrules constant. Anything else would be blocked by the shipped CSP.
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "transitions: true",
      "---",
      "",
      ":state count = 0",
      ':store theme = "auto"',
      ":computed double = count * 2",
      "Count: { count }",
      ':button "Add" -> count++'
    ].join("\n")
  );
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(inline.length > 0, "expected inline scripts to audit");
  for (const [, attrs, content] of inline) {
    if (/type="application\/json"/.test(attrs)) continue;
    assert.match(attrs, /type="speculationrules"/, `unexpected inline script: <script${attrs}>`);
    assert.equal(content, SPECULATION_RULES_JSON);
  }
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

/**
 * Resolve `_headers` the way Cloudflare Pages does, and answer WHICH block won.
 *
 * Comparing the resolved CSP *value* would be vacuous today: `STATIC_CSP` and
 * `REACTIVE_CSP` are byte-identical since 2.1, so a shadowed route "passes" no
 * matter which block claims it. The oracle is therefore the winning block's
 * PATTERN — which stays a real assertion if the two policies ever diverge again.
 * @param {string} text The generated `_headers` file.
 * @param {string} requestPath The path a visitor asks for.
 * @returns {string | undefined} The pattern of the last block that matched.
 */
function winningPattern(text, requestPath) {
  let winner;
  for (const block of text.trim().split("\n\n")) {
    const [pattern, ...lines] = block.split("\n");
    if (!lines.some((line) => line.includes("Content-Security-Policy:"))) continue;
    // Cloudflare's globs: `*` matches any run of characters, including `/`.
    const re = new RegExp(`^${pattern.split("*").map(escapeRe).join(".*")}$`);
    if (re.test(requestPath)) winner = pattern; // later block wins
  }
  return winner;
}

test("a static route's glob does not shadow a reactive route nested under it", () => {
  const manifest = [
    { route: "/", file: "site/pages/index.md", assets: { skins: [], scripts: [], runtime: false } },
    {
      route: "/docs/",
      file: "site/pages/docs/index.md",
      assets: { skins: [], scripts: [], runtime: false }
    },
    {
      route: "/docs/guide/",
      file: "site/pages/docs/guide/index.wd",
      assets: { skins: [], scripts: [], runtime: true }
    },
    {
      route: "/app/",
      file: "site/pages/app/index.wd",
      assets: { skins: [], scripts: [], runtime: true }
    }
  ];
  const out = renderCloudflareHeaders(manifest);

  // The static parent's `/docs/*` DOES match the nested reactive route, and
  // later blocks win — so without a re-statement the reactive route silently
  // resolves to its parent's policy. It must land on a block of its own.
  assert.equal(winningPattern(out, "/docs/guide/"), "/docs/guide/*");
  assert.equal(winningPattern(out, "/docs/guide"), "/docs/guide");
  // The static parent itself is unaffected.
  assert.equal(winningPattern(out, "/docs/"), "/docs/*");
  // A reactive route no static glob covers still needs no block of its own —
  // the catch-all already carries its policy, and `_headers` stays small.
  assert.equal(winningPattern(out, "/app/"), "/*");
  assert.doesNotMatch(out, /^\/app\/\*$/m);

  // And the policy the shadowed route resolves to is its own.
  const block = out.split("\n\n").find((b) => b.startsWith("/docs/guide/*\n"));
  assert.match(block, new RegExp(`Content-Security-Policy: ${escapeRe(REACTIVE_CSP)}`));
});

test("a real build's _headers gives a nested reactive route its own block", () => {
  const root = fixture();
  write(root, "site/pages/index.md", "# Home\n\nStatic.");
  write(root, "site/pages/docs/index.md", "# Docs\n\nStatic parent.");
  write(
    root,
    "site/pages/docs/guide/index.wd",
    [":state count = 0", "Count: { count }", ':button "Increment" -> count++'].join("\n")
  );
  buildSite(root);

  const out = fs.readFileSync(path.join(root, "dist/_headers"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));
  assert.equal(
    manifest.find((entry) => entry.route === "/docs/guide/").assets.runtime,
    true,
    "the nested route really is reactive"
  );
  assert.equal(winningPattern(out, "/docs/guide/"), "/docs/guide/*");
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

  // Catch-all baseline + the (now eval-free) reactive CSP.
  assert.match(headers, /^\/\*\n/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Content-Security-Policy:/);
  assert.doesNotMatch(headers, /'unsafe-eval'/);

  // The static /about route still gets a dedicated CSP override block; the reactive
  // root does not (it inherits the catch-all CSP — now identical and eval-free).
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

test("vercel.json resolves EVERY route — static (incl. nested) and reactive — to the eval-free CSP", () => {
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
      `reactive route ${r.route} (served at ${servedPath(r.route)}) resolves to the wrong CSP — since 2.1 the runtime walks a validated AST (no eval), so its CSP is the same eval-free policy as static routes.`
    );
  }
});

// The static-route rules are now defense-in-depth: since 2.1 no page evals (the
// reactive runtime walks a validated AST), so the catch-all CSP is already eval-
// free and these per-route overrides carry the same policy — they stay as a guard
// so statics remain strict even if someone re-widens the catch-all. Vercel applies
// all matching header rules and the last match wins per key. (`connect-src 'self'`
// fits same-origin :fetch — widen it if your :fetch targets a remote host.) This
// note lives HERE, not in vercel.json: Vercel validates vercel.json against a
// strict schema and REJECTS unknown properties (a stray `"comment"` key once broke
// every deploy).
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

// ---------------------------------------------------------------------------
// Drift guard: host canonicalisation is the DOMAIN's job, never the router's.
//
// The site ships default-src/style-src/script-src 'self', so a document is only
// styled if its assets resolve to the SAME origin that served it. A redirect in
// vercel.json cannot safely move a request to another host, because Vercel
// applies it per-path: a `/:path*` source matched every asset (`/__wd/*.css`,
// `/rss.xml` — no trailing slash) but NOT the trailing-slash page routes this
// site is built on. www.darkmown.com therefore served its own HTML while every
// stylesheet and script 308'd to the apex, and 'self' blocked all six. The site
// rendered with zero CSS and no runtime for anyone who typed the www host.
//
// A PARTIAL host redirect is strictly worse than none: with no rule at all the
// alternate host merely serves a duplicate (working) site. So the rule is not
// "write a better pattern", it is "vercel.json never conditions a redirect on
// the host". Canonicalisation lives in the Vercel domain config instead
// (www.darkmown.com -> darkmown.com, 308), which runs ahead of all routing and
// cannot match only some paths.
// ---------------------------------------------------------------------------
test("vercel.json declares no host-conditioned redirect — canonical-host redirects belong to the domain config", () => {
  const repoRoot = process.cwd();
  const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));

  // The home page frontmatter carries the site's identity (see the SEO docs).
  const home = fs.readFileSync(path.join(repoRoot, "site/pages/index.wd"), "utf8");
  const { meta } = parseFrontmatter(home);
  assert.ok(
    meta.site_url,
    "site/pages/index.wd must declare site_url for this guard to have an origin"
  );
  const ownOrigin = new URL(String(meta.site_url)).origin;

  for (const rule of vercel.redirects || []) {
    const hostRule = (rule.has || []).find((h) => h.type === "host");
    assert.ok(
      !hostRule,
      `vercel.json redirects "${rule.source}" conditioned on host "${hostRule?.value}". Vercel applies redirects per-path, so a source like /:path* fires for asset paths (no trailing slash) but NOT for the trailing-slash page routes this site is built on — the alternate host keeps serving HTML while its assets move to another origin, and default-src 'self' blocks every one. Redirect the host in the Vercel domain config instead.`
    );

    // A redirect to a genuinely foreign origin has the same effect for any
    // sub-resource it lands on, so it is out too.
    const dest = String(rule.destination || "");
    if (!/^https?:\/\//.test(dest)) continue; // relative destination stays on-origin
    assert.equal(
      new URL(dest.replace(/[:$]\w+\*?/g, "x")).origin,
      ownOrigin,
      `vercel.json redirects "${rule.source}" to a foreign origin (${dest}), which no 'self' CSP on this site can authorize.`
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
