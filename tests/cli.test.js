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

  const defaultOutput = await readServerBanner(root, "serve", "Darkmown preview of dist", { PORT: "0" });
  assert.match(defaultOutput, /http:\/\/127\.0\.0\.1:0/);

  const overrideOutput = await readServerBanner(root, "serve", "Darkmown preview of dist", { PORT: "0", HOST: "localhost" });
  assert.match(overrideOutput, /http:\/\/localhost:0/);
});

test("dev binds to loopback by default and reports HOST overrides", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-dev-host-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Dev host test\n");

  const defaultOutput = await readServerBanner(root, "dev", "Darkmown dev server ready", { PORT: "0" });
  assert.match(defaultOutput, /http:\/\/127\.0\.0\.1:0/);

  const overrideOutput = await readServerBanner(root, "dev", "Darkmown dev server ready", { PORT: "0", HOST: "localhost" });
  assert.match(overrideOutput, /http:\/\/localhost:0/);
});

test("bare `darkmown` prints help instead of silently building", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-bare-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Hi\n");
  const output = execFileSync("node", [cli], { cwd: root, encoding: "utf8" });
  assert.match(output, /Usage:/);
  assert.doesNotMatch(output, /Built \d+ routes/);
  assert.equal(fs.existsSync(path.join(root, "dist")), false, "bare command must not build");
});

test("build prints a clean compile error without a Node stack trace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-builderr-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  // Unclosed @loop → a compile Error with a file-pathed message.
  fs.writeFileSync(path.join(root, "site/pages/broken.wd"), "@loop /x.json into item\nno end\n");
  let failed = false;
  try {
    execFileSync("node", [cli, "build"], { cwd: root, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    failed = true;
    assert.equal(error.status, 1, "build must exit non-zero on a compile error");
    const stderr = String(error.stderr);
    assert.match(stderr, /^✗ /m, "error must be prefixed with ✗");
    assert.match(stderr, /Missing @endloop/, "error must carry the compiler message");
    assert.doesNotMatch(stderr, /\n\s+at \w/, "must not print a Node stack trace");
    assert.doesNotMatch(stderr, /Node\.js v\d/, "must not print the Node version footer");
  }
  assert.equal(failed, true, "build was expected to fail on the broken page");
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
 * @param {"dev" | "serve"} command
 * @param {string} banner
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>}
 */
function readServerBanner(cwd, command, banner, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      settle(new Error(`Timed out waiting for ${command} banner. Output: ${output}`));
    }, 5000);

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(output);
    };

    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes(banner)) settle();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      settle(error);
    });
    child.on("exit", (code) => {
      if (!settled && !output.includes(banner)) {
        settle(new Error(`${command} exited with ${code}. Output: ${output}`));
      }
    });
  });
}
