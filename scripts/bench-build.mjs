#!/usr/bin/env node

// Build throughput benchmark. Generates a synthetic-but-realistic site in a
// temp dir (default 1000 pages: ~80% `.md` posts in a collection folder with
// frontmatter + headings/lists/links/fenced code, ~20% `.wd` pages with a
// static `@loop` over a shared JSON file and an `@include` from `site/_`) so
// the run exercises frontmatter, markdown, syntax highlighting, collections,
// includes, and static loops — then times a full production build two ways:
//
//   cold spawn   `node src/cli.js build` in a child process — total wall time
//                a real user's `darkmown build` takes, process startup included
//   in-process   `buildSite()` called directly — compile time only
//
// Usage:  node scripts/bench-build.mjs [--pages N] [--dir path]
//   --pages N   page count (default 1000)
//   --dir path  generate into `path` and leave it behind (default: os tmpdir,
//               cleaned up on exit)
//
// Exits non-zero if the build fails. Zero deps; prints the host CPU so numbers
// stay honest across machines. The builder exposes no per-phase timings, so
// only wall totals are reported (do not instrument builder.js for this).
//
// Reference numbers (Apple M5 Max, 18 cores, macOS, Node 24 — 2026-07-11):
//   1000 pages (median of 3): cold spawn 1.98 s (~505 pages/s), in-process 2.07 s (~483 pages/s)
//   5000 pages (single run):  cold spawn 9.86 s (~507 pages/s), in-process 10.31 s (~485 pages/s)
// Throughput is flat across scale (~500 pages/s) — the build is linear in page
// count. In-process reads slightly slower than the spawn because it runs second
// and its full-build dist wipe removes the spawn run's 1000-route output.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cliPath = path.join(repoRoot, "src", "cli.js");

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
const pageCount = Math.max(2, Number(flagValue("--pages") ?? 1000) || 1000);
const userDir = flagValue("--dir");
const siteDir = userDir
  ? path.resolve(userDir)
  : fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-bench-"));
const cleanup = !userDir;

// --- synthetic site ---------------------------------------------------------

// Deterministic pseudo-variation so every post differs without a dependency.
const TOPICS = ["routing", "collections", "feeds", "includes", "loops", "skins", "state", "forms"];
const WORDS = [
  "static",
  "reactive",
  "compile",
  "manifest",
  "directive",
  "frontmatter",
  "sitemap",
  "runtime",
  "keyed",
  "scoped",
  "paginated",
  "hardened"
];
const pick = (arr, i) => arr[i % arr.length];

function postMarkdown(i) {
  const topic = pick(TOPICS, i);
  const lines = [
    "---",
    `title: Post ${i} — notes on ${topic}`,
    `description: Benchmark post ${i} covering ${topic} with a ${pick(WORDS, i)} angle.`,
    `date: 2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    "---",
    "",
    `# Notes on ${topic} (${i})`,
    "",
    `This is entry number ${i} in the benchmark collection. It exists to make the`,
    `markdown pipeline do real work: headings, emphasis like **${pick(WORDS, i)}**`,
    `and *${pick(WORDS, i + 3)}*, inline code such as \`buildSite()\`, and links to`,
    `[the previous post](/posts/post-${String(Math.max(1, i - 1)).padStart(4, "0")}/) and [the docs](/docs/).`,
    "",
    `## Why ${topic} matters`,
    ""
  ];
  for (let p = 0; p < 3; p++) {
    lines.push(
      `Paragraph ${p + 1}: the ${pick(WORDS, i + p)} build keeps every page ${pick(WORDS, i + p + 5)}`,
      `while the ${topic} layer stays out of the shipped HTML. Nothing here is`,
      `lorem ipsum, but nothing here is load-bearing either — it only has to be parsed.`,
      ""
    );
  }
  lines.push(
    "### A quick checklist",
    "",
    `- keep ${topic} ${pick(WORDS, i + 1)}`,
    `- prefer ${pick(WORDS, i + 2)} output`,
    `- measure before claiming ${pick(WORDS, i + 4)} builds`,
    `- entry ${i} of ${pageCount}`,
    "",
    "### And some code for the highlighter",
    "",
    "```js",
    `export function demo${i % 100}(routes) {`,
    `  const hits = routes.filter((r) => r.topic === "${topic}");`,
    `  return hits.map((r) => ({ ...r, rank: r.rank + ${i % 7} }));`,
    "}",
    "```",
    "",
    `Numbered wrap-up for post ${i}:`,
    "",
    "1. parse the frontmatter",
    "2. render the markdown",
    "3. highlight the fence",
    `4. link it into the ${topic} collection`,
    ""
  );
  return lines.join("\n");
}

