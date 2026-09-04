import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../src/builder.js";
import { CATALOG_ACTION_TOKENS, directiveCatalog, llmsFullText, llmsText } from "../src/catalog.js";
import { run } from "../src/cli.js";
import { ACTION_USE } from "../src/compiler/actions.js";
import { LOOP_META } from "../src/compiler/context.js";
import { FORMATTER_NAMES } from "../src/compiler/format.js";
import { PREDICATE_OPS } from "../src/compiler/predicates.js";
import { SCHEMA_TYPES } from "../src/compiler/schema.js";
import { compileFromMemory, compilePage, parseFrontmatter } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { AI_CRAWLER_POLICIES } from "../src/feeds.js";

// Per-directive compile context: block openers get a closer, stateful lines get
// a preamble, and path-referencing examples get their fixture files written.
const CTX = {
  "@include": { files: { "site/_/header.wd": "# Header\n" } },
  "@loop": {
    files: {
      "site/_/products.json": JSON.stringify([
        { name: "A", price: 10 },
        { name: "B", price: 90 }
      ])
    },
    close: "\n- { p.name }\n@endloop"
  },
  ":::": { close: "\ncopy\n:::" },
  ":if": { preamble: ":state count = 0\n", close: "\nyes\n:endif" },
  ":computed": { preamble: ":state items = [1, 2, 3]\n" },
  ":effect": { preamble: ':state query = ""\n:state searches = 0\n' },
  ":every": { preamble: ":state seconds = 0\n" },
  ":button": { preamble: ":state count = 0\n" },
  ":form": { close: "\n:input name\n:endform" },
  // The three field directives read differently inside and outside a `:form`
  // (form field vs bound control), and the catalog example is the bare opener,
  // so each gets the `:state` its standalone reading binds to.
  ":select": { preamble: ':state topic = "One"\n', close: "\n- One\n- Two" },
  ":checkbox": { preamble: ":state toppings = false\n", close: "\n- A" },
  ":radio": { preamble: ':state size = "S"\n', close: "\n- S\n- M" },
  ":bind": { preamble: ':state query = ""\n' },
  ":carousel": { close: "\n::: slide\nhi\n:::\n:endcarousel" }
};

function compileExample(name, example) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-catalog-"));
  const ctx = CTX[name] ?? {};
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [rel, body] of Object.entries(ctx.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  const source = `${ctx.preamble ?? ""}${example}${ctx.close ?? ""}\n`;
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), source);
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Enforcement: every concrete example in the catalog actually compiles.
// ---------------------------------------------------------------------------

test("every directive example in the catalog compiles", () => {
  const cat = directiveCatalog();
  for (const d of cat.directives) {
    assert.doesNotThrow(
      () => compileExample(d.name, d.example),
      `catalog example for ${d.name} failed to compile: ${d.example}`
    );
  }
});

