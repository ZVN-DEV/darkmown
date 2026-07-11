// In-process unit coverage for src/cli.js.
//
// The CLI's command dispatch lives in an exported `run(argv, env)` that takes an
// injectable { cwd, log, warn, error } and RETURNS instead of touching
// process.argv / process.exit. That lets every branch — help, version, init,
// build (success + failClean error path), unknown command, and the dev/serve
// servers — run in this process so V8 attributes their coverage here. The
// servers start on an ephemeral port (PORT=0), get a real HTTP + SSE request,
// then shut down cleanly via the returned close() so coverage flushes.
//
// External binary behavior is covered by tests/cli.test.js + cli-e2e.test.js
// (subprocess spawns); those must stay green. This file is purely additive.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSummary,
  CliError,
  flagValues,
  helpText,
  isEntryPoint,
  nextStep,
  run
} from "../src/cli.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function freshDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `darkmown-cli-${label}-`));
}

// A capturing IO env: collects everything written to log/warn/error.
function capture(cwd) {
  const out = { log: [], warn: [], error: [] };
  return {
    env: {
      cwd,
      log: (...a) => out.log.push(a.join(" ")),
      warn: (...a) => out.warn.push(a.join(" ")),
      error: (...a) => out.error.push(a.join(" "))
    },
    out,
    stdout: () => out.log.join("\n"),
    stderr: () => out.error.join("\n")
  };
}

// GET a path over real HTTP and read the full body.
function httpGet(origin, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}${urlPath}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", reject);
  });
}

// POST a form body over real HTTP.
function httpPost(origin, urlPath, formBody) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${origin}${urlPath}`,
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end(formBody);
  });
}

// Open the SSE channel and resolve with the first chunk of events received.
function readSse(origin, urlPath, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}${urlPath}`, (res) => {
      let data = "";
      res.setEncoding("utf8");
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ status: res.statusCode, headers: res.headers, data });
      }, timeout);
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("error", () => {});
      timer.unref?.();
    });
    req.on("error", reject);
  });
}

function originOf(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

// --- help / version --------------------------------------------------------

test("run('help') prints the usage banner via the injected log sink", async () => {
  const c = capture(process.cwd());
  const result = await run(["help"], c.env);
  assert.equal(result.command, "help");
  assert.match(c.stdout(), /Usage:/);
  assert.match(c.stdout(), /darkmown init/);
});

test("run() with no args (bare command) prints help", async () => {
  const c = capture(process.cwd());
  const result = await run([], c.env);
  assert.equal(result.command, "help");
  assert.match(c.stdout(), /Usage:/);
});

test("run('--help') and run('-h') both print help", async () => {
  for (const flag of ["--help", "-h"]) {
    const c = capture(process.cwd());
    await run([flag], c.env);
    assert.match(c.stdout(), /Usage:/);
  }
});

test("run('version') prints the package version", async () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const flag of ["version", "--version", "-v"]) {
    const c = capture(process.cwd());
    const result = await run([flag], c.env);
    assert.equal(result.command, "version");
    assert.equal(c.out.log[0], pkg.version);
  }
});

test("helpText() and nextStep() are exported pure helpers", () => {
  assert.match(helpText(), /Darkmown/);
  assert.equal(nextStep("."), "npm install && npm run dev");
  assert.equal(nextStep("demo"), "cd demo && npm install && npm run dev");
});

test("isEntryPoint detects the binary path, a symlink to it, and rejects others", () => {
  // No entry arg → not the binary (e.g. imported in a worker).
  assert.equal(isEntryPoint(undefined), false);
  // The exact module path → the binary.
  assert.equal(isEntryPoint(cliPath), true);
  // A symlink pointing at cli.js → still the binary (npm's .bin/darkmown case).
  const dir = freshDir("entry-link");
  const link = path.join(dir, "darkmown-link");
  fs.symlinkSync(cliPath, link);
  assert.equal(isEntryPoint(link), true);
  // A path that does not exist → realpathSync throws → not the binary (catch).
  assert.equal(isEntryPoint(path.join(dir, "does-not-exist")), false);
  // An unrelated real file → not the binary.
  assert.equal(isEntryPoint(fileURLToPath(import.meta.url)), false);
});

