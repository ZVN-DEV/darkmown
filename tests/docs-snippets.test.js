import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCollections } from "../src/compiler/collections.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { discoverRoutes } from "../src/router.js";

const docsFiles = ["README.md", "docs/cli.md", "site/pages/docs/index.wd"];
const supportedCliCommands = new Set([
  "init",
  "dev",
  "build",
  "serve",
  "deploy",
  "catalog",
  "version",
  "help"
]);

// Every hand-written `.wd` example ships to a user: README.md is the npm landing
// page, AGENTS.md is copied byte-for-byte into every scaffolded project (and is
// what a coding agent reads), and the docs page is the site. All three are
// compiled here so a broken example cannot ship.
//
// A block that genuinely cannot stand alone (it continues a previous example, or
// illustrates grammar over names the reader supplies) is tagged ```wd-fragment.
// The tag is not free: each file has a hard cap, so mistagging a real breakage
// as a fragment eventually fails the build instead of hiding forever.
const fragmentBudget = {
  "README.md": 4,
  "AGENTS.md": 2,
  "site/pages/docs/index.wd": 12
};

const wdBlockFiles = Object.keys(fragmentBudget);

// A realistic shelf + one collection, so a doc example may reference the paths
// the docs themselves teach (`/products.json`, `@include /nav.wd`, the `blog`
// collection) instead of being downgraded to a fragment.
const fixtures = {
  "site/_/nav.wd": "[Home](/) · [Docs](/docs/)\n",
  "site/_/footer.wd": "Built with Darkmown.\n",
  "site/_/card.wd": "**{ title }**\n",
  "site/_/feature-card.wd": "- { card.name }\n",
  "site/_/team.json": JSON.stringify([{ name: "Ada" }, { name: "Grace" }]),
  "site/_/products.json": JSON.stringify([
    { id: 1, name: "Aurora Lamp", price: 49, featured: true },
    { id: 2, name: "Briza Fan", price: 89, featured: false }
  ]),
  "site/_/features.json": JSON.stringify([{ name: "Zero JS" }, { name: "One loop" }]),
  "site/_/posts.json": JSON.stringify([
    { title: "Hello", date: "2026-01-15" },
    { title: "Second", date: "2026-02-02" }
  ]),
  "site/_/org.json": JSON.stringify({ members: [{ name: "Ada" }] }),
  "site/pages/blog/hello.md":
    "---\ntitle: Hello, Darkmown\ndate: 2026-01-15\nexcerpt: First post.\n---\n\nHello.\n",
  "site/pages/blog/second.md":
    "---\ntitle: Second post\ndate: 2026-02-02\nexcerpt: Second post.\n---\n\nMore.\n"
};

test("documented shell snippets reference real npm scripts and CLI commands", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const help = execFileSync(process.execPath, ["src/cli.js", "--help"], { encoding: "utf8" });

  for (const file of docsFiles) {
    for (const snippet of fenced(file, "sh")) {
      for (const rawLine of snippet.split("\n")) {
        const line = rawLine.replace(/#.*/, "").trim();
        if (!line || line.startsWith("cd ") || line === "npm install" || line === "npm link")
          continue;

        const npmRun = line.match(/^npm run ([\w:-]+)/);
        if (npmRun) {
          assert.ok(pkg.scripts[npmRun[1]], `${file} documents missing npm script: ${line}`);
          continue;
        }

        const darkmown = line.match(
          /(?:^|\s)(?:npx\s+(?:@zvndev\/darkmown|darkmown)\s+|darkmown\s+)([\w:-]+)/
        );
        if (darkmown) {
          const command = darkmown[1];
          assert.ok(
            supportedCliCommands.has(command),
            `${file} documents unsupported CLI command: ${line}`
          );
          assert.match(
            help,
            new RegExp(`darkmown ${command}`),
            `${file} command missing from --help: ${command}`
          );
        }
      }
    }
  }
});

test("key .wd documentation snippets compile with the documented grammar", () => {
  const cases = [
    {
      name: "frontmatter arrays",
      body: snippetFrom("README.md", "title: Customers"),
      assert: (page) => assert.match(page.html, /Customers/)
    },
    {
      name: "state-driven where filter",
      body: snippetFrom("README.md", ':bind q placeholder="Search"'),
      assert: (page) => {
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-loop="products"/);
      }
    },
    {
      name: "cart row actions",
      body: snippetFrom("README.md", "cart remove line"),
      assert: (page) => {
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-action/);
      }
    },
    {
      name: "fetch and forms",
      body: snippetFrom("README.md", ":fetch team from"),
      assert: (page) => {
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-fetch/);
        assert.match(page.html, /data-wd-form/);
      }
    },
    {
      name: "comparison conditional",
      body: snippetFrom("README.md", "Count is high."),
      assert: (page) => {
        // A documented `:if count >= 10 … :else if count > 0` compiles to a
        // reactive expression region (proves the richer-condition grammar works).
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-if-expr=/);
      }
    },
    {
      name: "effect on watched state",
      body: snippetFrom("README.md", ":effect q -> searches++"),
      assert: (page) => {
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-effect/);
      }
    },
    {
      name: "authenticated fetch with refresh",
      body: snippetFrom("README.md", 'refresh="/auth/refresh"'),
      assert: (page) => {
        assert.equal(page.assets.runtime, true);
        assert.match(page.html, /data-wd-fetch-headers="session"/);
        assert.match(page.html, /data-wd-fetch-refresh="\/auth\/refresh"/);
      }
    }
  ];

  for (const item of cases) {
    const page = compileSnippet(item.name, item.body);
    item.assert(page);
  }
});

