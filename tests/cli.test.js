import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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

test("serve binds to loopback by default and reports HOST overrides", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-serve-host-"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist/index.html"), "<h1>ok</h1>");

  const defaultOutput = await readServeBanner(root, { PORT: "0" });
  assert.match(defaultOutput, /http:\/\/127\.0\.0\.1:0/);

  const overrideOutput = await readServeBanner(root, { PORT: "0", HOST: "localhost" });
  assert.match(overrideOutput, /http:\/\/localhost:0/);
});

test("init in the current directory prints a direct next step", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-init-current-"));
  const output = execFileSync("node", [cli, "init", "."], { cwd: root, encoding: "utf8" });
  assert.match(output, /Created Darkmown project at \./);
  assert.match(output, /Next: npm install && npm run dev/);
  assert.doesNotMatch(output, /cd \. &&/);
});

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>}
 */
function readServeBanner(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "serve"], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for serve banner. Output: ${output}`));
    }, 3000);

    const finish = () => {
      clearTimeout(timer);
      child.kill();
      resolve(output);
    };

    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Darkmown preview of dist")) finish();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!output.includes("Darkmown preview of dist")) {
        clearTimeout(timer);
        reject(new Error(`Serve exited with ${code}. Output: ${output}`));
      }
    });
  });
}
