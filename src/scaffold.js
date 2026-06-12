import fs from "node:fs";
import path from "node:path";

const darkmownVersion = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

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
    "button",
    "  bg $accent",
    "  color white",
    "  border 0",
    "  padding .75rem 1rem",
    "  radius 8px"
  ].join("\n"));
  writeNew(root, "site/_/nav.wd", [
    "<nav>",
    "  <a href=\"/\">Home</a>",
    "</nav>"
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

function writeNew(root, file, content) {
  const target = path.join(root, file);
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${content}\n`);
}
