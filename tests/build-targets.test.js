import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSite } from "../src/builder.js";

/** A minimal ESM project: one static page + the given api functions. */
function project(apiFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-target-"));
  // type:module so the copied api/*.js import as ESM (templates set this too).
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.md"), "# Home\n");
  for (const [rel, source] of Object.entries(apiFiles)) {
    const abs = path.join(root, "api", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return root;
}

/** Run `fn`, returning everything it logged via console.warn. */
function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test("default build emits no _worker.js (api/ is left for the platform)", () => {
  const root = project({ "echo.js": "export default () => Response.json({})" });
  buildSite(root);
  assert.equal(fs.existsSync(path.join(root, "dist/_worker.js")), false);
});

test("cloudflare target emits dist/_worker.js with copied handlers + a route table", () => {
  const root = project({
    "echo.js": "export default () => Response.json({ ok: true })",
    "users/[id].js": "export default (r, c) => Response.json({ id: c.params.id })"
  });
  buildSite(root, { target: "cloudflare" });

  const workerDir = path.join(root, "dist/_worker.js");
  assert.ok(fs.existsSync(path.join(workerDir, "index.js")), "worker entry emitted");
  assert.ok(fs.existsSync(path.join(workerDir, "api/echo.js")), "echo handler copied");
  assert.ok(fs.existsSync(path.join(workerDir, "api/users/[id].js")), "dynamic handler copied");

  const index = fs.readFileSync(path.join(workerDir, "index.js"), "utf8");
  assert.match(index, /import h0 from "\.\/api\//);
  assert.match(index, /env\.ASSETS\.fetch\(request\)/, "falls through to static assets");
  assert.match(index, /segments: \["echo"\]/);
  assert.match(index, /segments: \["users","\[id\]"\]/);
});

test("cloudflare target with no api/ functions emits no worker", () => {
  const root = project();
  buildSite(root, { target: "cloudflare" });
  assert.equal(fs.existsSync(path.join(root, "dist/_worker.js")), false);
});

test("build warns when two api handlers resolve to the same /api path", () => {
  const root = project({
    "users.js": "export default () => Response.json({ from: 'flat' })",
    "users/index.js": "export default () => Response.json({ from: 'index' })"
  });
  const warnings = captureWarnings(() => buildSite(root));
  assert.ok(
    warnings.some((w) => /resolve to \/api\/users/.test(w) && /only one is reachable/.test(w)),
    `expected a collision warning, got: ${warnings.join(" | ")}`
  );
});

test("build does not warn for distinct dynamic siblings under different parents", () => {
  const root = project({
    "users/[id].js": "export default () => Response.json({})",
    "posts/[slug].js": "export default () => Response.json({})"
  });
  const warnings = captureWarnings(() => buildSite(root));
  assert.equal(
    warnings.some((w) => /resolve to \/api\//.test(w)),
    false,
    `unexpected collision warning: ${warnings.join(" | ")}`
  );
});

test("cloudflare build warns on a bare npm import in a handler (no bundler)", () => {
  const root = project({
    "hit.js": "import slug from 'slugify';\nexport default () => Response.json({ slug })",
    "clean.js": "import { ok } from './_util.js';\nexport default () => Response.json({ ok })"
  });
  const warnings = captureWarnings(() => buildSite(root, { target: "cloudflare" }));
  assert.ok(
    warnings.some((w) => /api\/hit\.js/.test(w) && /slugify/.test(w) && /bundler/.test(w)),
    `expected a bare-import warning, got: ${warnings.join(" | ")}`
  );
  // Relative imports are fine — clean.js must not be flagged.
  assert.equal(
    warnings.some((w) => /api\/clean\.js/.test(w)),
    false,
    `relative import wrongly flagged: ${warnings.join(" | ")}`
  );
});

// The generated worker is real, runnable code: load its default export and drive
// its fetch() with a stub ASSETS binding to prove routing + static fallthrough.
test("generated cloudflare worker routes /api/* and falls through to ASSETS", async () => {
  const root = project({
    "echo.js": "export default () => Response.json({ ok: true, who: 'echo' })",
    "users/[id].js": "export default (r, c) => Response.json({ id: c.params.id })"
  });
  buildSite(root, { target: "cloudflare" });

  // The generated worker + its copied handlers are ESM (project package.json sets
  // type:module). Import it and drive its fetch() directly.
  const workerUrl = pathToFileURL(path.join(root, "dist/_worker.js/index.js"));
  const worker = (await import(workerUrl.href)).default;

  const assetsCalls = [];
  const env = {
    ASSETS: {
      fetch(request) {
        assetsCalls.push(new URL(request.url).pathname);
        return new Response("STATIC", { status: 200 });
      }
    }
  };

  const echo = await worker.fetch(new Request("https://x/api/echo"), env, {});
  assert.deepEqual(await echo.json(), { ok: true, who: "echo" });

  const dyn = await worker.fetch(new Request("https://x/api/users/7"), env, {});
  assert.deepEqual(await dyn.json(), { id: "7" });

  const stat = await worker.fetch(new Request("https://x/about/"), env, {});
  assert.equal(await stat.text(), "STATIC");
  assert.deepEqual(assetsCalls, ["/about/"]);
});
