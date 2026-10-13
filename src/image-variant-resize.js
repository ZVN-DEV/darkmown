// ---------------------------------------------------------------------------
// The resize worker for the build-time image pre-pass (2.9.0). Never imported
// by the builder: the build is synchronous and sharp is not, so
// src/image-variants.js spawns this file as a child process with a jobs JSON
// file and reads back a results JSON file.
//
// sharp is an OPTIONAL dependency, so it is dynamic-imported inside a
// try/catch: when it cannot load (not installed, broken native binding), the
// worker reports `{ unavailable: true }` and exits cleanly — the parent turns
// that into one hint, and the build ships exactly what 2.8.0 would have.
// A failure on ONE image is recorded in `failed` and the rest still resize.
// Nothing here ever exits non-zero over an image.
//
// `WD_SHARP_MODULE` overrides the sharp specifier; tests point it at a
// nonexistent module to exercise the sharp-absent path without uninstalling
// anything. It is a test seam, not a public knob.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Run every job in the jobs file and write the results file.
 * @param {string} jobsFile JSON array of `{ source, out, width, format }`.
 * @param {string} resultsFile Written with `{ unavailable, failed }`.
 * @returns {Promise<void>}
 */
export async function runJobsFile(jobsFile, resultsFile) {
  const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
  /** @type {(result: { unavailable: boolean, failed: { file: string, width: number, error: string }[] }) => void} */
  const write = (result) => fs.writeFileSync(resultsFile, JSON.stringify(result));
  /** @type {any} */
  let sharp;
  try {
    sharp = (await import(process.env.WD_SHARP_MODULE || "sharp")).default;
  } catch {
    write({ unavailable: true, failed: [] });
    return;
  }
  /** @type {{ file: string, width: number, error: string }[]} */
  const failed = [];
  for (const job of jobs) {
    try {
      // `rotate()` honors EXIF orientation before resizing: the emitted variant
      // loses the EXIF tag with its pixels physically rotated, so it displays
      // exactly like the tag-carrying original. `withoutEnlargement` is belt and
      // braces — the pre-pass only ever queues widths below the intrinsic size.
      let pipeline = sharp(job.source)
        .rotate()
        .resize({ width: job.width, withoutEnlargement: true });
      if (job.format === "webp") pipeline = pipeline.webp({ quality: 82 });
      else if (job.format === "jpeg") pipeline = pipeline.jpeg({ quality: 82, progressive: true });
      else pipeline = pipeline.png({ compressionLevel: 9 });
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      await pipeline.toFile(job.out);
    } catch (err) {
      failed.push({
        file: job.source,
        width: job.width,
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
