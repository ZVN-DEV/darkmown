// CLI / pipeline end-to-end tests — zero-dependency.
//
// Simulates the real user journey, browser-free, against the actual CLI:
//   init -> build -> inspect output -> serve over HTTP -> negative paths.
//
// Uses ONLY node:test, node:assert and Node built-ins. No new dependencies.
// Each scenario gets its own unique temp dir under os.tmpdir(), cleaned up
// afterwards. The HTTP server binds to an ephemeral port (listen(0)) so the
// suite never collides with a busy port and stays CI-safe.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = path.join(repoRoot, "src", "cli.js");

// Generous timeout: spawning Node + compiling a site is slower than a unit test,
// especially on a cold CI runner.
const STEP_TIMEOUT = 60_000;

// --- helpers ---------------------------------------------------------------

const tempDirs = new Set();

function freshDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `darkmown-e2e-${label}-`));
  tempDirs.add(dir);
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.delete(dir);
}

// Run the real CLI. Resolves with { code, stdout, stderr } even on non-zero
// exit, so negative-path tests can inspect the failure instead of throwing.
async function runCli(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args], {
      cwd,
      timeout: STEP_TIMEOUT,
      encoding: "utf8"
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout || "",
      stderr: error.stderr || ""
    };
  }
}

// Start an http.Server backed by the framework's own static resolver, on an
// ephemeral port. Returns { origin, close }.
async function startServer(distRoot) {
  const { serve } = await import("../src/statics.js");
  const server = http.createServer((req, res) => serve(distRoot, req.url || "/", res));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// Fetch a path over real HTTP and read the full body.
function httpGet(origin, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}${urlPath}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(STEP_TIMEOUT, () => req.destroy(new Error("HTTP request timed out")));
  });
}

test.after(() => {
  for (const dir of [...tempDirs]) cleanup(dir);
});

// --- the journey -----------------------------------------------------------

test("full user journey: init -> build -> serve -> fetch", {
  timeout: STEP_TIMEOUT * 4
}, async (t) => {
  const root = freshDir("journey");

  // 1. SCAFFOLD — run the real `init` into a fresh empty dir.
  await t.test("init scaffolds the expected project files", async () => {
    const result = await runCli(["init", "."], root);
    assert.equal(result.code, 0, `init should exit 0\n${result.stderr}`);
    assert.match(result.stdout, /Created Darkmown project/);

    // Verified against src/scaffold.js actual output.
    for (const rel of [
      "package.json",
      "site/pages/index.wd",
      "site/pages/index.skin",
      "site/_/nav.wd",
      "site/pages/about.md",
      "README.md"
    ]) {
      assert.ok(fs.existsSync(path.join(root, rel)), `expected scaffold file ${rel}`);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.name, path.basename(root).toLowerCase());
    assert.equal(pkg.private, true);
    assert.equal(pkg.scripts.preview, "darkmown serve");
    assert.equal(pkg.devDependencies["@zvndev/darkmown"], `^${rootPkg.version}`);
  });

  // 2. BUILD — compile the scaffolded site.
  await t.test("build compiles dist with html, routes.json and assets", async () => {
    const result = await runCli(["build"], root);
    assert.equal(result.code, 0, `build should exit 0\n${result.stderr}`);
    assert.match(result.stdout, /Built \d+ routes/);

    const dist = path.join(root, "dist");
    assert.ok(fs.existsSync(path.join(dist, "index.html")), "dist/index.html");
    assert.ok(fs.existsSync(path.join(dist, "routes.json")), "dist/routes.json");
    assert.ok(fs.existsSync(path.join(dist, "about", "index.html")), "dist/about/index.html");
    // Reactive scaffold index pulls in the shared runtime under /__wd/.
    assert.ok(fs.existsSync(path.join(dist, "__wd", "runtime.js")), "dist/__wd/runtime.js");
    // Every build emits a 404 page for hosts (and the local server) to serve on misses.
    assert.ok(fs.existsSync(path.join(dist, "404.html")), "dist/404.html");
  });

  // 3. OUTPUT CORRECTNESS — parse routes.json + assert static/reactive gating.
  await t.test("routes.json + html honour static vs reactive gating", () => {
    const dist = path.join(root, "dist");
    const routes = JSON.parse(fs.readFileSync(path.join(dist, "routes.json"), "utf8"));

    const byRoute = new Map(routes.map((r) => [r.route, r]));
    const home = byRoute.get("/"); // index.wd — reactive (has :state/@loop)
    const about = byRoute.get("/about/"); // about.md — plain markdown, static

    assert.ok(home, "expected a / route");
    assert.ok(about, "expected an /about/ route");

    // Reactive page: runtime true + runtime script wired in the manifest.
    assert.equal(home.assets.runtime, true, "home should be reactive");
    assert.ok(home.assets.scripts.includes("/__wd/runtime.js"), "home manifest lists runtime.js");

    // Static page: runtime false + no runtime script. .md never goes reactive.
    assert.equal(about.assets.runtime, false, "about (.md) must stay static");
    assert.ok(
      !about.assets.scripts.includes("/__wd/runtime.js"),
      "static page manifest must not list runtime.js"
    );

    // HTML-level proof of the same invariant.
    const homeHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    const aboutHtml = fs.readFileSync(path.join(dist, "about", "index.html"), "utf8");

    assert.match(homeHtml, /data-wd-/, "reactive html should carry data-wd-* bindings");
    assert.match(homeHtml, /\/__wd\/runtime\.js/, "reactive html should load the runtime");

    assert.doesNotMatch(aboutHtml, /data-wd-/, "static html must have no data-wd-* bindings");
    assert.doesNotMatch(aboutHtml, /\/__wd\/runtime\.js/, "static html must not load the runtime");
  });

  // 4. SERVE + HTTP FETCH — real http.Server on an ephemeral port.
  await t.test("static server answers two routes over real HTTP", async () => {
    const dist = path.join(root, "dist");
    const server = await startServer(dist);
    try {
      const home = await httpGet(server.origin, "/");
      assert.equal(home.status, 200, "GET / -> 200");
      assert.match(home.body, /My Darkmown site/, "home body content");
      assert.match(home.body, /data-wd-/, "home served with reactive bindings");

      const about = await httpGet(server.origin, "/about/");
      assert.equal(about.status, 200, "GET /about/ -> 200");
      assert.match(about.body, /About/, "about body content");
      assert.doesNotMatch(about.body, /data-wd-/, "about served static");

      // A genuinely missing route resolves to a 404, served from dist/404.html.
      const missing = await httpGet(server.origin, "/does-not-exist/");
      assert.equal(missing.status, 404, "unknown route -> 404");
      assert.equal(
        missing.headers["content-type"],
        "text/html; charset=utf-8",
        "404 served as html"
      );
      const notFoundHtml = fs.readFileSync(path.join(dist, "404.html"), "utf8");
      assert.equal(missing.body, notFoundHtml, "404 body comes from dist/404.html");
    } finally {
      await server.close();
    }
  });
});

