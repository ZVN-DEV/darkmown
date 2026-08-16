/**
 * Reduce any path the compiler hands back to the caller's own key form.
 *
 * The caller addresses files with POSIX keys (`site/pages/index.wd`), but
 * `compileFromMemory` resolves them against its virtual root with
 * `path.resolve`, which is PLATFORM-NATIVE: on Windows the same file comes back
 * as `C:\site\pages\index.wd`. Comparing that to the caller's keys matches
 * nothing, so every symbol gets filed under a path that is not in the project
 * and every symbol-targeted edit fails. The virtual root is not a real
 * filesystem and its separator is an accident of the host, so normalising here
 * is the fix rather than a workaround.
 *
 * @param {string} p
 * @returns {string}
 */
export function posixKey(p: string): string;
/**
 * Shorten a virtual absolute path to what the author would call the file.
 * The model never saw `/site/pages/`, so echoing it back is noise it may copy.
 * @param {string} p
 * @returns {string}
 */
export function shortPath(p: string): string;
/**
 * TOOL ENTRY POINT.
 *
 * @param {Record<string, string>} files Project-relative path → contents, e.g.
 *   `{"site/pages/index.wd": "---\ntitle: X\n---\n"}`.
 * @param {string} entry Which file to compile, in the same key form.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function validate(files: Record<string, string>, entry: string): {
    ok: boolean;
    text: string;
    data: object;
};
