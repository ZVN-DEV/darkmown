import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// On Windows the npm entry point is `npm.cmd`; `execFileSync` cannot launch a
// .cmd without a shell, so a bare "npm" fails with spawnSync ENOENT. Naming the
// real executable keeps this shell-free rather than reaching for `shell: true`.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

test("npm pack includes the runtime, compiler, cli, and intentional demo/support files", () => {
  const output = execFileSync(NPM, ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const [report] = JSON.parse(output);
  const files = report.files.map((file) => file.path);
  // Hidden demo sources ship intentionally: they prove the router hides dot/dash
  // pages in the demo/package without needing separate fixture files. AGENTS.md
  // ships intentionally as model-facing guidance for AI-assisted users.
  for (const required of [
    "src/cli.js",
    "src/compiler.js",
    "src/runtime.js",
    "src/builder.js",
    "site/pages/index.wd",
    "site/pages/-draft.wd",
    "site/pages/docs/.secret.wd",
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json"
  ]) {
    assert.equal(files.includes(required), true, `missing ${required} from npm pack`);
  }
});
