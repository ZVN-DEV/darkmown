import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Invoking npm portably is fiddlier than it looks. On Windows the entry point
// is `npm.cmd`, a bare "npm" fails with ENOENT, and since Node's CVE-2024-27980
// fix spawning a .cmd at all fails with EINVAL unless a shell is involved. So
// run npm's own JS entry under the CURRENT Node binary: shell-free (no argument
// quoting to get wrong) and identical on every platform. `npm_execpath` is set
// whenever this runs under an npm script, which is how CI invokes the suite.
function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  // Direct `node --test` outside an npm script: fall back to the shim.
  const win = process.platform === "win32";
  return execFileSync(win ? "npm.cmd" : "npm", args, { ...options, shell: win });
}

test("npm pack includes the runtime, compiler, cli, and intentional demo/support files", () => {
  const output = runNpm(["pack", "--dry-run", "--json"], { encoding: "utf8" });
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
