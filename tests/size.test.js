import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stripRuntimeComments } from "../src/builder.js";

test("runtime stays under the 5KB gzip budget that the brand promises", () => {
  // Measure what actually ships: the runtime with JSDoc stripped (exactly as emitRuntime emits it).
  // Source keeps full type annotations for checkJs/.d.ts; the browser download stays lean.
  const shipped = stripRuntimeComments(readFileSync("src/runtime.js", "utf8"));
  const size = gzipSync(shipped).length;
  assert.ok(size < 5120, `shipped runtime is ${size} bytes gzipped — budget is 5120`);
  console.log(`shipped runtime: ${size} bytes gzipped (budget 5120)`);
});