// --- negative paths --------------------------------------------------------

test("build fails on a .wd compile error with an actionable message", {
  timeout: STEP_TIMEOUT * 2
}, async () => {
  const root = freshDir("compile-error");
  const init = await runCli(["init", "."], root);
  assert.equal(init.code, 0, `init should exit 0\n${init.stderr}`);

  // Deliberately malformed directive: a :computed with no expression.
  fs.writeFileSync(
    path.join(root, "site/pages/broken.wd"),
    ["---", "title: Broken", "---", "", ":computed total =", ""].join("\n")
  );

  const result = await runCli(["build"], root);
  assert.notEqual(result.code, 0, "build must exit non-zero on a compile error");

  const message = `${result.stderr}\n${result.stdout}`;
  // Actionable: names the offending file AND offers a corrective "Use:" hint.
  assert.match(message, /broken\.wd/, "error names the offending file path");
  assert.match(message, /Use:/, "error includes a corrective Use: suggestion");
});

test("build surfaces the .md-contains-directive hint", { timeout: STEP_TIMEOUT * 2 }, async () => {
  const root = freshDir("md-hint");
  const init = await runCli(["init", "."], root);
  assert.equal(init.code, 0, `init should exit 0\n${init.stderr}`);

  // A .md file that contains .wd directive syntax. .md is the feature gate, so
  // the directive stays inert — the build must warn (but still succeed).
  fs.writeFileSync(
    path.join(root, "site/pages/hintpage.md"),
    ["---", "title: Hint", "---", "", "# Hint page", "", ":state count = 0", ""].join("\n")
  );

  const result = await runCli(["build"], root);
  assert.equal(
    result.code,
    0,
    `.md hint is non-fatal; build should still exit 0\n${result.stderr}`
  );

  const message = `${result.stderr}\n${result.stdout}`;
  assert.match(message, /hintpage\.md/, "hint names the .md file");
  assert.match(message, /\.wd syntax|rename the file to \.wd/, "hint explains the .md/.wd gate");
});
