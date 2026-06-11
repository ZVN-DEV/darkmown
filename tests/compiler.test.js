import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

test("includes resolve relatively and from the include shelf across md/mdx/wd", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "---",
    "title: Home",
    "---",
    "@include ./local.md",
    "@include /shared.mdx"
  ].join("\n"));
  write(root, "site/pages/local.md", "## Local");
  write(root, "site/_/shared.mdx", "## Shared");

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<h2>Local<\/h2>/);
  assert.match(page.html, /<h2>Shared<\/h2>/);
});

test("repeat renders an include once per json row", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@repeat /card.wd from /cards.json");
  write(root, "site/_/card.wd", "**{{ title }}**");
  write(root, "site/_/cards.json", JSON.stringify([{ title: "One" }, { title: "Two" }]));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<strong>One<\/strong>/);
  assert.match(page.html, /<strong>Two<\/strong>/);
});

test("include cycles and traversal attempts fail clearly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /a.wd");
  write(root, "site/_/a.wd", "@include /b.wd");
  write(root, "site/_/b.wd", "@include /a.wd");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Include cycle detected/
  );

  write(root, "outside.wd", "# Outside");
  write(root, "site/pages/bad.wd", "@include ../../outside.wd");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /outside site\/pages or site\/_/
  );
});

test("build emits html, manifest, colocated skin css, and colocated script", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/index.skin", "tokens\n  ink #111\npage\n  color $ink");
  write(root, "site/pages/index.js", "document.body.dataset.ready = 'true';");

  const result = buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));

  assert.equal(result.routes.length, 1);
  assert.equal(manifest[0].route, "/");
  assert.match(manifest[0].assets.skins[0], /\.css$/);
  assert.match(manifest[0].assets.scripts[0], /\.js$/);
  assert.match(html, /stylesheet/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /type="module"/);
  assert.equal(fs.existsSync(path.join(root, "dist", manifest[0].assets.skins[0])), true);
  assert.equal(fs.existsSync(path.join(root, "dist", manifest[0].assets.scripts[0])), true);
});

test("reactive state renders initial inline value and button action", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    "Count: { count }",
    "`{ count }` stays code.",
    ":button \"Increment\" -> count++"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<script type="application\/json" data-wd-state>\{"count":0\}<\/script>/);
  assert.doesNotMatch(page.html, /&quot;count&quot;/);
  assert.match(page.html, /Count: <span data-wd-bind="count">0<\/span>/);
  assert.match(page.html, /<code>\{ count \}<\/code> stays code/);
  assert.match(page.html, /<button type="button" data-wd-action="inc" data-wd-target="count">Increment<\/button>/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test("button actions reject arbitrary JavaScript at compile time", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    ":button \"Bad\" -> fetch('/api')"
  ].join("\n"));

  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported button action/
  );
});

test("button action literals reject JavaScript-looking right hand sides", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    ":button \"Bad\" -> count = fetch('/api')"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported action literal/
  );

  const listRoot = fixture();
  write(listRoot, "site/pages/index.wd", [
    ":state todos = []",
    ":button \"Bad\" -> todos += window.alert(1)"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(listRoot, "site/pages/index.wd"), createPaths(listRoot)),
    /Unsupported action literal/
  );

  const malformedRoot = fixture();
  write(malformedRoot, "site/pages/index.wd", [
    ":state todos = []",
    ":button \"Bad\" -> todos += {bad}"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(malformedRoot, "site/pages/index.wd"), createPaths(malformedRoot)),
    /Unsupported action literal/
  );
});

