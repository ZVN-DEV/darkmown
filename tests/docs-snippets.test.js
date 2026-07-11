import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

const docsFiles = ["README.md", "docs/cli.md", "site/pages/docs/index.wd"];
const supportedCliCommands = new Set(["init", "dev", "build", "serve", "version", "help"]);

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

test("every ```wd block on the docs page compiles (deliberate fragments are tagged wd-fragment)", () => {
  // Compile EVERY complete `wd` snippet on the docs page — not a hand-picked
  // subset — so a structurally broken example (unclosed block, stray `:::`,
  // missing @endloop) can't ship again. Snippets that reference external files,
  // collections, or undeclared state can't compile standalone and are marked
  // ```wd-fragment (excluded here) rather than skipped silently.
  const file = "site/pages/docs/index.wd";
  const complete = fenced(file, "wd");
  assert.ok(complete.length > 0, "expected complete `wd` snippets on the docs page");
  complete.forEach((body, i) => {
    assert.doesNotThrow(
      () => compileSnippet(`docs-wd-${i}`, body),
      `docs wd block #${i} failed to compile:\n${body}`
    );
  });
  // The fragment channel must actually be in use — otherwise a real broken block
  // could be hidden by mistagging it, or the tag convention has silently lapsed.
  assert.ok(
    fenced(file, "wd-fragment").length > 0,
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
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/_/team.json"), JSON.stringify([{ name: "Ada" }]));
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), `${body}\n`);
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
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
