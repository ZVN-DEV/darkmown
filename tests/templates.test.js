import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { availableTemplates, initProject } from "../src/scaffold.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-tmpl-"));
}

test("availableTemplates lists every shipped template", () => {
  const list = availableTemplates();
  for (const name of ["starter", "blog", "store", "dashboard", "landing"]) {
    assert.ok(list.includes(name), `missing template: ${name}`);
  }
});

test("init defaults to the starter template", () => {
  const root = tmp();
  const result = initProject(root);
  assert.equal(result.template, "starter");
  assert.ok(fs.existsSync(path.join(root, "site/pages/about.md")));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module", "templates set type:module so api/*.js import as ESM");
});

test("init --template store copies its api function and data", () => {
  const root = tmp();
  const result = initProject(root, { template: "store" });
  assert.equal(result.template, "store");
  assert.ok(fs.existsSync(path.join(root, "api/checkout.js")));
  assert.ok(fs.existsSync(path.join(root, "site/_/products.json")));
});

test("an unknown template errors with the available list", () => {
  assert.throws(
    () => initProject(tmp(), { template: "nope" }),
    /Unknown template "nope".*starter/s
  );
});

test("init never overwrites existing files", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Mine\n");
  initProject(root, { template: "blog" });
  assert.equal(fs.readFileSync(path.join(root, "site/pages/index.wd"), "utf8"), "# Mine\n");
});

test("every shipped template scaffolds and builds without error", () => {
  for (const name of availableTemplates()) {
    const root = tmp();
    initProject(root, { template: name });
    const { routes } = buildSite(root);
    assert.ok(routes.length > 0, `${name} produced no routes`);
  }
});

test("every template's .md pages link a stylesheet and stay static", () => {
  let mdPages = 0;
  for (const name of availableTemplates()) {
    const root = tmp();
    initProject(root, { template: name });
    const { routes } = buildSite(root);
    for (const route of routes.filter((r) => r.file.endsWith(".md"))) {
      mdPages++;
      assert.ok(route.assets.skins.length > 0, `${name} ${route.route} links no stylesheet`);
      assert.equal(route.assets.runtime, false, `${name} ${route.route} must stay static`);
      assert.deepEqual(route.assets.scripts, [], `${name} ${route.route} must ship no scripts`);
      const html = fs.readFileSync(
        path.join(root, "dist", route.route.slice(1), "index.html"),
        "utf8"
      );
      assert.match(html, /<link rel="stylesheet"/, `${name} ${route.route} HTML lacks the link`);
    }
  }
  assert.ok(mdPages > 0, "no template ships a .md page — the assertion never ran");
});

test("blog template lists posts from the collection, dated by frontmatter", () => {
  const root = tmp();
  initProject(root, { template: "blog" });
  assert.ok(
    !fs.existsSync(path.join(root, "site/_/posts.json")),
    "posts are a collection now — no manifest"
  );
  assert.ok(fs.existsSync(path.join(root, "site/pages/posts/_schema.wd")));
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.ok(html.includes("2026-01-15"), "hello-darkmown renders its frontmatter date");
  assert.ok(html.includes("2026-02-02"), "markdown-native renders its frontmatter date");
  assert.ok(
    html.indexOf("markdown-native") < html.indexOf("hello-darkmown"),
    "posts sort newest first"
  );
});

test("init puts the agent guide at the PROJECT root, where agents actually read it", () => {
  // The package has always carried a full build-with-Darkmown guide, but at the
  // PACKAGE root: a consumer's copy lands in node_modules/@zvndev/darkmown/,
  // which no coding agent reads. Agents read instruction files from the project
  // root, so a scaffolded project that does not have one there starts every
  // session with the agent guessing at directive syntax.
  const root = tmp();
  initProject(root);

  const shipped = fs.readFileSync(path.join(import.meta.dirname, "..", "AGENTS.md"), "utf8");
  const scaffolded = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  // Byte-identical, not a paraphrase: one maintained file means a scaffolded
  // project and this repo can never teach different syntax.
  assert.equal(scaffolded, shipped);

  // CLAUDE.md is a POINTER, not a second copy. Claude Code reads CLAUDE.md and
  // most other agents read AGENTS.md; duplicating the guide would give us two
  // files to keep true and they would drift.
  const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.match(claude, /AGENTS\.md/);
  assert.ok(claude.length < 1000, "CLAUDE.md must stay a pointer; it duplicated the guide instead");

  fs.rmSync(root, { recursive: true, force: true });
});

test("init writes a .gitignore, so the first `git init` does not stage dist/", () => {
  const root = tmp();
  initProject(root);
  const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  for (const entry of ["node_modules/", "dist/"]) {
    assert.ok(ignored.includes(entry), `.gitignore is missing ${entry}`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("init never overwrites agent files a project already has", () => {
  // Re-running init in an existing project must not clobber instructions the
  // user wrote. Same never-overwrite contract as every other scaffolded file.
  const root = tmp();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "MINE\n");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "MINE TOO\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "custom\n");
  initProject(root);
  assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "MINE\n");
  assert.equal(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), "MINE TOO\n");
  assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "custom\n");
  fs.rmSync(root, { recursive: true, force: true });
});

test("every template scaffolds the agent files, not just the starter", () => {
  for (const template of availableTemplates()) {
    const root = tmp();
    initProject(root, { template });
    for (const file of ["AGENTS.md", "CLAUDE.md", ".gitignore"]) {
      assert.ok(
        fs.existsSync(path.join(root, file)),
        `template ${template} scaffolded without ${file}`
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