// --- init ------------------------------------------------------------------

test("run('init', '.') scaffolds and reports the in-place next step", async () => {
  const root = freshDir("init");
  const c = capture(root);
  const result = await run(["init", "."], c.env);
  assert.equal(result.command, "init");
  assert.match(c.stdout(), /Created Darkmown project \(starter\) at \./);
  assert.match(c.stdout(), /Next: npm install && npm run dev/);
  assert.ok(fs.existsSync(path.join(root, "site/pages/index.wd")));
});

test("run('init', 'sub') reports a cd-prefixed next step", async () => {
  const root = freshDir("init-sub");
  const c = capture(root);
  await run(["init", "sub"], c.env);
  assert.match(c.stdout(), /Created Darkmown project \(starter\) at sub/);
  assert.match(c.stdout(), /Next: cd sub && npm install && npm run dev/);
});

// --- build -----------------------------------------------------------------

test("run('build') compiles the scaffolded site and reports the route count", async () => {
  const root = freshDir("build");
  await run(["init", "."], capture(root).env);
  const c = capture(root);
  const result = await run(["build"], c.env);
  assert.equal(result.command, "build");
  assert.match(c.stdout(), /Built \d+ routes into dist/);
  assert.ok(fs.existsSync(path.join(root, "dist/index.html")));
});

test("run('build') throws on a compile error (the failClean path)", async () => {
  const root = freshDir("build-err");
  await run(["init", "."], capture(root).env);
  // Unclosed @loop → a file-pathed compile Error the binary prints as `✗ …`.
  fs.writeFileSync(path.join(root, "site/pages/broken.wd"), "@loop /x.json into item\nno end\n");
  await assert.rejects(() => run(["build"], capture(root).env), /Missing @endloop/);
});

test("buildSummary appends feed counts only when feeds were emitted", () => {
  assert.equal(
    buildSummary({ routes: new Array(14), feeds: { sitemap: 14, rss: 6 } }, "dist"),
    "Built 14 routes, sitemap (14 urls), rss (6 posts) into dist"
  );
  // No site_url → both feed counts null → just the route count.
  assert.equal(
    buildSummary({ routes: new Array(3), feeds: { sitemap: null, rss: null } }, "out"),
    "Built 3 routes into out"
  );
});

test("buildSummary reports an incremental rebuild, naming routes only when few", () => {
  const feeds = { sitemap: 14, rss: 6 };
  assert.equal(
    buildSummary(
      { routes: new Array(14), feeds, incremental: { rebuilt: ["/a/", "/b/"], total: 14 } },
      "dist"
    ),
    "Rebuilt 2 of 14 routes (/a/, /b/) into dist"
  );
  // Too many routes to read → the list is dropped, the counts stay.
  const many = ["/a/", "/b/", "/c/", "/d/", "/e/", "/f/", "/g/"];
  assert.equal(
    buildSummary(
      { routes: new Array(14), feeds, incremental: { rebuilt: many, total: 14 } },
      "dist"
    ),
    "Rebuilt 7 of 14 routes into dist"
  );
  // Nothing affected (e.g. a schema of an unconsumed collection) is still honest.
  assert.equal(
    buildSummary({ routes: new Array(14), feeds, incremental: { rebuilt: [], total: 14 } }, "dist"),
    "Rebuilt 0 of 14 routes into dist"
  );
});

test("flagValues reads every repeatable --flag value / --flag=value occurrence", () => {
  assert.deepEqual(
    flagValues(["build", "--changed", "site/a.md", "--changed=site/b.md", "--drafts"], "--changed"),
    ["site/a.md", "site/b.md"]
  );
  assert.deepEqual(flagValues(["build", "--drafts"], "--changed"), []);
  // A trailing flag with no value contributes nothing.
  assert.deepEqual(flagValues(["build", "--changed"], "--changed"), []);
});

