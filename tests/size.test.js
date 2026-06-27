import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { stripRuntimeComments } from "../src/builder.js";

test("runtime stays under the 8KB gzip budget that the brand promises", () => {
  // Measure what actually ships: the runtime with JSDoc stripped (exactly as emitRuntime emits it).
  // Source keeps full type annotations for checkJs/.d.ts; the browser download stays lean.
  // Budget raised 6 KB → 8 KB in 1.0 for the value + time layer (format pipes, aggregates,
  // :every); still un-minified, and smaller than Preact alone.
  const shipped = stripRuntimeComments(readFileSync("src/runtime.js", "utf8"));
  const size = gzipSync(shipped).length;
  assert.ok(size < 8192, `shipped runtime is ${size} bytes gzipped — budget is 8192`);
  console.log(`shipped runtime: ${size} bytes gzipped (budget 8192)`);
});
