// ---------------------------------------------------------------------------
// The file-reader abstraction the compiler reads every source through. The
// compiler never touches `node:fs` directly; instead a `Reader` is threaded
// through the `Compilation` (and the page-shell helpers), so the exact same
// compile can run against the real filesystem (`fsReader`, in `fs-reader.js`)
// or against an in-memory map of project-relative path → content
// (`memoryReader`, here). The memory path is what `compileFromMemory` — and a
// planned mobile/browser host — needs: a fully fs-free compile.
//
// This module imports NOTHING from `node:fs`, so it (and everything reachable
// from `compileFromMemory`) bundles cleanly for the browser. The Node reader
// lives in its own `fs-reader.js` that no browser-reachable module imports.
// ---------------------------------------------------------------------------

import path from "node:path";
import { normalizeNewlines } from "./context.js";

/**
 * The narrow filesystem surface the compiler needs. Every method takes an
 * ABSOLUTE path (the compiler resolves includes/assets to absolute paths before
 * reading), so a reader only has to map absolute paths to bytes/existence.
 * @typedef {object} Reader
 * @property {(absPath: string) => string} readText Read a UTF-8 text file. The
 *   result is ALWAYS LF-normalized: every parser downstream is line-structured
 *   and LF-shaped, so a CRLF source (Windows, or any `core.autocrlf` checkout)
 *   would otherwise fail to match delimiters like `---`. A custom reader must
 *   uphold this.
 * @property {(absPath: string) => Uint8Array} readBinary Read raw bytes (images).
 * @property {(absPath: string) => boolean} exists Whether the path exists.
 * @property {(absPath: string) => string} realpath Canonical path (symlinks
 *   resolved on a real fs; a no-op normalize in memory) — used for cycle keys.
 */

/**
 * A reader backed by an in-memory map of PROJECT-RELATIVE path → content. Keys
 * are POSIX, project-relative (e.g. `site/pages/index.wd`, `site/_/nav.wd`);
 * lookups translate an absolute compile path back to its key via `cwd`. There
 * are no symlinks in memory, so `realpath` just normalizes. Binary reads are
 * unsupported (the playground has no image files, and image measuring degrades
 * to "no dimensions" on a throw), so `readBinary` throws — callers already
 * try/catch it.
 * @param {Record<string, string> | Map<string, string>} files
 * @param {string} [cwd] Virtual project root the keys are relative to.
 * @returns {Reader}
 */
export function memoryReader(files, cwd = "/") {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  // Deliberately POSIX, not the host's `path`. An in-memory compile has no real
  // filesystem, so it must resolve identically on every platform — the browser
  // playground and a mobile host have no drive letters, and on Windows the host
  // `path.resolve("/site/pages/a.wd")` would return `D:\site\pages\a.wd`,
  // silently making the same file map compile differently there. Incoming
  // separators are normalized first so a caller passing Windows-style paths
  // still resolves to the same POSIX key.
  const toPosix = (/** @type {string} */ p) => p.replaceAll("\\", "/");
  const root = path.posix.resolve(toPosix(cwd));
  const resolve = (/** @type {string} */ absPath) => path.posix.resolve(root, toPosix(absPath));
  const keyOf = (/** @type {string} */ absPath) => path.posix.relative(root, resolve(absPath));
  return {
    readText: (absPath) => {
      const key = keyOf(absPath);
      const value = map.get(key);
      if (value === undefined) {
        throw new Error(`ENOENT: no in-memory file "${key}" (from ${absPath})`);
      }
      return normalizeNewlines(value);
    },
    readBinary: () => {
      throw new Error("memoryReader: binary reads are unsupported");
    },
    exists: (absPath) => map.has(keyOf(absPath)),
    realpath: (absPath) => resolve(absPath)
  };
}
