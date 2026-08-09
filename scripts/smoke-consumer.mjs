#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-smoke-"));
const driver = path.join(root, "driver");
const project = path.join(root, "smoke-site");

try {
  const [{ filename }] = JSON.parse(
    runNpm(["pack", "--json", "--pack-destination", root], repoRoot)
  );
  const tarball = path.join(root, filename);
  assert.ok(fs.existsSync(tarball), "npm pack should produce a local tarball for smoke testing");

  fs.mkdirSync(driver, { recursive: true });
  runNpm(["init", "-y"], driver);
  runNpm(["install", "--no-audit", "--no-fund", tarball], driver);

  // Drive the installed CLI's real JS entry under node rather than the
  // node_modules/.bin shim: on Windows that shim is a .cmd, which cannot be
  // spawned without a shell (see runNpm). This still proves the tarball
  // installed a working CLI; that `bin` points at this file is asserted by
  // tests/pack.test.js and package.json.
  const installedCli = path.join(driver, "node_modules", "@zvndev", "darkmown", "src", "cli.js");
  run(process.execPath, [installedCli, "init", project], root);

  const pkg = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "scaffolded app should be private by default");
  assert.equal(pkg.scripts.dev, "darkmown dev");
  assert.equal(pkg.scripts.build, "darkmown build");
  assert.equal(pkg.scripts.preview, "darkmown serve");

  runNpm(["install", "--no-audit", "--no-fund", "--save-dev", tarball], project);
  const projectCli = path.join(project, "node_modules", "@zvndev", "darkmown", "src", "cli.js");
  run(process.execPath, [projectCli, "build"], project);

  const routes = JSON.parse(fs.readFileSync(path.join(project, "dist", "routes.json"), "utf8"));
  const byRoute = new Map(routes.map((route) => [route.route, route]));
  assert.equal(
    byRoute.get("/").assets.runtime,
    true,
    "home scaffold should demonstrate reactivity"
  );
  assert.equal(
    byRoute.get("/about/").assets.runtime,
    false,
    "plain .md scaffold route stays zero-JS"
  );
  assert.ok(
    fs.existsSync(path.join(project, "dist", "__wd", "runtime.js")),
    "reactive runtime emitted"
  );
  assert.ok(
    !fs
      .readFileSync(path.join(project, "dist", "about", "index.html"), "utf8")
      .includes("/__wd/runtime.js"),
    "about page stays static"
  );

  console.log(`Smoke OK: packed, installed, scaffolded, built, and verified ${project}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// Invoking npm portably is fiddlier than it looks. On Windows the entry point is
// a `.cmd` shim: a bare "npm" fails with ENOENT, and since Node's CVE-2024-27980
// fix, spawning a .cmd fails with EINVAL unless a shell is involved. Run npm's
// own JS entry under the CURRENT Node binary instead — shell-free, so none of
// these temp paths pass through shell quoting. `npm_execpath` is set whenever
// this runs under an npm script, which is how `npm run smoke` and CI invoke it.
function runNpm(args, cwd) {
  const cli = process.env.npm_execpath;
  if (cli) return run(process.execPath, [cli, ...args], cwd);
  const win = process.platform === "win32";
  return run(win ? "npm.cmd" : "npm", args, cwd, { shell: win });
}

function run(command, args, cwd, extra = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...extra
  });
}
