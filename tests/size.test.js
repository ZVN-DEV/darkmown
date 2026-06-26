import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { stripRuntimeComments } from "../src/builder.js";

test("runtime stays under the 6KB gzip budget that the brand promises", () => {
  // Measure what actually ships: the runtime with JSDoc stripped (exactly as emitRuntime emits it).
  // Source keeps full type annotations for checkJs/.d.ts; the browser download stays lean.
  const shipped = stripRuntimeComments(readFileSync("src/runtime.js", "utf8"));
  const size = gzipSync(shipped).length;
  assert.ok(size < 6144, `shipped runtime is ${size} bytes gzipped — budget is 6144`);
  console.log(`shipped runtime: ${size} bytes gzipped (budget 6144)`);
});