test("run('build') on a site with site_url reports the feed counts in the summary", async () => {
  const root = freshDir("build-feeds");
  await run(["init", ".", "--template", "blog"], capture(root).env);
  const c = capture(root);
  await run(["build"], c.env);
  // The blog template sets site_url + dated posts, so the summary carries feeds.
  assert.match(c.stdout(), /Built \d+ routes, sitemap \(\d+ urls\), rss \(\d+ posts\) into dist/);
  assert.ok(fs.existsSync(path.join(root, "dist/sitemap.xml")));
  assert.ok(fs.existsSync(path.join(root, "dist/rss.xml")));
  assert.ok(fs.existsSync(path.join(root, "dist/robots.txt")));
});

test("run('build --drafts') includes draft pages in the build", async () => {
  const root = freshDir("build-drafts");
  await run(["init", "."], capture(root).env);
  fs.writeFileSync(
    path.join(root, "site/pages/wip.md"),
    "---\ntitle: WIP\ndraft: true\n---\n\nDraft body.\n"
  );
  // Production build excludes it…
  await run(["build"], capture(root).env);
  assert.equal(fs.existsSync(path.join(root, "dist/wip/index.html")), false);
  // …`--drafts` includes it.
  await run(["build", "--drafts"], capture(root).env);
  assert.equal(fs.existsSync(path.join(root, "dist/wip/index.html")), true);
});

// --- unknown command -------------------------------------------------------

test("run('bogus') reports the unknown command, prints help, and throws a silent CliError", async () => {
  const c = capture(process.cwd());
  await assert.rejects(
    () => run(["bogus"], c.env),
    (err) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.silent, true);
      return true;
    }
  );
  assert.match(c.stderr(), /Unknown command: bogus/);
  assert.match(c.stdout(), /Usage:/);
});

// --- serve -----------------------------------------------------------------

test("run('serve') without a dist directory reports the build hint and throws", async () => {
  const root = freshDir("serve-nodist");
  const c = capture(root);
  await assert.rejects(
    () => run(["serve"], c.env),
    (err) => {
      assert.ok(err instanceof CliError);
      assert.equal(err.silent, true);
      return true;
    }
  );
  assert.match(c.stderr(), /No dist directory found\. Run `darkmown build` first\./);
});

