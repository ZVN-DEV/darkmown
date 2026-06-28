import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { run } from "../src/cli.js";
import { deploy, spawnProcess } from "../src/deploy.js";

/** Minimal buildable project + optional api functions. */
function project(apiFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-deploy-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "my-site", type: "module" })
  );
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.md"), "# Home\n");
  for (const [rel, src] of Object.entries(apiFiles)) {
    const abs = path.join(root, "api", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src);
  }
  return root;
}
const ok = (stdout) => async () => ({ code: 0, stdout, stderr: "" });

test("deploy rejects an unknown target", async () => {
  await assert.rejects(
    () => deploy({ cwd: project(), target: "netlify", log: () => {}, run: ok("") }),
    /Unknown deploy target "netlify"/
  );
});

test("vercel deploy writes vercel.json, runs the CLI (--prod), and parses the URL", async () => {
  const root = project();
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    return { code: 0, stdout: "Production: https://my-site-abc.vercel.app [2s]\n", stderr: "" };
  };
  const { url } = await deploy({ cwd: root, target: "vercel", prod: true, log: () => {}, run });
  assert.equal(url, "https://my-site-abc.vercel.app");
  assert.ok(fs.existsSync(path.join(root, "vercel.json")));
  assert.deepEqual(calls[0], ["npx", ["--yes", "vercel", "deploy", "--yes", "--prod"]]);
  // The generated CSP carries form-action 'self' (in sync with src/headers.js).
  assert.match(fs.readFileSync(path.join(root, "vercel.json"), "utf8"), /form-action 'self'/);
});

test("vercel deploy does not overwrite an existing vercel.json", async () => {
  const root = project();
  fs.writeFileSync(path.join(root, "vercel.json"), '{"existing":true}');
  await deploy({ cwd: root, target: "vercel", log: () => {}, run: ok("") });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")), {
    existing: true
  });
});

test("cloudflare deploy builds the worker and runs wrangler with the project name", async () => {
  const root = project({ "ping.js": "export default () => Response.json({ ok: true })" });
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    return { code: 0, stdout: "✨ https://my-site.pages.dev\n", stderr: "" };
  };
  const { url } = await deploy({ cwd: root, target: "cloudflare", log: () => {}, run });
  assert.equal(url, "https://my-site.pages.dev");
  assert.ok(
    fs.existsSync(path.join(root, "dist/_worker.js/index.js")),
    "cloudflare worker emitted"
  );
  assert.deepEqual(calls[0], [
    "npx",
    ["--yes", "wrangler", "pages", "deploy", "dist", "--project-name", "my-site"]
  ]);
});

test("an unauthenticated CLI surfaces a login hint", async () => {
  const run = async () => ({
    code: 1,
    stdout: "",
    stderr: "Error: Not authenticated. Please log in."
  });
  await assert.rejects(
    () => deploy({ cwd: project(), target: "vercel", log: () => {}, run }),
    /not signed in[\s\S]*vercel login/
  );
});

test("a cloudflare auth failure (wrangler wording) surfaces a login hint", async () => {
  // wrangler's real auth-failure strings differ from Vercel's; each must trip the hint.
  for (const stderr of [
    "✘ [ERROR] Authentication error [code: 10000]",
    "You are not logged in. Please run `wrangler login`.",
    "You need to log in first."
  ]) {
    const run = async () => ({ code: 1, stdout: "", stderr });
    await assert.rejects(
      () => deploy({ cwd: project(), target: "cloudflare", log: () => {}, run }),
      /not signed in[\s\S]*wrangler login/
    );
  }
});

test("deploy strips trailing sentence punctuation from a parsed URL", async () => {
  const { url } = await deploy({
    cwd: project(),
    target: "cloudflare",
    log: () => {},
    run: ok("✨ Deployment complete! Take a peek over at https://my-site.pages.dev.\n")
  });
  assert.equal(url, "https://my-site.pages.dev");
});

test("a non-auth CLI failure reports a deploy failure", async () => {
  const run = async () => ({ code: 1, stdout: "", stderr: "build error: something broke" });
  await assert.rejects(
    () => deploy({ cwd: project(), target: "cloudflare", log: () => {}, run }),
    /cloudflare deploy failed \(exit 1\)/
  );
});

test("cloudflare deploy without a package.json uses the directory name as the project", async () => {
  const root = project({ "p.js": "export default () => Response.json({})" });
  fs.rmSync(path.join(root, "package.json"));
  const calls = [];
  const run = async (_file, args) => {
    calls.push(args);
    return { code: 0, stdout: "https://x.pages.dev", stderr: "" };
  };
  await deploy({ cwd: root, target: "cloudflare", log: () => {}, run });
  const args = calls[0];
  assert.equal(args[args.indexOf("--project-name") + 1], path.basename(root));
});

test("spawnProcess runs a real command and captures stdout + stderr", async () => {
  const result = await spawnProcess(
    process.execPath,
    ["-e", "process.stdout.write('hi'); process.stderr.write('warn')"],
    {}
  );
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hi/);
  assert.match(result.stderr, /warn/);
});

test("spawnProcess resolves with a non-zero code when the binary is missing", async () => {
  const result = await spawnProcess("darkmown-no-such-binary-zzz", [], {});
  assert.equal(result.code, 1);
});

// --- through the CLI command ----------------------------------------------

test("cli `deploy` errors without a target", async () => {
  await assert.rejects(
    () => run(["deploy"], { cwd: project(), log: () => {}, error: () => {} }),
    /Missing deploy target/
  );
});

test("cli `deploy <target>` passes the injected spawn through to the platform CLI", async () => {
  const root = project();
  const calls = [];
  const spawn = async (file, args) => {
    calls.push([file, args]);
    return { code: 0, stdout: "https://my-site.vercel.app", stderr: "" };
  };
  const result = await run(["deploy", "vercel", "--prod"], { cwd: root, log: () => {}, spawn });
  assert.equal(result.command, "deploy");
  assert.equal(calls[0][0], "npx");
  assert.ok(calls[0][1].includes("--prod"));
});
