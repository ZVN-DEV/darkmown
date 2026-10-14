// ---------------------------------------------------------------------------
// The subset worker for the build-time font post-pass (2.10.0). Never imported
// by the builder: the build is synchronous and the wasm toolchain is not, so
// src/font-subset.js spawns this file as a child process with a jobs JSON file
// and reads back a results JSON file.
//
// harfbuzzjs (the hb-subset wasm) and wawoff2 are OPTIONAL dependencies, so
// both are loaded inside a try/catch: when either cannot load, the worker
// reports `{ unavailable: true }` and exits cleanly — the parent turns that
// into one hint, and the build ships exactly what 2.9.0 would have. A failure
// on ONE font is recorded in `failed` and the rest still subset. Nothing here
// ever exits non-zero over a font.
//
// The harfbuzzjs package ships the subset build as a bare wasm with no JS glue
// (its exports map only exposes the shaping API), so we instantiate
// `harfbuzzjs/dist/harfbuzz-subset.wasm` directly — it imports nothing and is
// initialized with one `_initialize()` call. Default hb-subset behavior keeps
// the layout features of the retained glyphs (kern/liga/calt via GSUB/GPOS
// subsetting) and the variation tables (fvar/gvar), so variable axes survive.
//
// `WD_HARFBUZZ_WASM` and `WD_WAWOFF2_MODULE` override the two tool specifiers;
// tests point them at nonexistent paths to exercise the toolchain-absent path
// without uninstalling anything. They are test seams, not public knobs.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** hb_memory_mode_writable: the blob may keep referencing the malloc'd bytes. */
const HB_MEMORY_MODE_WRITABLE = 2;

/**
 * Load the optional toolchain, or null when either half is absent. The wasm
 * path resolves through the harfbuzzjs package's exports map, so a consumer's
 * `npm i -D harfbuzzjs` beside the installed framework is found the same way
 * sharp is for the image pre-pass.
 * @returns {Promise<{ hb: any, compress: (input: Uint8Array) => Promise<Uint8Array> } | null>}
 */
export async function loadFontTools() {
  try {
    const require = createRequire(import.meta.url);
    const wasmPath =
      process.env.WD_HARFBUZZ_WASM ?? require.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm");
    const { instance } = await WebAssembly.instantiate(await fs.promises.readFile(wasmPath));
    const hb = /** @type {any} */ (instance.exports);
    hb._initialize();
    const compress = require(process.env.WD_WAWOFF2_MODULE || "wawoff2").compress;
    return { hb, compress };
  } catch {
    return null;
  }
}

/**
 * Subset one font to `codepoints`, returning the subset as TTF bytes (the
 * caller encodes to woff2). Throws when harfbuzz cannot parse or subset the
 * file. Every wasm handle is released on both paths; the heap view is taken
 * fresh at each use because a malloc can grow (and detach) the memory.
 * @param {any} hb The hb-subset wasm exports.
 * @param {Uint8Array} fontBytes The original font file.
 * @param {number[]} codepoints The charset to keep.
 * @returns {Uint8Array}
 */
export function subsetFont(hb, fontBytes, codepoints) {
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error("harfbuzz could not create a subset input");
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const cp of codepoints) hb.hb_set_add(unicodes, cp);
  const fontPtr = hb.malloc(fontBytes.byteLength);
  new Uint8Array(hb.memory.buffer).set(fontBytes, fontPtr);
  const blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const subsetFace = hb.hb_subset_or_fail(face, input);
  if (!subsetFace) {
    hb.hb_face_destroy(face);
    hb.hb_subset_input_destroy(input);
    hb.free(fontPtr);
    throw new Error("harfbuzz could not parse or subset the font");
  }
  const subsetBlob = hb.hb_face_reference_blob(subsetFace);
  const length = hb.hb_blob_get_length(subsetBlob);
  const dataPtr = hb.hb_blob_get_data(subsetBlob, 0);
  const bytes = new Uint8Array(hb.memory.buffer, dataPtr, length).slice();
  hb.hb_blob_destroy(subsetBlob);
  hb.hb_face_destroy(subsetFace);
  hb.hb_face_destroy(face);
  hb.hb_subset_input_destroy(input);
  hb.free(fontPtr);
  return bytes;
}

/**
 * Run every job in the jobs file and write the results file.
 * @param {string} jobsFile JSON `{ charset: number[], jobs: [{ source, out }] }`.
 * @param {string} resultsFile Written with `{ unavailable, failed }`.
 * @returns {Promise<void>}
 */
export async function runJobsFile(jobsFile, resultsFile) {
  const payload = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
  /** @type {(result: { unavailable: boolean, failed: { file: string, error: string }[] }) => void} */
  const write = (result) => fs.writeFileSync(resultsFile, JSON.stringify(result));
  const tools = await loadFontTools();
  if (!tools) {
    write({ unavailable: true, failed: [] });
    return;
  }
  /** @type {{ file: string, error: string }[]} */
  const failed = [];
  for (const job of payload.jobs) {
    try {
      const subset = subsetFont(tools.hb, fs.readFileSync(job.source), payload.charset);
      const woff2 = await tools.compress(subset);
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      fs.writeFileSync(job.out, woff2);
    } catch (err) {
      failed.push({
        file: job.source,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  write({ unavailable: false, failed });
}

// Entry-point guard, one line so importing this module in a test registers the
// line as executed without running main (same pattern as the coverage gate).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  runJobsFile(process.argv[2], process.argv[3]);
