import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { CATALOG_ACTION_TOKENS, directiveCatalog, llmsText } from "../src/catalog.js";
import { run } from "../src/cli.js";
import { ACTION_USE } from "../src/compiler/actions.js";
import { LOOP_META } from "../src/compiler/context.js";
import { FORMATTER_NAMES } from "../src/compiler/format.js";
import { PREDICATE_OPS } from "../src/compiler/predicates.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

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
  ":select": { close: "\n- One\n- Two" },
  ":checkbox": { close: "\n- A\n- B" },
  ":radio": { close: "\n- S\n- M" },
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

test("every catalog action token appears in the action vocabulary (ACTION_USE)", () => {
  for (const token of CATALOG_ACTION_TOKENS) {
    assert.ok(ACTION_USE.includes(token), `action token "${token}" missing from ACTION_USE`);
  }
  // Reverse guard: every operation keyword named in ACTION_USE has a catalog op.
  for (const kw of [
    "++",
    "--",
    "+=",
    "-=",
    "toggle",
    "append",
    "prepend",
    "remove",
    "clear",
    "merge",
    "delete",
    "reset"
  ]) {
    assert.ok(
      CATALOG_ACTION_TOKENS.includes(kw),
      `ACTION_USE keyword "${kw}" missing from catalog`
    );
  }
});

test("every catalog directive has a dispatch branch in body.js", () => {
  const body = fs.readFileSync(new URL("../src/compiler/body.js", import.meta.url), "utf8");
  for (const d of directiveCatalog().directives) {
    // Alternation-grouped directives (`:(video|audio)`, `:(checkbox|radio)`)
    // dispatch by the bare keyword, not the `:`-prefixed literal.
    const token = d.name === ":::" ? ":::" : d.name.replace(/^[@:]/, "");
    assert.ok(body.includes(token), `directive ${d.name} has no dispatch in body.js`);
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
  assert.ok(lineCount <= 130, `llms.txt is ${lineCount} lines — keep it compact`);
  const cat = directiveCatalog();
  assert.match(text, new RegExp(`v${cat.version.replace(/\./g, "\\.")}`));
  for (const section of ["## Directives", "## @loop clauses", "## Format pipes", "## Rules"]) {
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
  assert.equal(out, llmsText());
  assert.match(out, /Darkmown \.wd cheatsheet/);
  fs.rmSync(root, { recursive: true, force: true });
});
