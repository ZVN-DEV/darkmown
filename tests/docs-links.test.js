import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { slugify } from "../src/compiler/markdown.js";

// Anchors and relative links are the one class of documentation bug that is
// invisible to every other gate: a dead `#anchor` still renders, a moved file
// still links, and a README pointing at a repo-only path 404s for the npm
// reader specifically (the tarball is a subset of the repo). Nothing here
// touches the network: only same-file anchors and on-disk paths.
const linkedFiles = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "site/pages/docs/index.wd",
  ...fs
    .readdirSync("docs")
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`)
];

test("every #anchor link resolves to a heading in the same file", () => {
  for (const file of linkedFiles) {
    const text = fs.readFileSync(file, "utf8");
    const ids = headingIds(text);
    for (const anchor of anchors(text)) {
      assert.ok(
        ids.has(anchor),
        `${file} links #${anchor}, which is not a heading in that file. ` +
          `Closest headings: ${nearest(anchor, ids).join(", ") || "(none)"}`
      );
    }
  }
});

test("every relative file link points at a file that exists", () => {
  for (const file of linkedFiles) {
    const text = fs.readFileSync(file, "utf8");
    const dir = path.dirname(file);
    for (const target of relativeTargets(text)) {
      const resolved = path.join(dir, target);
      assert.ok(fs.existsSync(resolved), `${file} links "${target}", which does not exist`);
    }
  }
});

test("every repo file README links is shipped in the npm tarball", () => {
  // README.md is the npmjs.com landing page, where a relative link resolves
  // against the *tarball*, not the repo. A path outside `package.json` files
  // is a 404 for exactly the reader who arrived from npm, so it has to be a
  // full GitHub URL instead.
  const shipped = JSON.parse(fs.readFileSync("package.json", "utf8")).files.filter(
    (entry) => !entry.startsWith("!")
  );
  const text = fs.readFileSync("README.md", "utf8");
  for (const target of relativeTargets(text)) {
    const clean = target.replace(/^\.\//, "");
    const inTarball = shipped.some((entry) => clean === entry || clean.startsWith(`${entry}/`));
    assert.ok(
      inTarball,
      `README links "${target}", which package.json "files" does not ship. ` +
        "Link the full https://github.com/ZVN-DEV/darkmown/... URL instead."
    );
  }
});

test("the docs page table of contents matches its headings in both directions", () => {
  const file = "site/pages/docs/index.wd";
  const text = fs.readFileSync(file, "utf8");
  const toc = tocAnchors(text);
  assert.ok(toc.length > 10, "expected the docs page 'On this page' list to be found");

  const ids = headingIds(text);
  for (const anchor of toc)
    assert.ok(ids.has(anchor), `${file} TOC entry #${anchor} has no matching heading`);

  // The other direction is the drift that actually happens: a section gets
  // added and the hand-maintained list is never touched.
  for (const { level, id, title } of headings(text)) {
    if (level !== 2) continue;
    assert.ok(
      toc.includes(id),
      `${file} section "${title}" (#${id}) is missing from the 'On this page' list`
    );
  }
});

/**
 * Every heading in a markdown/`.wd` source, outside fenced code, with the id the
 * compiler would stamp on it (GitHub-style slug, duplicates deduped `-1`/`-2`).
 * @param {string} text
 * @returns {{ level: number, id: string, title: string }[]}
 */
function headings(text) {
  const out = [];
  const counts = new Map();
  for (const line of outsideFences(text)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) continue;
    const title = plainText(match[2]);
    const base = slugify(title);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    out.push({ level: match[1].length, id: seen ? `${base}-${seen}` : base, title });
  }
  return out;
}

/** @param {string} text @returns {Set<string>} */
function headingIds(text) {
  return new Set(headings(text).map((h) => h.id));
}

/**
 * Heading text as the anchor plugin sees it: link labels survive, inline code
 * survives (its backticks do not), emphasis markers are dropped.
 * @param {string} raw
 * @returns {string}
 */
function plainText(raw) {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/** Same-file `#anchor` link targets, outside fenced code. @param {string} text */
function anchors(text) {
  const out = [];
  for (const line of outsideFences(text)) {
    for (const match of prose(line).matchAll(/\]\(#([^)]+)\)/g)) out.push(match[1]);
  }
  return out;
}

/** Relative (non-URL, non-anchor) link targets, outside fenced code. */
function relativeTargets(text) {
  const out = [];
  for (const line of outsideFences(text)) {
    for (const match of prose(line).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(target)) continue;
      out.push(target.replace(/#.*$/, ""));
    }
  }
  return out;
}

/**
 * A line with inline-code spans blanked out. `` `[jump](#my-heading)` `` is an
 * example of link syntax, not a link, and must not be resolved as one.
 * @param {string} line
 * @returns {string}
 */
function prose(line) {
  return line.replace(/`+[^`]*`+/g, "");
}

/** The anchors listed in the docs page's `docs-toc` nav. @param {string} text */
function tocAnchors(text) {
  const nav = text.slice(text.indexOf('<nav class="docs-toc"'), text.indexOf("</nav>"));
  return [...nav.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]);
}

/**
 * Source lines with fenced code blocks removed, so a `# comment` inside a
 * ```sh block is never mistaken for a heading and an example link inside a
 * fence is never checked.
 * @param {string} text
 * @returns {string[]}
 */
function outsideFences(text) {
  const out = [];
  let fence = "";
  for (const line of text.split("\n")) {
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = "";
      continue;
    }
    if (open) {
      fence = open[1];
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Headings that share a prefix with a broken anchor, to make the failure actionable. */
function nearest(anchor, ids) {
  const head = anchor.slice(0, 8);
  return [...ids].filter((id) => id.startsWith(head)).slice(0, 3);
}