test("every ```wd block in the shipped docs compiles", () => {
  // Compile EVERY complete `wd` snippet in README.md, AGENTS.md, and the docs
  // page, not a hand-picked subset, so a structurally broken example (an
  // unclosed block, a stray `:::`, a `←` annotation left inside the fence) can
  // never ship again.
  for (const file of wdBlockFiles) {
    const complete = fenced(file, "wd");
    assert.ok(complete.length > 0, `expected complete \`wd\` snippets in ${file}`);
    complete.forEach((body, i) => {
      assert.doesNotThrow(
        () => compileSnippet(`${slug(file)}-wd-${i}`, body),
        `${file} wd block #${i} failed to compile:\n${body}`
      );
    });
  }
});

test("no `wd` block annotates a directive or frontmatter line with an arrow", () => {
  // The compile checks above catch an annotation that BREAKS parsing, which is
  // most of them. They cannot catch the one that matters most: `html: true  ←
  // needed for the raw <main> below` parses as the STRING "true  ← …", so raw
  // HTML stays escaped and the page compiles clean while doing the opposite of
  // what the example teaches. `.wd` has no comment syntax, so an arrow on a
  // directive or frontmatter line is always a mistake. Prose lines inside a
  // block are untouched: `[← Newer]({ page.prev })` is real markdown.
  const arrow = /[\u2190\u2192\u27F5\u27F6]/;
  for (const file of wdBlockFiles) {
    for (const lang of ["wd", "wd-fragment"]) {
      fenced(file, lang).forEach((body, i) => {
        let inFrontmatter = body.startsWith("---");
        body.split("\n").forEach((line, n) => {
          if (n > 0 && inFrontmatter && line.trim() === "---") inFrontmatter = false;
          const isSource = inFrontmatter || /^\s*[@:]/.test(line);
          assert.ok(
            !(isSource && arrow.test(line)),
            `${file} ${lang} block #${i} line ${n + 1} annotates source with an arrow ` +
              `(it is parsed as part of the value, not as a comment):\n  ${line}\n` +
              "Move the note into prose under the block."
          );
        });
      });
    }
  }
});

test("```wd-fragment blocks stay within budget and still fail with a WD code", () => {
  // The fragment tag is an escape hatch, so it gets two guards. A per-file cap
  // stops a real breakage being buried by a retag, and every fragment must still
  // be *Darkmown-shaped*: wrapped in a minimal valid page it either compiles or
  // throws a coded `[WDxxx]` author-facing error, never a bare Error, which
  // would mean the snippet crashed the compiler rather than being rejected by it.
  for (const [file, budget] of Object.entries(fragmentBudget)) {
    const fragments = fenced(file, "wd-fragment");
    assert.ok(
      fragments.length <= budget,
      `${file} tags ${fragments.length} \`wd-fragment\` blocks, budget is ${budget}. ` +
        "make the example self-contained instead of retagging it"
    );
    fragments.forEach((body, i) => {
      const page = /^---\r?\n/.test(body)
        ? body
        : `---\ntitle: Fragment\nhtml: true\n---\n\n${body}`;
      try {
        compileSnippet(`${slug(file)}-fragment-${i}`, page);
      } catch (err) {
        assert.match(
          err.message,
          /^\[WD\d{3}\] /,
          `${file} wd-fragment #${i} threw an uncoded error:\n${err.message}`
        );
      }
    });
  }
});

test("the fragment channel is in use on the docs page", () => {
  // The docs page leans on the convention hardest; if it ever drops to zero the
  // tag has silently lapsed and real breakage could hide behind a plain ```wd.
  assert.ok(
    fenced("site/pages/docs/index.wd", "wd-fragment").length > 0,
    "expected some blocks tagged ```wd-fragment (docs examples that reference external context)"
  );
});

test("README documents the package consumer smoke script", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const readme = fs.readFileSync("README.md", "utf8");
  const cliDocs = fs.readFileSync("docs/cli.md", "utf8");
  assert.equal(pkg.scripts.smoke, "node scripts/smoke-consumer.mjs");
  assert.match(readme, /npm run smoke/);
  assert.match(cliDocs, /npm run smoke/);
});

function compileSnippet(name, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `darkmown-doc-${slug(name)}-`));
  for (const [rel, contents] of Object.entries(fixtures)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), `${body}\n`);
  try {
    const paths = createPaths(root);
    // Build the collection index the same way `buildSite` does, so a documented
    // `@loop blog into post` resolves against a real folder of entries rather
    // than being downgraded to a fragment.
    const collections = buildCollections(discoverRoutes(paths.routesRoot), paths);
    // `paginate N` examples read the `page` pager, which the builder injects on
    // a paginated route. Seed the same shape so a documented listing compiles
    // the way it really does, instead of being downgraded to a fragment.
    const vars = { page: { current: 1, total: 2, prev: "", next: "/blog/page/2/" } };
    return compilePage(path.join(root, "site/pages/index.wd"), paths, { collections, vars });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function snippetFrom(file, needle) {
  const snippet = fenced(file, "wd").find((body) => body.includes(needle));
  assert.ok(snippet, `${file} is missing docs snippet containing ${needle}`);
  return snippet;
}

function fenced(file, lang) {
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  // `[\w-]` (not `\w`) so a hyphenated info string like `wd-fragment` is captured
  // as one token — otherwise the fence pairing desyncs and later blocks are lost.
  const re = /```([\w-]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1] === lang) out.push(match[2].trim());
  }
  return out;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
