import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wdError } from "./compiler/context.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.join(moduleDir, "templates");

const darkmownVersion = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

/**
 * List the available scaffold templates (directory names under `src/templates`).
 * @returns {string[]}
 */
export function availableTemplates() {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

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
export function initProject(root, options = {}) {
  const template = options.template || "starter";
  const templateDir = path.join(templatesDir, template);
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    const list = availableTemplates().join(", ");
    throw wdError(
      `Unknown template "${template}". Available templates: ${list || "(none)"}. ` +
        "Use: darkmown init [dir] --template <name>",
      { code: "WD903", hint: "darkmown init [dir] --template <name>" }
    );
  }

  fs.mkdirSync(root, { recursive: true });

  // package.json is generated, not copied: the name follows the target directory,
  // the dep pins the installed Darkmown version, and `type: "module"` makes a
  // project `api/*.js` import as ESM in `darkmown dev` and on every host.
  writeNew(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: packageNameFromRoot(root),
        private: true,
        type: "module",
        scripts: {
          dev: "darkmown dev",
          build: "darkmown build",
          preview: "darkmown serve"
        },
        devDependencies: {
          "@zvndev/darkmown": `^${darkmownVersion}`
        }
      },
      null,
      2
    )}\n`
  );

  // Agent context. The package already carries a full build-with-Darkmown
  // guide, but at the PACKAGE root — so a consumer's copy lands in
  // node_modules/@zvndev/darkmown/AGENTS.md, where no coding agent looks. Agents
  // read instruction files from the PROJECT root, so the guide is copied there
  // and the scaffolded project starts with the directive vocabulary in context
  // instead of the agent guessing at it.
  //
  // Copied rather than generated: it is one maintained file, so a scaffolded
  // project and this repo can never teach different syntax.
  copyNew(path.join(moduleDir, "..", "AGENTS.md"), path.join(root, "AGENTS.md"));

  // Claude Code reads CLAUDE.md; most other agents read AGENTS.md. A pointer,
  // not a second copy, so there is exactly one file to keep true.
  writeNew(
    root,
    "CLAUDE.md",
    "# Project instructions\n\n" +
      "This project is built with [Darkmown](https://darkmown.com). " +
      "The directive reference, project layout, and build rules are in " +
      "[AGENTS.md](./AGENTS.md). Read it before writing or editing any " +
      "`.md`/`.wd` file.\n\n" +
      "Refresh the directive reference at any time with " +
      "`npx darkmown catalog --llms` (cheatsheet) or " +
      "`npx darkmown catalog --llms-full` (full reference). Both are generated " +
      "from the compiler's own tables, so they cannot drift from what compiles.\n"
  );

  // Without this a first `git init` stages the build output and the whole
  // dependency tree, which is the first thing anyone does after `init`.
  writeNew(root, ".gitignore", "node_modules/\ndist/\n.DS_Store\n");

  for (const rel of walk(templateDir)) {
    copyNew(path.join(templateDir, rel), path.join(root, rel));
  }
  return { root, template };
}

/**
 * Write a file relative to `root` only if it does not already exist. Content is
 * written verbatim (callers include any trailing newline).
 * @param {string} root Project root directory.
 * @param {string} file Path relative to `root`.
 * @param {string} content File contents.
 * @returns {void}
 */
function writeNew(root, file, content) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * Copy a template file to `dest`, preserving bytes, only if `dest` is absent.
 * @param {string} source
 * @param {string} dest
 * @returns {void}
 */
function copyNew(source, dest) {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

/**
 * Relative paths of every file under `dir` (POSIX-separated), recursively.
 * @param {string} dir
 * @param {string} [base]
 * @returns {string[]}
 */
function walk(dir, base = dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs, base));
    else files.push(path.relative(base, abs).replaceAll(path.sep, "/"));
  }
  return files;
}

/**
 * Derive a safe default npm package name from the scaffold target directory.
 * @param {string} root Absolute target directory.
 * @returns {string}
 */
function packageNameFromRoot(root) {
  const base = path.basename(root) || "darkmown-site";
  const normalized = base
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return normalized || "darkmown-site";
}