test("every format-pipe example in the catalog compiles inside a binding", () => {
  const cat = directiveCatalog();
  for (const p of cat.formatPipes) {
    // Each example is `{ path | pipe }`; wrap in a loop over a row so the path
    // resolves and the pipe folds/emits.
    const rows = JSON.stringify([
      {
        price: 10,
        qty: 2,
        rate: 0.5,
        score: 1.23,
        name: "x",
        bio: "y",
        nickname: "",
        published: "2026-01-01"
      }
    ]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-pipe-"));
    fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
    fs.writeFileSync(path.join(root, "site/_/rows.json"), rows);
    // Aggregate pipes read a list state; scalar pipes read a row field. Declare a
    // few list states so `{ cart | sum:"price" }` etc. resolve, then interpolate.
    const preamble =
      ':state cart = [{"price": 3}]\n:state scores = [1, 2]\n:state prices = [4, 5]\n:state tags = ["a", "b"]\n\n';
    fs.writeFileSync(
      path.join(root, "site/pages/index.wd"),
      `${preamble}@loop /rows.json into p\n- ${p.example}\n@endloop\n`
    );
    try {
      assert.doesNotThrow(
        () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
        `catalog pipe example failed to compile: ${p.example}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Drift guards: the catalog is sourced from the compiler's own tables.
// ---------------------------------------------------------------------------

test("format pipes exactly match FORMATTERS", () => {
  const names = directiveCatalog().formatPipes.map((p) => p.name);
  assert.deepEqual([...names].sort(), [...FORMATTER_NAMES].sort());
});

test("predicate operators exactly match PREDICATE_OPS", () => {
  const names = directiveCatalog().predicateOps.map((o) => o.name);
  assert.deepEqual(names, [...PREDICATE_OPS]);
});

test("loop variables exactly match LOOP_META", () => {
  const names = directiveCatalog().loopVariables.map((v) => v.name);
  assert.deepEqual([...names].sort(), Object.keys(LOOP_META).sort());
});

// The catalog↔compiler action-vocabulary guard used to live here as a HARDCODED
// literal array — a copy of the answer, which is why `refetch` drifted out of
// the catalog for three releases without a single test noticing. It now lives in
// tests/catalog-actions.test.js, which DERIVES the compiler's vocabulary by
// compiling probes. What remains here is the one direction that test cannot
// check: the WD311 error hint, which is prose in src/compiler/actions.js.
test("every catalog action token appears in the WD311 hint (ACTION_USE)", () => {
  // ACTION_USE is the tail of the "Unsupported button action" error — the only
  // place a model that guessed wrong is shown the real vocabulary.
  //
  // KNOWN GAP: `refetch` is implemented, catalogued, and documented, but absent
  // from ACTION_USE, so WD311 still under-reports the vocabulary. Closing it is
  // a one-line edit to src/compiler/actions.js. The allowlist below is asserted
  // to stay MINIMAL, so the day that edit lands this test fails until the entry
  // is pruned — a known gap can never quietly become a permanent exemption.
  const KNOWN_HINT_GAPS = new Set();
  for (const token of CATALOG_ACTION_TOKENS) {
    if (KNOWN_HINT_GAPS.has(token)) continue;
    assert.ok(ACTION_USE.includes(token), `action token "${token}" missing from ACTION_USE`);
  }
  for (const token of KNOWN_HINT_GAPS) {
    assert.ok(
      CATALOG_ACTION_TOKENS.includes(token),
      `KNOWN_HINT_GAPS names "${token}", which is not a catalog action — prune it`
    );
    assert.ok(
      !ACTION_USE.includes(token),
      `"${token}" is now in ACTION_USE — prune it from KNOWN_HINT_GAPS in this test`
    );
  }
});

// ---------------------------------------------------------------------------
// Dispatch: proved by COMPILING, not by grepping body.js.
//
// This test used to be a raw substring search over a 570-line file: for `:if`
// the needle was `"if"`, which any JavaScript satisfies, and deleting the entire
// `:embed` dispatch block left it at 20 pass / 0 fail. It asserted nothing its
// name claimed.
//
// The real question — "was this directive dispatched?" — has an exact oracle in
// the project's own first invariant: `.md` NEVER gets directive behavior. So the
// `.md` rendering of a directive line IS its undispatched rendering. Compile the
// same source under both extensions; if the outputs are equal, the `.wd` path
// treated the directive as prose, which is precisely what a missing dispatch
// branch looks like.
// ---------------------------------------------------------------------------

/** Compile one source under both extensions and report whether they differ. */
function dispatched(source, files = {}) {
  const wd = compileFromMemory({ ...files, "site/pages/index.wd": source }, "site/pages/index.wd");
  const md = compileFromMemory({ ...files, "site/pages/index.md": source }, "site/pages/index.md");
  return wd.html !== md.html;
}

test("every catalog directive is really dispatched (its .wd output is not prose)", () => {
  for (const d of directiveCatalog().directives) {
    const ctx = CTX[d.name] ?? {};
    const source = `${ctx.preamble ?? ""}${d.example}${ctx.close ?? ""}\n`;
    assert.ok(
      dispatched(source, ctx.files),
      `directive ${d.name} compiled to the same HTML as plain .md — it was never dispatched: ${d.example}`
    );
  }
});

test("the dispatch oracle is not vacuous — undispatched input compiles identically", () => {
  // Negative control, and the exact signature of a deleted dispatch branch: a
  // directive-SHAPED line the compiler has no handler for falls through to prose
  // in `.wd` just as it does in `.md`, so `dispatched()` reports false. Without
  // this, the test above could pass by `.wd` and `.md` always differing.
  assert.equal(dispatched("Just some prose.\n"), false);
  assert.equal(dispatched(":embedx https://example.com/clip\n"), false, "unknown `:embedx`");
  assert.equal(dispatched("@loopy items into x\n"), false, "unknown `@loopy`");
  // …while the real directive of the same shape IS dispatched.
  assert.equal(dispatched(":embed https://www.youtube.com/watch?v=dQw4w9WgXcQ\n"), true);
});

test("the catalog lists no demo-only directive", () => {
  // `:note` and `:sprint` are demo directives the spec doc says are not public.
  // They have never been in the catalog; this pins that so a future edit that
  // "completes" the catalog from body.js cannot promote them by accident.
  const names = directiveCatalog().directives.map((d) => d.name);
  for (const demo of [":note", ":sprint", ":try"]) {
    assert.ok(!names.includes(demo), `demo-only directive ${demo} is in the public catalog`);
  }
});

test("every catalog directive marks a valid reactivity", () => {
  for (const d of directiveCatalog().directives) {
    assert.ok(["static", "reactive", "either"].includes(d.reactive), `${d.name}: ${d.reactive}`);
  }
});

// ---------------------------------------------------------------------------
// llms.txt cheatsheet + CLI surface.
// ---------------------------------------------------------------------------

test("llms.txt is compact and self-consistent with the catalog", () => {
  const text = llmsText();
  const lineCount = text.split("\n").length;
  // CAP RAISED DELIBERATELY, 130 → 150 (the sheet is 136 lines today).
  // The audit found the cheatsheet silently omitting real vocabulary an agent
  // needs — block closers and `@empty`, `:else`/`:else if`, `{.class #id}` inline
  // attributes, collections and `_schema.wd`, and the ENTIRE `.skin` language,
  // while AGENTS.md instructs models to always ship styling. Four compact
  // sections closed that, costing 25 lines. The cap exists so the sheet stays a
  // system-prompt-sized artifact, not so it stays incomplete: raise it on
  // purpose, never by deleting a section.
  assert.ok(lineCount <= 150, `llms.txt is ${lineCount} lines — keep it compact`);
  const cat = directiveCatalog();
  assert.match(text, new RegExp(`v${cat.version.replace(/\./g, "\\.")}`));
  for (const section of [
    "## Directives",
    "## Block structure",
    "## @loop clauses",
    "## Format pipes",
    "## Inline attributes",
    "## Collections",
    "## Styling: the `.skin` language",
    "## Rules"
  ]) {
    assert.ok(text.includes(section), `llms.txt missing section: ${section}`);
  }
  // Every directive keyword is present in the cheatsheet.
  for (const d of cat.directives) assert.ok(text.includes(d.name), `llms.txt missing ${d.name}`);
});

test("`darkmown catalog` prints the JSON catalog", async () => {
  const out = [];
  const res = await run(["catalog"], { log: (m) => out.push(m) });
  assert.equal(res.command, "catalog");
  const parsed = JSON.parse(out.join("\n"));
  assert.equal(parsed.format, ".wd");
  assert.ok(Array.isArray(parsed.directives) && parsed.directives.length >= 20);
});

test("`darkmown catalog --llms` prints the cheatsheet", async () => {
  const out = [];
  const res = await run(["catalog", "--llms"], { log: (m) => out.push(m) });
  assert.equal(res.command, "catalog");
  assert.match(out.join("\n"), /Darkmown \.wd cheatsheet/);
});

test("a build emits dist/llms.txt with the cheatsheet", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-catalog-build-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.md"), "# Home\n");
  const { distRoot } = buildSite(root);
  const out = fs.readFileSync(path.join(distRoot, "llms.txt"), "utf8");
  assert.match(out, /Darkmown \.wd cheatsheet/);
  // The site-free cheatsheet is a prefix of the built one: the build appends the
  // page index, it never rewrites the reference.
  assert.ok(out.startsWith(llmsText()), "the built llms.txt diverges from the cheatsheet");
  fs.rmSync(root, { recursive: true, force: true });
});

// --- llms.txt / llms-full.txt: index and corpus ----------------------------

/** A small multi-page site with an origin, for the llms.txt pair. */
function llmsSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-llms-"));
  fs.mkdirSync(path.join(root, "site/pages/guide"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "site/pages/index.md"),
    [
      "---",
      "title: My Site",
      "description: Notes",
      "site_url: https://example.com",
      "---",
      "",
      "# Home"
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "site/pages/guide/index.md"),
    ["---", "title: Guide", "description: How to", "---", "", "Read the guide body."].join("\n")
  );
  return root;
}

test("llms.txt is an INDEX: every page, one line each, with absolute URLs", () => {
  const root = llmsSite();
  const { distRoot } = buildSite(root);
  const index = fs.readFileSync(path.join(distRoot, "llms.txt"), "utf8");

  assert.match(index, /^- \[My Site\]\(https:\/\/example\.com\/\): Notes$/m);
  assert.match(index, /^- \[Guide\]\(https:\/\/example\.com\/guide\/\): How to$/m);
  // An index points at the corpus; that pointer is the whole convention.
  assert.match(index, /\/llms-full\.txt/);
  // An index is NOT the corpus: page bodies stay out of it.
  assert.doesNotMatch(index, /Read the guide body/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("llms-full.txt is the CORPUS: full reference plus every page's source text", () => {
  const root = llmsSite();
  const { distRoot } = buildSite(root);
  const full = fs.readFileSync(path.join(distRoot, "llms-full.txt"), "utf8");

  assert.match(full, /Read the guide body/, "a page body is missing from the corpus");
  assert.match(full, /URL: https:\/\/example\.com\/guide\//);
  // The complete authoring reference: every directive AND every error code, so
  // an AI edit-loop that hits `[WD201]` can resolve it from the same fetch.
  for (const directive of directiveCatalog().directives) {
    assert.ok(full.includes(directive.syntax), `${directive.name} syntax missing from the corpus`);
  }
  assert.match(full, /WD201/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the built llms pair matches the generators exactly (no hand-editing drift)", () => {
  const root = llmsSite();
  const { distRoot } = buildSite(root);
  // Rebuild the corpus the way the builder must have: route order, real titles,
  // absolute URLs, and the AUTHORED body (not the rendered HTML). If the builder
  // ever hand-assembles either file instead of going through the generators,
  // or feeds them a different corpus, these equalities break.
  const bodyOf = (rel) =>
    parseFrontmatter(fs.readFileSync(path.join(root, "site/pages", rel), "utf8")).body;
  const corpus = {
    title: "My Site",
    description: "Notes",
    url: "https://example.com",
    pages: [
      {
        title: "My Site",
        url: "https://example.com/",
        description: "Notes",
        body: bodyOf("index.md")
      },
      {
        title: "Guide",
        url: "https://example.com/guide/",
        description: "How to",
        body: bodyOf("guide/index.md")
      }
    ]
  };
  assert.equal(fs.readFileSync(path.join(distRoot, "llms.txt"), "utf8"), llmsText(corpus));
  assert.equal(fs.readFileSync(path.join(distRoot, "llms-full.txt"), "utf8"), llmsFullText(corpus));
  fs.rmSync(root, { recursive: true, force: true });
});

test("the 404 route is not a page of the corpus", () => {
  const root = llmsSite();
  fs.writeFileSync(
    path.join(root, "site/pages/404.md"),
    ["---", "title: Not found", "---", "", "Nothing here, sorry."].join("\n")
  );
  const { distRoot } = buildSite(root);
  const index = fs.readFileSync(path.join(distRoot, "llms.txt"), "utf8");
  const full = fs.readFileSync(path.join(distRoot, "llms-full.txt"), "utf8");
  assert.doesNotMatch(index, /Not found/);
  assert.doesNotMatch(full, /Nothing here, sorry/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a site with no site_url indexes route paths rather than inventing an origin", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-llms-nourl-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.md"), "---\ntitle: Local\n---\n\n# Home\n");
  const { distRoot } = buildSite(root);
  assert.match(fs.readFileSync(path.join(distRoot, "llms.txt"), "utf8"), /^- \[Local\]\(\/\)$/m);
  fs.rmSync(root, { recursive: true, force: true });
});

test("the frontmatter key catalog documents only keys the framework really reads", () => {
  // A stale key here would teach an AI author to write frontmatter that does
  // nothing. Each documented name must appear in the source that consumes it.
  const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
  const sources = fs
    .readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".js"))
    .map((rel) => fs.readFileSync(path.join(srcRoot, rel), "utf8"))
    .join("\n");
  for (const key of directiveCatalog().frontmatterKeys) {
    assert.ok(
      new RegExp(`\\b${key.name}\\b`).test(sources),
      `frontmatter key "${key.name}" is documented but never read by src/`
    );
  }
});

test("the documented ai_crawlers example uses a real policy value", () => {
  const key = directiveCatalog().frontmatterKeys.find((k) => k.name === "ai_crawlers");
  const value = String(key?.example).split(":")[1].trim();
  assert.ok(AI_CRAWLER_POLICIES.includes(value), `"${value}" is not an accepted policy`);
});

test("the documented schema types are exactly the ones the compiler can build", () => {
  assert.deepEqual(directiveCatalog().schemaTypes, SCHEMA_TYPES);
});
