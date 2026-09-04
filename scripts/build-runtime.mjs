#!/usr/bin/env node
// Minify the reactive runtime into the artifact that actually ships.
//
// `src/runtime.js` is the readable source: full JSDoc (it feeds `checkJs` and the
// generated `.d.ts`), explanatory comments, real identifiers. `src/runtime.min.js`
// is what `builder.js` copies to `dist/__wd/runtime.js`, and it is what the gzip
// budget in `.size-snapshot.json` measures. Minifying instead of only stripping
// comments bought ~2 KB gzipped, which is the headroom every new runtime feature
// spends.
//
// The artifact is COMMITTED, exactly like the playground bundle
// (`scripts/build-playground.mjs`). It has to be: `darkmown build` runs on a
// consumer's machine from the published tarball, where esbuild does not exist.
// So the bytes are generated here, checked in, and shipped.
//
// REGENERATE IT (`npm run build:runtime`) after ANY edit to `src/runtime.js`.
// Forgetting is not silent: `tests/runtime-min.test.js` rebuilds in memory and
// fails on a byte difference, and CI runs `--check` on top of that. Nothing
// regenerates the file behind your back — a regenerated file nobody commits is
// drift with the alarm disconnected.
//
// DETERMINISM: same `src/runtime.js` + same esbuild version (exact-pinned in
// package.json) ⇒ same bytes. That is what makes the drift guard a real guard.
//
// The `//# sourceMappingURL=runtime.js.map` comment is deliberately NOT the
// committed map's own filename: the file is served as `/__wd/runtime.js` and the
// map next to it as `/__wd/runtime.js.map`, and the comment has to resolve
// THERE, in a browser, not here in `src/`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { build } from "esbuild";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The readable source of truth. */
export const SOURCE_FILE = path.join(repoRoot, "src", "runtime.js");
/** The committed, minified artifact the builder ships. */
export const MIN_FILE = path.join(repoRoot, "src", "runtime.min.js");
/** The committed external sourcemap that rides next to it. */
export const MAP_FILE = path.join(repoRoot, "src", "runtime.min.js.map");

/**
 * The name both artifacts take once emitted under `/__wd/`. The sourcemap
 * comment and the map's own `file` field are written against THIS name, not the
 * `.min.js` name they carry in the repo.
 */
const SERVED_NAME = "runtime.js";

/**
 * Produce the minified runtime + its sourcemap in memory. No writes, so both
 * `main()` and the drift test can call it.
 * @returns {Promise<{ js: string, map: string }>} The exact bytes (utf8) of the
 *   two artifacts.
 */
export async function buildRuntime() {
  const result = await build({
    entryPoints: [SOURCE_FILE],
    outfile: MIN_FILE,
    write: false,
    // The runtime imports nothing, but bundling puts esbuild in module scope:
    // top-level identifiers become renameable, which is most of the win over a
    // bare transform. It also means the output is a real ES module, matching the
    // `<script type="module">` the compiler emits.
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    charset: "utf8",
    legalComments: "none",
    // External, not inline: an inline map would land inside the file the size
    // budget measures.
    sourcemap: "external",
    sourcesContent: true,
    logLevel: "warning"
  });

  const jsOut = result.outputFiles.find((file) => file.path.endsWith(".js"));
  const mapOut = result.outputFiles.find((file) => file.path.endsWith(".map"));
  if (!jsOut || !mapOut) throw new Error("build:runtime — esbuild produced no js/map pair");

  // Rewrite the map for where it is SERVED. `file` names the generated script as
  // the browser sees it (`runtime.js`), and `sources` points at a path that does
  // not collide with it — a source whose URL equals the generated script's URL
  // is ambiguous in devtools. The original text travels in `sourcesContent`
  // either way, so the path is a label, not a fetch.
  const map = JSON.parse(mapOut.text);
  map.file = SERVED_NAME;
  map.sources = [`../src/${SERVED_NAME}`];

  return {
    js: `${jsOut.text.trimEnd()}\n//# sourceMappingURL=${SERVED_NAME}.map\n`,
    map: `${JSON.stringify(map)}\n`
  };
}

/**
 * Gzipped size of a string, in bytes — the number the budget is denominated in.
 * @param {string} text
 * @returns {number}
 */
export function gzipSize(text) {
  return zlib.gzipSync(text).length;
}

/**
 * The committed artifacts, or nulls when either is missing.
 * @returns {{ js: string | null, map: string | null }}
 */
export function readCommitted() {
  const read = (/** @type {string} */ file) =>
    fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  return { js: read(MIN_FILE), map: read(MAP_FILE) };
}

async function main() {
  const check = process.argv.includes("--check");
  const fresh = await buildRuntime();
  const rel = (/** @type {string} */ file) => path.relative(repoRoot, file).replaceAll("\\", "/");

  if (check) {
    const committed = readCommitted();
    /** @type {string[]} */
    const stale = [];
    if (committed.js !== fresh.js) stale.push(rel(MIN_FILE));
    if (committed.map !== fresh.map) stale.push(rel(MAP_FILE));
    if (stale.length > 0) {
      console.error(
        `build:runtime --check — ${stale.join(" and ")} ${stale.length > 1 ? "do" : "does"} ` +
          `not match a fresh build of ${rel(SOURCE_FILE)}.\n` +
          "Run `npm run build:runtime` and commit the result."
      );
      process.exit(1);
    }
    console.log(
      `build:runtime --check — up to date (${gzipSize(fresh.js)} B gzipped, ${rel(MIN_FILE)}).`
    );
    return;
  }

  fs.writeFileSync(MIN_FILE, fresh.js);
  fs.writeFileSync(MAP_FILE, fresh.map);
  const raw = fs.statSync(SOURCE_FILE).size;
  console.log(
    `build:runtime — ${rel(MIN_FILE)}: ${fresh.js.length} B raw, ${gzipSize(fresh.js)} B gzipped ` +
      `(from ${raw} B of ${rel(SOURCE_FILE)}); map ${rel(MAP_FILE)}.`
  );
}

// Importing this file (the drift test does) must not build or exit.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
