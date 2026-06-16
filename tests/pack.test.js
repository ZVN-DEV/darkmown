import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("npm pack includes the runtime, compiler, cli, and intentional demo/support files", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
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
    "package.json"
  ]) {
    assert.equal(files.includes(required), true, `missing ${required} from npm pack`);
  }
});
