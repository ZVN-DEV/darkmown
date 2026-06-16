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
  const [{ filename }] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", root], repoRoot));
  const tarball = path.join(root, filename);
  assert.ok(fs.existsSync(tarball), "npm pack should produce a local tarball for smoke testing");

  fs.mkdirSync(driver, { recursive: true });
  run("npm", ["init", "-y"], driver);
  run("npm", ["install", "--no-audit", "--no-fund", tarball], driver);

  const installedBin = path.join(driver, "node_modules", ".bin", process.platform === "win32" ? "darkmown.cmd" : "darkmown");
  run(installedBin, ["init", project], root);

  const pkg = JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "scaffolded app should be private by default");
  assert.equal(pkg.scripts.dev, "darkmown dev");
  assert.equal(pkg.scripts.build, "darkmown build");
  assert.equal(pkg.scripts.preview, "darkmown serve");

  run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", tarball], project);
  const projectBin = path.join(project, "node_modules", ".bin", process.platform === "win32" ? "darkmown.cmd" : "darkmown");
  run(projectBin, ["build"], project);

  const routes = JSON.parse(fs.readFileSync(path.join(project, "dist", "routes.json"), "utf8"));
  const byRoute = new Map(routes.map((route) => [route.route, route]));
  assert.equal(byRoute.get("/").assets.runtime, true, "home scaffold should demonstrate reactivity");
  assert.equal(byRoute.get("/about/").assets.runtime, false, "plain .md scaffold route stays zero-JS");
  assert.ok(fs.existsSync(path.join(project, "dist", "__wd", "runtime.js")), "reactive runtime emitted");
  assert.ok(!fs.readFileSync(path.join(project, "dist", "about", "index.html"), "utf8").includes("/__wd/runtime.js"), "about page stays static");

  console.log(`Smoke OK: packed, installed, scaffolded, built, and verified ${project}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
