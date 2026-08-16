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
