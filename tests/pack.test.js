import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("npm pack includes the runtime, compiler, cli, and demo site", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const [report] = JSON.parse(output);
  const files = report.files.map((file) => file.path);
  for (const required of [
    "src/cli.js",
    "src/compiler.js",
    "src/runtime.js",
    "src/builder.js",
    "site/pages/index.wd",
    "README.md",
    "package.json"
  ]) {
    assert.equal(files.includes(required), true, `missing ${required} from npm pack`);
  }
});
