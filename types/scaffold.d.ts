/**
 * List the available scaffold templates (directory names under `src/templates`).
 * @returns {string[]}
 */
export function availableTemplates(): string[];
/**
 * Scaffold a new Darkmown project into `root` from a template, creating files
 * that don't already exist (never overwriting). `package.json` is generated (so
 * the name tracks the directory and the `@zvndev/darkmown` dep pins the installed
 * version); `AGENTS.md` is copied from the package so coding agents find the
 * directive reference at the project root; `CLAUDE.md` and `.gitignore` are
 * generated; every other file is copied verbatim from the chosen template.
 * @param {string} root Absolute path to the target project directory.
 * @param {{ template?: string }} [options] `template` defaults to `"starter"`.
 * @returns {{ root: string, template: string }}
 */
export function initProject(root: string, options?: {
    template?: string;
}): {
    root: string;
    template: string;
};
