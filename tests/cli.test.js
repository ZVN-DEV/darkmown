import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initProject } from "../src/scaffold.js";

const cli = path.resolve("src/cli.js");

test("package exposes the markie bin", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.name, "markie-framework");
  assert.equal(pkg.bin.markie, "./src/cli.js");
});

test("cli help describes init dev and build", () => {
  const output = execFileSync("node", [cli, "--help"], { encoding: "utf8" });
  assert.match(output, /Usage:/);
  assert.match(output, /markie init/);
  assert.match(output, /markie dev/);
  assert.match(output, /markie build/);
});

test("init scaffolds without overwriting and uses publishable dependency spec", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "markie-init-"));
  const target = path.join(root, "demo");
  fs.mkdirSync(path.join(target, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(target, "site/pages/index.wd"), "# Existing\n");

  initProject(target);

  const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
  assert.equal(pkg.devDependencies["markie-framework"], "^0.1.0");
  assert.equal(fs.readFileSync(path.join(target, "site/pages/index.wd"), "utf8"), "# Existing\n");
  assert.equal(fs.existsSync(path.join(target, "site/pages/index.skin")), true);
  assert.equal(fs.existsSync(path.join(target, "site/_/nav.wd")), true);
  assert.equal(fs.existsSync(path.join(target, "README.md")), true);
});
