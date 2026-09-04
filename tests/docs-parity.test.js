import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { directiveCatalog } from "../src/catalog.js";

// `CLAUDE.md` requires every feature to be documented in BOTH `README.md` and
// the docs page, and the two are hand-maintained copies of the same prose. That
// is exactly the arrangement that drifts: five README sections had no docs-page
// counterpart at all before this guard existed. This test does not compare
// wording (they are deliberately written differently), only that a top-level
// README section HAS a counterpart section on the page.

const README = "README.md";
const DOCS = "site/pages/docs/index.wd";

// README sections that intentionally have no docs-page equivalent. Each one
// needs a reason, and the list is meant to stay tiny.
const readmeOnly = new Map([
  ["showcase", "the site has a dedicated /showcase/ page instead of a docs section"],
  ["working from this repo", "cloning and running the framework repo is not a docs-site topic"]
]);

// Sections that exist on both, under names each surface chose for itself. The
// README name is the key. Renaming a live docs heading breaks inbound links and
// bookmarks, so the mapping lives here rather than in the page.
const aliases = new Map([
  ["quick start", "install"],
  ["commands", "cli reference"],
  ["authoring model", "routing rules"],
  ["seo feeds sitemap rss robots", "seo feeds"],
  ["dark mode tokens dark", "theme toggle theme"],
  ["the escape hatch", "colocation"]
]);

test("every README section has a counterpart section on the docs page", () => {
  const readmeSections = sections(README);
  const docsSections = new Set(sections(DOCS).map((s) => s.key));

  for (const { key, title } of readmeSections) {
    if (readmeOnly.has(key)) continue;
    const want = aliases.get(key) ?? key;
    assert.ok(
      docsSections.has(want),
      `README section "${title}" has no counterpart on ${DOCS}. ` +
        `Add a "## …" section that normalizes to "${want}", add an alias, or ` +
        "list it in readmeOnly with a reason."
    );
  }
});

test("the parity escape hatches are all still load-bearing", () => {
  // An allowlist entry that no longer matches a real README section is stale
  // bookkeeping that quietly widens the guard; an alias whose target vanished
  // means the check for that section has been silently switched off.
  const readmeKeys = new Set(sections(README).map((s) => s.key));
  const docsKeys = new Set(sections(DOCS).map((s) => s.key));

  for (const [key, reason] of readmeOnly) {
    assert.ok(
      readmeKeys.has(key),
      `readmeOnly lists "${key}", which is no longer a README section`
    );
    assert.ok(reason.length > 10, `readmeOnly entry "${key}" needs a real reason`);
  }
  for (const [from, to] of aliases) {
    assert.ok(readmeKeys.has(from), `alias "${from}" is no longer a README section`);
    assert.ok(docsKeys.has(to), `alias "${from}" points at "${to}", not a docs-page section`);
  }
});

/**
 * Top-level (`##`) sections of a markdown/`.wd` file, outside fenced code, each
 * with a comparison key: lowercased, inline markup and punctuation stripped,
 * whitespace collapsed. So "Global state — `:store`" and "Global state —
 * `:store`" match, and "Media — `:video`, `:audio`, `:embed`" reduces to
 * "media video audio embed".
 * @param {string} file
 * @returns {{ key: string, title: string }[]}
 */
function sections(file) {
  const out = [];
  let fence = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = "";
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (!heading || line.startsWith("###")) continue;
    const title = heading[1];
    const key = title
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ key, title });
  }
  return out;
}

test("AGENTS.md covers the whole catalog it claims is complete", () => {
  // AGENTS.md tells the reader "the complete set (nothing else exists)" and
  // "never invent directives", and `darkmown init` copies it byte-for-byte into
  // every scaffolded project. A missing entry does not just under-document the
  // feature, it actively instructs a coding agent to REFUSE to use it. So the
  // claim is only allowed to stand while it is checkable against the compiler's
  // own catalog.
  const agents = fs.readFileSync("AGENTS.md", "utf8");
  const catalog = directiveCatalog();
  const missing = [];
  const want = (token, kind) => {
    if (!agents.includes(token)) missing.push(`${kind}: ${token}`);
  };

  for (const directive of catalog.directives) want(directive.name, "directive");
  for (const clause of catalog.loopClauses) want(clause.name, "@loop clause");
  for (const variable of catalog.loopVariables) want(variable.name, "loop variable");
  for (const pipe of catalog.formatPipes) want(`\`${pipe.name}`, "format pipe");
  for (const key of catalog.frontmatterKeys) want(`${key.name}:`, "frontmatter key");
  for (const op of catalog.predicateOps) want(op.name, "predicate operator");
  for (const op of catalog.actionOps) want(actionToken(op), "button action");

  assert.deepEqual(
    missing,
    [],
    `AGENTS.md claims the catalog is complete but omits:\n  ${missing.join("\n  ")}`
  );
});

/**
 * The literal a reader would have to see for an action op to be documented: the
 * verb when the op has one (`obj merge other` -> `merge`), otherwise the bare
 * operator (`n += k` -> `+=`). Derived from the catalog so a renamed op cannot
 * quietly stop being checked.
 * @param {{ syntax: string }} op
 * @returns {string}
 */
function actionToken(op) {
  const placeholders = new Set(["name", "n", "x", "v", "k", "list", "obj", "flag", "other", "key"]);
  const verb = op.syntax
    .split(/\s+/)
    .find((token) => /^[a-z]+$/.test(token) && !placeholders.has(token));
  return verb ?? op.syntax.replace(/[a-z\s"]/g, "");
}