function wdPage(i) {
  return [
    "---",
    `title: Loop page ${i}`,
    `description: Benchmark .wd page ${i} — static loop over shared JSON plus an include.`,
    "---",
    "",
    `# Loop page ${i}`,
    "",
    "@include /bench-header.wd",
    "",
    `A static \`@loop\` unrolled at build time — page ${i} of the benchmark set.`,
    "",
    "@loop /bench-data.json into item",
    "@include /bench-card.wd",
    "@endloop",
    "",
    `Rendered from shared data; nothing reactive, page ${i} ships zero JS.`,
    ""
  ].join("\n");
}

const MARKER = ".darkmown-bench";

function generateSite(dir, total) {
  const pagesDir = path.join(dir, "site", "pages");
  const postsDir = path.join(pagesDir, "posts");
  const shelfDir = path.join(dir, "site", "_");
  // Refuse to clobber a real project: only wipe site/dist we generated ourselves
  // (marker file), never a pre-existing site/ that isn't ours.
  const marked = fs.existsSync(path.join(dir, MARKER));
  if (fs.existsSync(path.join(dir, "site")) && !marked) {
    console.error(
      `refusing to overwrite existing site/ in ${dir} — it was not generated by this benchmark. Use an empty --dir.`
    );
    process.exit(1);
  }
  fs.rmSync(path.join(dir, "site"), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), "generated by scripts/bench-build.mjs\n");
  fs.mkdirSync(postsDir, { recursive: true });
  fs.mkdirSync(shelfDir, { recursive: true });

  // Shared shelf assets the .wd pages pull in.
  fs.writeFileSync(
    path.join(shelfDir, "bench-data.json"),
    JSON.stringify(
      TOPICS.map((topic, i) => ({
        title: `Card: ${topic}`,
        body: `Row ${i} of the shared loop data — ${pick(WORDS, i)} by construction.`
      })),
      null,
      2
    )
  );
  fs.writeFileSync(path.join(shelfDir, "bench-card.wd"), "**{ item.title }**\n\n{ item.body }\n");
  fs.writeFileSync(
    path.join(shelfDir, "bench-header.wd"),
    "Shared header include — same file on every `.wd` page.\n"
  );

  // Home page (counts toward the total).
  fs.writeFileSync(
    path.join(pagesDir, "index.md"),
    [
      "---",
      "title: Darkmown build benchmark",
      "description: Synthetic site for measuring build throughput.",
      "site_url: https://bench.example.com",
      "---",
      "",
      "# Benchmark site",
      "",
      `${total} pages: markdown posts in a collection plus .wd loop/include pages.`,
      ""
    ].join("\n")
  );

  const mdCount = Math.round((total - 1) * 0.8);
  const wdCount = total - 1 - mdCount;
  for (let i = 1; i <= mdCount; i++) {
    fs.writeFileSync(path.join(postsDir, `post-${String(i).padStart(4, "0")}.md`), postMarkdown(i));
  }
  for (let i = 1; i <= wdCount; i++) {
    fs.writeFileSync(path.join(pagesDir, `loop-${String(i).padStart(4, "0")}.wd`), wdPage(i));
  }
  return { mdCount, wdCount };
}

// --- run --------------------------------------------------------------------

const fmt = (ms) => `${(ms / 1000).toFixed(2)} s`;
const rate = (pages, ms) => `${Math.round(pages / (ms / 1000))} pages/s`;

let exitCode = 0;
try {
  const { mdCount, wdCount } = generateSite(siteDir, pageCount);
  console.log(`bench:build — ${pageCount} pages (${mdCount + 1} .md incl. home, ${wdCount} .wd)`);
  console.log(
    `host: ${os.cpus()[0]?.model ?? "unknown CPU"} x${os.cpus().length}, node ${process.version}`
  );
  console.log(`site: ${siteDir}`);

  // Cold spawn — what a real `darkmown build` costs, process startup included.
  const spawnStart = performance.now();
  const child = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: siteDir,
    encoding: "utf8"
  });
  const spawnMs = performance.now() - spawnStart;
  if (child.status !== 0) {
    console.error(child.stdout ?? "");
    console.error(child.stderr ?? "");
    throw new Error(`build failed (exit ${child.status})`);
  }

  // In-process — build time alone, module load and process startup excluded.
  const { buildSite } = await import(path.join(repoRoot, "src", "builder.js"));
  const inStart = performance.now();
  const result = buildSite(siteDir, {});
  const inMs = performance.now() - inStart;
  const built = result.routes.length;

  console.log(`routes built: ${built}`);
  console.log(`cold spawn (node src/cli.js build): ${fmt(spawnMs)} — ${rate(built, spawnMs)}`);
  console.log(`in-process (buildSite):             ${fmt(inMs)} — ${rate(built, inMs)}`);
  console.log("per-phase: builder exposes no phase timings; wall totals only.");
} catch (err) {
  console.error(`bench:build — ${err.message}`);
  exitCode = 1;
} finally {
  if (cleanup) fs.rmSync(siteDir, { recursive: true, force: true });
}
process.exit(exitCode);
