/**
 * The narrow filesystem surface the compiler needs. Every method takes an
 * ABSOLUTE path (the compiler resolves includes/assets to absolute paths before
 * reading), so a reader only has to map absolute paths to bytes/existence.
 * @typedef {object} Reader
 * @property {(absPath: string) => string} readText Read a UTF-8 text file.
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
export function memoryReader(files: Record<string, string> | Map<string, string>, cwd?: string): Reader;
/**
 * The narrow filesystem surface the compiler needs. Every method takes an
 * ABSOLUTE path (the compiler resolves includes/assets to absolute paths before
 * reading), so a reader only has to map absolute paths to bytes/existence.
 */
export type Reader = {
    /**
     * Read a UTF-8 text file.
     */
    readText: (absPath: string) => string;
    /**
     * Read raw bytes (images).
     */
    readBinary: (absPath: string) => Uint8Array;
    /**
     * Whether the path exists.
     */
    exists: (absPath: string) => boolean;
    /**
     * Canonical path (symlinks
     * resolved on a real fs; a no-op normalize in memory) — used for cycle keys.
     */
    realpath: (absPath: string) => string;
};