test("run('serve') serves the built dist over real HTTP, then closes cleanly", async () => {
  const root = freshDir("serve");
  await run(["init", "."], capture(root).env);
  await run(["build"], capture(root).env);

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0"; // ephemeral
  let handle;
  try {
    handle = await run(["serve"], c.env);
    assert.equal(handle.command, "serve");
    assert.match(c.stdout(), /Darkmown preview of dist at http:\/\/127\.0\.0\.1:0/);

    const origin = originOf(handle.server);
    const home = await httpGet(origin, "/");
    assert.equal(home.status, 200);
    const missing = await httpGet(origin, "/does-not-exist/");
    assert.equal(missing.status, 404);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

// --- dev -------------------------------------------------------------------

test("run('dev') serves dist with the dev client injected, SSE + api, then closes", async () => {
  const root = freshDir("dev");
  await run(["init", "."], capture(root).env);

  // A project api/ function runs in dev with full Vercel/Cloudflare parity.
  // `.mjs` keeps the fixture ESM regardless of the scaffold's package.json type.
  fs.mkdirSync(path.join(root, "api"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api/echo.mjs"),
    "export default async (request) => Response.json({ ok: true, received: Object.fromEntries(await request.formData()) });\n"
  );

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    assert.equal(handle.command, "dev");
    assert.match(c.stdout(), /Darkmown dev server ready at http:\/\/127\.0\.0\.1:0/);
    assert.match(c.stdout(), /Live compiler watching site\/ and src\//);

    const origin = originOf(handle.server);

    // HTML route comes back with the dev-client script injected.
    const home = await httpGet(origin, "/");
    assert.equal(home.status, 200);
    assert.match(home.body, /__wd\/dev-client\.js/, "dev server injects the dev client");

    // The dev-client script endpoint returns the EventSource wiring.
    const client = await httpGet(origin, "/__wd/dev-client.js");
    assert.equal(client.status, 200);
    assert.match(client.headers["content-type"], /text\/javascript/);
    assert.match(client.body, /EventSource/);

    // A non-HTML asset streams with a mapped content-type (not injected).
    const runtime = await httpGet(origin, "/__wd/runtime.js");
    assert.equal(runtime.status, 200);
    assert.match(runtime.headers["content-type"], /javascript/);

    // A missing file falls through serveDev to the static serve() → 404.
    const missing = await httpGet(origin, "/no-such-page/");
    assert.equal(missing.status, 404, "dev serves a 404 for an unknown route");

    // The project's api/echo function round-trips a posted form body — same
    // path (/api/echo) the page would hit on Vercel/Cloudflare.
    const echo = await httpPost(origin, "/api/echo", "name=ada&role=author");
    assert.equal(echo.status, 200);
    const parsed = JSON.parse(echo.body);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.received, { name: "ada", role: "author" });

    // The SSE channel opens as an event-stream.
    const sse = await readSse(origin, "/__wd/dev-events", { timeout: 300 });
    assert.equal(sse.status, 200);
    assert.match(sse.headers["content-type"], /text\/event-stream/);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

test("run('dev') builds + serves draft pages, bannering only the draft", async () => {
  const root = freshDir("dev-drafts");
  await run(["init", "."], capture(root).env);
  fs.writeFileSync(
    path.join(root, "site/pages/wip.md"),
    "---\ntitle: WIP\ndraft: true\n---\n\n# Draft body\n"
  );

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    const origin = originOf(handle.server);

    // The draft IS served in dev (production would 404 it) — with the banner.
    const draft = await httpGet(origin, "/wip/");
    assert.equal(draft.status, 200, "dev builds + serves the draft");
    assert.match(draft.body, /__wd-draft-banner/, "draft page gets the dev banner");
    assert.match(draft.body, /DRAFT — excluded from production build/);

    // A normal (non-draft) page is served WITHOUT the banner.
    const home = await httpGet(origin, "/");
    assert.equal(home.status, 200);
    assert.doesNotMatch(home.body, /__wd-draft-banner/, "non-draft page has no banner");
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

test("run('dev') records a broken initial build and replays it to SSE clients", async () => {
  const root = freshDir("dev-broken");
  await run(["init", "."], capture(root).env);
  // Break the build BEFORE `dev` starts: the server must still come up and the
  // recorded error replays to clients that connect while it is still failing.
  fs.writeFileSync(path.join(root, "site/pages/broken.wd"), "@loop /x.json into item\nno end\n");

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    // The initial build error was printed to the error sink, prominently.
    assert.match(c.stderr(), /✗ Initial build failed:/);
    assert.match(c.stderr(), /Missing @endloop/);
    // The "ready" line is honest: it says the build failed instead of
    // pretending everything is fine.
    assert.match(c.stdout(), /ready at http:\/\/127\.0\.0\.1:0.*initial build FAILED/);

    const origin = originOf(handle.server);
    const sse = await readSse(origin, "/__wd/dev-events", { timeout: 400 });
    assert.equal(sse.status, 200);
    assert.match(sse.data, /event: builderror/, "broken build replays to a fresh SSE client");
    assert.match(sse.data, /Missing @endloop/);

    // An unbuilt HTML route serves the build-failure page (with the dev client
    // so the overlay replays and the next successful build reloads it) — NOT
    // the misleading "hidden or has not been created" 404 copy.
    const page = await httpGet(origin, "/broken/");
    assert.equal(page.status, 500, "an unbuilt route is a 500 while the build is failing");
    assert.match(page.body, /Darkmown build failed/);
    assert.match(page.body, /Missing @endloop/);
    assert.match(page.body, /__wd\/dev-client\.js/, "the failure page carries the dev client");
    assert.doesNotMatch(page.body, /hidden or has not been created/);

    // Non-HTML asset URLs still 404 normally (no HTML error page for a .css).
    const asset = await httpGet(origin, "/missing.css");
    assert.equal(asset.status, 404);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

test("dev server returns a 500 with the stack when serving throws", async () => {
  // A request URL that resolves to an existing `.html` PATH which is actually a
  // directory makes serveDev's fs.readFileSync throw EISDIR; the handler's
  // try/catch converts that into a 500 text/plain response (cli.js 202-205).
  const root = freshDir("dev-500");
  await run(["init", "."], capture(root).env);

  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], capture(root).env);
    // Create the trap AFTER the dev server's initial build (which wipes dist).
    // dist/trap.html as a directory: existsSync → true, endsWith(".html") → true,
    // readFileSync(dir) → throws EISDIR, caught by the handler → 500.
    fs.mkdirSync(path.join(root, "dist", "trap.html"), { recursive: true });
    const origin = originOf(handle.server);
    const res = await httpGet(origin, "/trap.html");
    assert.equal(res.status, 500, "a throw inside the handler becomes a 500");
    assert.match(res.headers["content-type"], /text\/plain/);
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

// Wait for the next SSE event of a given type to arrive on an open connection.
function waitForSseEvent(origin, urlPath, eventName, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}${urlPath}`, (res) => {
      let data = "";
      res.setEncoding("utf8");
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`Timed out waiting for SSE "${eventName}". Got: ${data}`));
      }, timeout);
      res.on("data", (chunk) => {
        data += chunk;
        if (data.includes(`event: ${eventName}`)) {
          clearTimeout(timer);
          req.destroy();
          resolve(data);
        }
      });
      res.on("error", () => {});
    });
    req.on("error", reject);
  });
}

test("dev server rebuilds on a file change and broadcasts a reload to SSE clients", async () => {
  const root = freshDir("dev-rebuild");
  await run(["init", "."], capture(root).env);

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    const origin = originOf(handle.server);

    // Open an SSE client first so the rebuild broadcast (cli.js broadcast +
    // reload path) has a recipient.
    const reloadPromise = waitForSseEvent(origin, "/__wd/dev-events", "reload");
    // Give the SSE GET a moment to register the client before we touch a file.
    await new Promise((r) => setTimeout(r, 50));

    // Touch a watched site file → fs.watch fires → debounced child `build
    // --changed <path>` → the dependency-tracked incremental rebuild recompiles
    // just the touched route and the success path broadcasts `event: reload`.
    fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Rebuilt\n\nFresh content.\n");

    const data = await reloadPromise;
    assert.match(data, /event: reload/, "a successful rebuild broadcasts reload");
    assert.match(
      c.stdout(),
      /Rebuilt 1 of \d+ routes \(\/\) into dist/,
      "a site content change rebuilds only the affected route"
    );
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

test("dev server runs a FULL child rebuild for a src/ change (never incremental)", async () => {
  const root = freshDir("dev-src-full");
  await run(["init", "."], capture(root).env);
  // A project src/ directory registers the src watcher; changes there must
  // always take the full-rebuild path so fresh modules load in the child.
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/helper.js"), "export const x = 1;\n");

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    const origin = originOf(handle.server);

    const reloadPromise = waitForSseEvent(origin, "/__wd/dev-events", "reload");
    await new Promise((r) => setTimeout(r, 50));

    fs.writeFileSync(path.join(root, "src/helper.js"), "export const x = 2;\n");

    const data = await reloadPromise;
    assert.match(data, /event: reload/);
    assert.match(c.stdout(), /Built \d+ routes/, "a src/ change runs the full rebuild");
    assert.doesNotMatch(c.stdout(), /Rebuilt \d+ of/, "the incremental path is never taken");
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});

test("dev server rebuild on a broken change broadcasts builderror to SSE clients", async () => {
  const root = freshDir("dev-rebuild-err");
  await run(["init", "."], capture(root).env);

  const c = capture(root);
  const prevPort = process.env.PORT;
  process.env.PORT = "0";
  let handle;
  try {
    handle = await run(["dev"], c.env);
    const origin = originOf(handle.server);

    const errPromise = waitForSseEvent(origin, "/__wd/dev-events", "builderror");
    await new Promise((r) => setTimeout(r, 50));

    // Introduce a compile error → child `build` exits non-zero → error path
    // broadcasts `event: builderror`.
    fs.writeFileSync(
      path.join(root, "site/pages/index.wd"),
      "@loop /missing.json into item\nno end\n"
    );

    const data = await errPromise;
    assert.match(data, /event: builderror/, "a failed rebuild broadcasts builderror");
    assert.match(c.stderr(), /endloop|Missing|resolve/i, "the rebuild logs the failure");
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    if (handle) await handle.close();
  }
});
