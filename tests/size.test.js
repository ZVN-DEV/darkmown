import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";

test("runtime stays under the 5KB gzip budget that the brand promises", () => {
  const size = Number(execSync("gzip -c src/runtime.js | wc -c", { encoding: "utf8" }).trim());
  assert.ok(size < 5120, `runtime.js is ${size} bytes gzipped — budget is 5120`);
  console.log(`runtime.js: ${size} bytes gzipped (budget 5120)`);
});
