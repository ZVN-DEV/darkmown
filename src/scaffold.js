import fs from "node:fs";
import path from "node:path";

const darkmownVersion = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

/**
 * Scaffold a new Darkmown project into `root`, creating files that don't exist.
 * @param {string} root Absolute path to the target project directory.
 * @returns {{ root: string }}
 */
export function initProject(root) {
  fs.mkdirSync(root, { recursive: true });
  writeNew(root, "package.json", JSON.stringify({
    scripts: {
      dev: "darkmown dev",
      build: "darkmown build"
    },
    devDependencies: {
      "@zvndev/darkmown": `^${darkmownVersion}`
    }
  }, null, 2));
  writeNew(root, "site/pages/index.wd", [
    "---",
    "title: My Darkmown site",
    "---",
    "",
    "@include /nav.wd",
    "",
    "<main>",
    "",
    "# My Darkmown site",
    "",
    "Plain Markdown works. Rename to `.wd` when you want directives.",
    "",
    ":state count = 0",
    "",
    "Count: { count }",
    "",
    ":button \"Increment\" -> count++",
    "",
    ":state todos = [\"Write a page\"]",
    "",
    "@loop todos into todo",
    "- { todo }",
    "@endloop",
    "",
    ":button \"Add\" -> todos += \"Add a loop\"",
    "",
    "</main>"
  ].join("\n"));
  writeNew(root, "site/pages/index.skin", [
    "tokens",
    "  ink #172026",
    "  paper #f7f2e8",
    "  accent #0f8b8d",
    "",
    "page",
    "  margin 0",
    "  font ui-sans-serif, system-ui, sans-serif",
    "  color $ink",
    "  bg $paper",
    "",
    "main",
    "  max-width 760px",
    "  margin 0 auto",
    "  padding 3rem 1.5rem",
    "",
    "nav",
    "  display flex",
    "  align-items center",
    "  justify-content space-between",
    "  gap 1rem",
    "  max-width 760px",
    "  margin 0 auto",
    "  padding 1.25rem 1.5rem",
    "",
    "nav strong",
    "  font-size 1.1rem",
    "",
    "nav .links",
    "  display flex",
    "  gap 1.25rem",
    "",
    "nav a",
    "  color $ink",
    "  text-decoration none",
    "  opacity .8",
    "",
    "nav a:hover",
    "  opacity 1",
    "  color $accent",
    "",
    "button",
    "  bg $accent",
    "  color white",
    "  border 0",
    "  padding .75rem 1rem",
    "  radius 8px"
  ].join("\n"));
  writeNew(root, "site/_/nav.wd", [
    "<nav>",
    "  <strong>My site</strong>",
    "  <span class=\"links\">",
    "    <a href=\"/\">Home</a>",
    "    <a href=\"/about/\">About</a>",
    "  </span>",
    "</nav>"
  ].join("\n"));
  writeNew(root, "site/pages/about.md", [
    "---",
    "title: About",
    "---",
    "",
    "# About",
    "",
    "This page is plain Markdown (`.md`) — strict CommonMark, zero framework JavaScript.",
    "Rename it to `.wd` when you want directives like state, loops, or forms.",
    "",
    "[Back home](/)"
  ].join("\n"));
  writeNew(root, "README.md", [
    "# My Darkmown site",
    "",
    "Run `npm install` and `npm run dev` to start the live compiler.",
    "",
    "- Pages live in `site/pages`.",
    "- Shared includes live in `site/_`.",
    "- Hidden route files start with `.` or `-`.",
    "- Colocated `index.skin` and `index.js` attach automatically."
  ].join("\n"));
  return { root };
}

/**
 * Write a file relative to `root` only if it does not already exist.
 * @param {string} root Project root directory.
 * @param {string} file Path relative to `root`.
 * @param {string} content File contents (a trailing newline is added).
 * @returns {void}
 */
function writeNew(root, file, content) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${content}\n`);
}
