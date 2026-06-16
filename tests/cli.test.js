import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initProject } from "../src/scaffold.js";

const cli = path.resolve("src/cli.js");

test("package exposes the darkmown bin", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, "@zvndev/darkmown");
  assert.equal(pkg.bin.darkmown, "./src/cli.js");
});

test("cli help describes init dev and build", () => {
  const output = execFileSync("node", [cli, "--help"], { encoding: "utf8" });
  assert.match(output, /Usage:/);
  assert.match(output, /darkmown init/);
  assert.match(output, /darkmown dev/);
  assert.match(output, /darkmown build/);
  assert.match(output, /darkmown serve/);
  assert.match(output, /darkmown version/);
});

test("init scaffolds without overwriting and uses publishable dependency spec", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-init-"));
  const target = path.join(root, "demo");
  fs.mkdirSync(path.join(target, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(target, "site/pages/index.wd"), "# Existing\n");

  initProject(target);

  const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  const rootPkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, "demo");
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.preview, "darkmown serve");
  assert.equal(pkg.devDependencies["@zvndev/darkmown"], `^${rootPkg.version}`);
  assert.equal(fs.readFileSync(path.join(target, "site/pages/index.wd"), "utf8"), "# Existing\n");
  assert.equal(fs.existsSync(path.join(target, "site/pages/index.skin")), true);
  assert.equal(fs.existsSync(path.join(target, "site/_/nav.wd")), true);
  assert.equal(fs.existsSync(path.join(target, "README.md")), true);
});


test("init in the current directory prints a direct next step", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-init-current-"));
  const output = execFileSync("node", [cli, "init", "."], { cwd: root, encoding: "utf8" });
  assert.match(output, /Created Darkmown project at \./);
  assert.match(output, /Next: npm install && npm run dev/);
  assert.doesNotMatch(output, /cd \. &&/);
});