test("conditionals render initial branch and emit runtime templates", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state open = false",
    ":if open",
    "Open branch",
    ":else",
    "Closed branch",
    ":endif",
    ":button \"Open\" -> open = true"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-if="open"/);
  assert.match(page.html, /<span data-wd-if-out><p>Closed branch<\/p><\/span>/);
  assert.match(page.html, /<template data-wd-true><p>Open branch<\/p><\/template>/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="open" data-wd-value="true"/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test("for loops render initial array rows and emit runtime template", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state todos = [\"One\", \"Two\"]",
    ":for todo in todos",
    "- { todo }",
    ":endfor",
    ":button \"Add\" -> todos += \"Three\""
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-for="todos" data-wd-item="todo"/);
  assert.match(page.html, /<li><span data-wd-each="todo">One<\/span><\/li>/);
  assert.match(page.html, /<li><span data-wd-each="todo">Two<\/span><\/li>/);
  assert.match(page.html, /data-wd-action="append" data-wd-target="todos" data-wd-value="&quot;Three&quot;"/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test("for loops handle empty arrays and missing end markers clearly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state items = []",
    ":for item in items",
    "- { item }",
    ":endfor"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-for="items"/);
  assert.match(page.html, /<span data-wd-for-out><\/span>/);

  write(root, "site/pages/bad.wd", [
    ":state items = []",
    ":for item in items",
    "- { item }"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Missing :endfor for :for item in items/
  );
});

test("for syntax in code stays static and unsafe list calls fail", () => {
  const staticRoot = fixture();
  write(staticRoot, "site/pages/index.md", [
    "```wd",
    ":for item in items",
    "{ item }",
    ":endfor",
    "```",
    "`:for item in items` and `{ item }`"
  ].join("\n"));
  buildSite(staticRoot);
  const staticManifest = JSON.parse(fs.readFileSync(path.join(staticRoot, "dist/routes.json"), "utf8"));
  const staticHtml = fs.readFileSync(path.join(staticRoot, "dist/index.html"), "utf8");
  assert.equal(staticManifest[0].assets.runtime, false);
  assert.doesNotMatch(staticHtml, /\/__wd\/runtime\.js/);
  assert.match(staticHtml, /<code>:for item in items<\/code>/);
  assert.match(staticHtml, /<code>\{ item \}<\/code>/);

  const badRoot = fixture();
  write(badRoot, "site/pages/index.wd", [
    ":state items = []",
    ":button \"Bad\" -> items.push(fetch(\"/api\"))"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(badRoot, "site/pages/index.wd"), createPaths(badRoot)),
    /Unsupported button action/
  );
});

test("reactive pages emit runtime and static pages stay runtime-free", () => {
  const reactiveRoot = fixture();
  write(reactiveRoot, "site/pages/index.wd", [
    ":state count = 0",
    "Count: { count }",
    ":button \"Increment\" -> count++"
  ].join("\n"));
  const reactive = buildSite(reactiveRoot);
  const reactiveManifest = JSON.parse(fs.readFileSync(path.join(reactiveRoot, "dist/routes.json"), "utf8"));
  const reactiveHtml = fs.readFileSync(path.join(reactiveRoot, "dist/index.html"), "utf8");
  assert.equal(reactive.routes.length, 1);
  assert.deepEqual(reactiveManifest[0].assets.scripts, ["/__wd/runtime.js"]);
  assert.match(reactiveHtml, /type="module" src="\/__wd\/runtime\.js"/);
  assert.equal(fs.existsSync(path.join(reactiveRoot, "dist/__wd/runtime.js")), true);

  const staticRoot = fixture();
  write(staticRoot, "site/pages/index.wd", "# Static\n\nPlain copy.");
  buildSite(staticRoot);
  const staticManifest = JSON.parse(fs.readFileSync(path.join(staticRoot, "dist/routes.json"), "utf8"));
  const staticHtml = fs.readFileSync(path.join(staticRoot, "dist/index.html"), "utf8");
  assert.deepEqual(staticManifest[0].assets.scripts, []);
  assert.doesNotMatch(staticHtml, /\/__wd\/runtime\.js/);
});

test("reactive includes make the parent page reactive", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /counter.wd");
  write(root, "site/_/counter.wd", [
    ":state count = 0",
    "Count: { count }",
    ":button \"Increment\" -> count++"
  ].join("\n"));

  const result = buildSite(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));
  assert.equal(result.routes.length, 1);
  assert.equal(manifest[0].assets.runtime, true);
  assert.deepEqual(manifest[0].assets.scripts, ["/__wd/runtime.js"]);
});

test("inline bindings gate the runtime but inline code does not", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "Hello { name }\n\n`{ example }`");
  buildSite(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/routes.json"), "utf8"));
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.equal(manifest[0].assets.runtime, true);
  assert.deepEqual(manifest[0].assets.scripts, ["/__wd/runtime.js"]);
  assert.match(html, /Hello <span data-wd-bind="name"><\/span>/);
  assert.match(html, /<code>\{ example \}<\/code>/);

  const staticRoot = fixture();
  write(staticRoot, "site/pages/index.wd", "`{ example }`");
  buildSite(staticRoot);
  const staticManifest = JSON.parse(fs.readFileSync(path.join(staticRoot, "dist/routes.json"), "utf8"));
  assert.equal(staticManifest[0].assets.runtime, false);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-compiler-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
