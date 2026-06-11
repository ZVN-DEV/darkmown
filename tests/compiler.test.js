import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Formats: .md strict, .wd full
// ---------------------------------------------------------------------------

test("plain .md renders CommonMark and keeps directives inert", () => {
  const root = fixture();
  write(root, "site/pages/index.md", [
    "# Title",
    "",
    "1. ordered",
    "2. list",
    "",
    "> quoted",
    "",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "![logo](/logo.svg)",
    "",
    ":state count = 0",
    "",
    "Braces stay literal: { count }",
    "",
    "@include /nav.wd"
  ].join("\n"));
  write(root, "site/_/nav.wd", "<nav>never included</nav>");

  const page = compilePage(path.join(root, "site/pages/index.md"), createPaths(root));
  assert.match(page.html, /<ol>/);
  assert.match(page.html, /<blockquote>/);
  assert.match(page.html, /<table>/);
  assert.match(page.html, /<img src="\/logo.svg" alt="logo">/);
  assert.match(page.html, /:state count = 0/);
  assert.match(page.html, /\{ count \}/);
  assert.match(page.html, /@include \/nav\.wd/);
  assert.doesNotMatch(page.html, /never included/);
  assert.doesNotMatch(page.html, /data-wd/);
  assert.equal(page.assets.runtime, false);
  assert.equal(page.warnings.some((w) => w.includes("rename the file to .wd")), true);
});

test(".wd renders full CommonMark too", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "## Heading",
    "",
    "1. one",
    "2. two",
    "",
    "> quote",
    "",
    "*emphasis* and ![img](/x.png)"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<ol>/);
  assert.match(page.html, /<blockquote>/);
  assert.match(page.html, /<em>emphasis<\/em>/);
  assert.match(page.html, /<img src="\/x.png" alt="img">/);
});

test("mdx files are not includable or routable formats", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /frag.mdx");
  write(root, "site/_/frag.mdx", "# Nope");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Could not resolve include/
  );
});

// ---------------------------------------------------------------------------
// Includes
// ---------------------------------------------------------------------------

test("includes resolve relatively and from the include shelf across md/wd", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "---",
    "title: Home",
    "---",
    "@include ./local.md",
    "@include /shared.wd"
  ].join("\n"));
  write(root, "site/pages/local.md", "## Local");
  write(root, "site/_/shared.wd", "## Shared");

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<h2>Local<\/h2>/);
  assert.match(page.html, /<h2>Shared<\/h2>/);
});

test("include arguments pass literals and in-scope values, and unify on { name }", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /card.wd with title=\"Hello\" count=3");
  write(root, "site/_/card.wd", "**{ title }** ({ count })");

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<strong>Hello<\/strong> \(3\)/);

  write(root, "site/pages/nested.wd", [
    "@loop /rows.json into row",
    "@include /card.wd with title={ row.name } count={ row.n }",
    "@endloop"
  ].join("\n"));
  write(root, "site/_/rows.json", JSON.stringify([{ name: "A", n: 1 }, { name: "B", n: 2 }]));
  const nested = compilePage(path.join(root, "site/pages/nested.wd"), createPaths(root));
  assert.match(nested.html, /<strong>A<\/strong> \(1\)/);
  assert.match(nested.html, /<strong>B<\/strong> \(2\)/);
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

// ---------------------------------------------------------------------------
// @loop
// ---------------------------------------------------------------------------

test("@loop unrolls JSON data statically and includes inherit the loop value", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "@loop /cards.json into card",
    "@include /card.wd",
    "@endloop"
  ].join("\n"));
  write(root, "site/_/card.wd", "**{ card.title }**");
  write(root, "site/_/cards.json", JSON.stringify([{ title: "One" }, { title: "Two" }]));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<strong>One<\/strong>/);
  assert.match(page.html, /<strong>Two<\/strong>/);
  assert.equal(page.assets.runtime, false);
});

test("@loop nests and inner loops see outer values", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "@loop /teams.json into team",
    "## { team.name }",
    "@loop team.members into member",
    "- { member } of { team.name }",
    "@endloop",
    "@endloop"
  ].join("\n"));
  write(root, "site/_/teams.json", JSON.stringify([
    { name: "Alpha", members: ["Ann"] },
    { name: "Beta", members: ["Bob", "Bea"] }
  ]));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<h2>Alpha<\/h2>/);
  assert.match(page.html, /Ann of Alpha/);
  assert.match(page.html, /Bob of Beta/);
  assert.match(page.html, /Bea of Beta/);
  assert.equal(page.assets.runtime, false);
});

test("@loop over :state compiles a keyed reactive region with dotted bindings", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state todos = [{"id": 1, "title": "One"}, {"id": 2, "title": "Two"}]',
    "",
    "@loop todos into todo",
    "- { todo.title }",
    "@endloop",
    "",
    ':button "Add" -> todos += {"id": 3, "title": "Three"}'
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-loop="todos"/);
  assert.match(page.html, /<template data-wd-loop-template><li><span data-wd-each data-wd-path="title"><\/span><\/li><\/template>/);
  assert.match(page.html, /<ul data-wd-loop-out>/);
  assert.match(page.html, /<li data-wd-loop-key="1"><span data-wd-each data-wd-path="title">One<\/span><\/li>/);
  assert.match(page.html, /<li data-wd-loop-key="2"><span data-wd-each data-wd-path="title">Two<\/span><\/li>/);
  assert.match(page.html, /data-wd-action="append" data-wd-target="todos"/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test("@loop over scalar :state lists binds whole items", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state items = ["a", "b"]',
    "@loop items into item",
    "- { item }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li data-wd-loop-key="a"><span data-wd-each>a<\/span><\/li>/);
  assert.match(page.html, /<li data-wd-loop-key="b"><span data-wd-each>b<\/span><\/li>/);
});

test("@loop failure modes are friendly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "@loop missing into item",
    "- { item }",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /@loop source "missing"/
  );

  write(root, "site/pages/unterminated.wd", [
    "@loop /rows.json into row",
    "- { row }"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/unterminated.wd"), createPaths(root)),
    /Missing @endloop/
  );

  write(root, "site/pages/old-repeat.wd", "@repeat /card.wd from /cards.json");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/old-repeat.wd"), createPaths(root)),
    /@repeat was replaced by @loop/
  );

  write(root, "site/pages/old-for.wd", ":for item in items");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/old-for.wd"), createPaths(root)),
    /:for was replaced by @loop/
  );
});

test("@loop syntax inside code fences stays literal", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "```wd",
    "@loop /cards.json into card",
    "@include /card.wd",
    "@endloop",
    "```"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /@loop \/cards\.json into card/);
  assert.equal(page.assets.runtime, false);
});

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

test("unknown { names } stay literal and never pull in the runtime", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "Hello { name } and { a.b.c }");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Hello \{ name \} and \{ a\.b\.c \}/);
  assert.equal(page.assets.runtime, false);
});

test("declared state binds inline with initial value, and code spans stay code", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    "Count: { count }",
    "`{ count }` stays code.",
    ":button \"Increment\" -> count++"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<script type="application\/json" data-wd-state>\{"count":0\}<\/script>/);
  assert.match(page.html, /Count: <span data-wd-bind="count">0<\/span>/);
  assert.match(page.html, /<code>\{ count \}<\/code> stays code/);
  assert.match(page.html, /<button type="button" data-wd-action="inc" data-wd-target="count">Increment<\/button>/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test("dotted state bindings resolve initial values through paths", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state user = {"name": "Kirby", "org": {"label": "ZVN"}}',
    "Hi { user.name } from { user.org.label }"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<span data-wd-bind="user" data-wd-path="name">Kirby<\/span>/);
  assert.match(page.html, /<span data-wd-bind="user" data-wd-path="org.label">ZVN<\/span>/);
});

// ---------------------------------------------------------------------------
// Sections + scoped state
// ---------------------------------------------------------------------------

test("sections scope state so two sections can own the same name", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "::: section #left .card",
    ":state tally = 0",
    "Left { tally }",
    ':button "Bump" -> tally++',
    ":::",
    "",
    "::: section #right",
    ":state tally = 10",
    "Right { tally }",
    ':button "Bump" -> tally++',
    ":::"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<section id="left" class="card">/);
  assert.match(page.html, /<section id="right">/);
  assert.match(page.html, /data-wd-state>\{"left:tally":0\}/);
  assert.match(page.html, /data-wd-state>\{"right:tally":10\}/);
  assert.match(page.html, /<span data-wd-bind="left:tally">0<\/span>/);
  assert.match(page.html, /<span data-wd-bind="right:tally">10<\/span>/);
  assert.match(page.html, /data-wd-action="inc" data-wd-target="left:tally"/);
  assert.match(page.html, /data-wd-action="inc" data-wd-target="right:tally"/);
});

test("inner sections read outer state through the scope chain", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state global = 5",
    "::: section #outer",
    "Sees { global }",
    "::: card #inner",
    "Still sees { global }",
    ":::",
    ":::"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<div id="inner" class="card">/);
  assert.match(page.html, /Sees <span data-wd-bind="global">5<\/span>/);
  assert.match(page.html, /Still sees <span data-wd-bind="global">5<\/span>/);
});

test("unclosed and stray containers fail clearly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "::: section #a\ncontent");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Missing closing :::/
  );

  write(root, "site/pages/stray.wd", "content\n:::");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/stray.wd"), createPaths(root)),
    /Stray ::: close/
  );
});

// ---------------------------------------------------------------------------
// Conditionals
// ---------------------------------------------------------------------------

test("reactive conditionals render initial branch and emit runtime templates", () => {
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
  assert.match(page.html, /<div data-wd-if-out><p>Closed branch<\/p><\/div>/);
  assert.match(page.html, /<template data-wd-true><p>Open branch<\/p><\/template>/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="open" data-wd-value="true"/);
});

test("static :if over in-scope values resolves at compile time", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /banner.wd with pro=true");
  write(root, "site/_/banner.wd", [
    ":if pro",
    "Pro plan",
    ":else",
    "Free plan",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Pro plan/);
  assert.doesNotMatch(page.html, /Free plan/);
  assert.equal(page.assets.runtime, false);
});

test(":if over undeclared names fails with guidance", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ":if mystery\nYes\n:endif");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /does not match a :state or in-scope value/
  );
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

test("button actions reject arbitrary JavaScript and unknown state at compile time", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state count = 0",
    ":button \"Bad\" -> fetch('/api')"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported button action/
  );

  write(root, "site/pages/unknown.wd", ":button \"Bad\" -> ghost++");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/unknown.wd"), createPaths(root)),
    /unknown state "ghost"/
  );

  write(root, "site/pages/literal.wd", [
    ":state count = 0",
    ":button \"Bad\" -> count = fetch('/api')"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/literal.wd"), createPaths(root)),
    /Unsupported action literal/
  );

  write(root, "site/pages/call.wd", [
    ":state items = []",
    ":button \"Bad\" -> items.push(fetch(\"/api\"))"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/call.wd"), createPaths(root)),
    /Unsupported button action/
  );
});

// ---------------------------------------------------------------------------
// Build output
// ---------------------------------------------------------------------------

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

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-compiler-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// ---------------------------------------------------------------------------
// Stage 3: fetch, forms, persistence, loop-item conditionals
// ---------------------------------------------------------------------------

test(":fetch declares state, emits a fetch script, and powers reactive regions", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch team from "/__wd/data/team.json"',
    "",
    ":if team",
    "@loop team into member",
    "- { member.name }",
    "@endloop",
    ":else",
    "Loading…",
    ":endif"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<span data-wd-fetch data-wd-fetch-key="team" data-wd-fetch-url="\/__wd\/data\/team\.json"><\/span>/);
  assert.match(page.html, /data-wd-if="team"/);
  assert.match(page.html, /data-wd-loop="team"/);
  assert.match(page.html, /Loading…/);
  assert.match(page.html, /\/__wd\/runtime\.js/);
});

test(":form into declares state and emits a captured form; action mode stays native", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":form into profile",
    ":input name placeholder=\"Your name\" required",
    ":input email type=email",
    ":submit \"Save\"",
    ":endform",
    "",
    ":if profile",
    "Hi { profile.name }",
    ":endif"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<form data-wd-form="profile">/);
  assert.match(page.html, /<input type="text" name="name" placeholder="Your name" required>/);
  assert.match(page.html, /<input type="email" name="email">/);
  assert.match(page.html, /<button type="submit">Save<\/button>/);
  assert.match(page.html, /data-wd-state>\{"profile":null\}/);
  assert.match(page.html, /data-wd-bind="profile" data-wd-path="name"/);

  const nativeRoot = fixture();
  write(nativeRoot, "site/pages/index.wd", [
    ":form action=\"/subscribe\"",
    ":input email type=email required",
    ":submit \"Subscribe\"",
    ":endform"
  ].join("\n"));
  const nativePage = compilePage(path.join(nativeRoot, "site/pages/index.wd"), createPaths(nativeRoot));
  assert.match(nativePage.html, /<form action="\/subscribe" method="post">/);
  assert.doesNotMatch(nativePage.html, /data-wd-form/);
  assert.equal(nativePage.assets.runtime, false);
});

test(":state persist marks the state script for localStorage", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "::: section #cart",
    ":state items = [] persist",
    "{ items.length } items",
    ":button \"Add\" -> items += {\"id\": 1}",
    ":::"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<script type="application\/json" data-wd-state data-wd-persist="cart:items">\{"cart:items":\[\]\}<\/script>/);
  assert.match(page.html, /data-wd-bind="cart:items" data-wd-path="length"/);
  assert.match(page.html, /data-wd-target="cart:items"/);
});

test(":if over loop items renders per-item branches at compile time", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state team = [{"id": 1, "name": "A", "lead": true}, {"id": 2, "name": "B", "lead": false}]',
    "",
    "@loop team into member",
    "::: card",
    "{ member.name }",
    ":if member.lead",
    "Lead",
    ":else",
    "Crew",
    ":endif",
    ":::",
    "@endloop"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-each-if data-wd-path="lead"/);
  assert.match(page.html, /<template data-wd-if-true><p>Lead<\/p><\/template>/);
  const first = page.html.match(/data-wd-loop-key="1"[\s\S]*?data-wd-loop-key="2"/)[0];
  assert.match(first, /<span data-wd-each-if-out><p>Lead<\/p><\/span>/);
  const second = page.html.split('data-wd-loop-key="2"')[1];
  assert.match(second, /<span data-wd-each-if-out><p>Crew<\/p><\/span>/);
});

test("auto-id containers omit the id attribute, explicit ids keep it", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "::: card",
    "Anonymous",
    ":::",
    "::: section #named",
    "Named",
    ":::"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<div class="card">/);
  assert.match(page.html, /<section id="named">/);
});

test("shelf json is published under /__wd/data for :fetch", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/_/team.json", JSON.stringify([{ id: 1 }]));
  buildSite(root);
  assert.equal(fs.existsSync(path.join(root, "dist/__wd/data/team.json")), true);
});

// ---------------------------------------------------------------------------
// Stage 4: view transitions, lazy fetch, computed state
// ---------------------------------------------------------------------------

test("transitions frontmatter emits the view-transition style, absent by default", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "---\ntitle: Home\ntransitions: true\n---\n\n# Home");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /@view-transition \{ navigation: auto; \}/);

  write(root, "site/pages/plain.wd", "# Plain");
  const plain = compilePage(path.join(root, "site/pages/plain.wd"), createPaths(root));
  assert.doesNotMatch(plain.html, /@view-transition/);
});

test(":fetch emits a marker span and when=visible is carried through", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch team from "/__wd/data/team.json"',
    ':fetch quotes from "/__wd/data/quotes.json" when=visible'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<span data-wd-fetch data-wd-fetch-key="team" data-wd-fetch-url="\/__wd\/data\/team\.json"><\/span>/);
  assert.match(page.html, /<span data-wd-fetch data-wd-fetch-key="quotes" data-wd-fetch-url="\/__wd\/data\/quotes\.json" data-wd-fetch-when="visible"><\/span>/);
});

test(":computed compiles a safe expression, seeds the initial value, and scopes to sections", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "::: section #cart",
    ':state items = [{"id": 1}, {"id": 2}] persist',
    ":computed total = items.length * 4 + 1",
    "Total ${ total }",
    ":::"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-computed-key="cart:total"/);
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;cart:items&quot;,&quot;length&quot;\) \* 4 \+ 1"/);
  assert.match(page.html, /<span data-wd-bind="cart:total">9<\/span>/);
});

test(":computed rejects unsafe expressions at compile time", () => {
  const root = fixture();
  write(root, "site/pages/unknown.wd", ":computed x = ghost * 2");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/unknown.wd"), createPaths(root)),
    /unknown state "ghost"/
  );

  write(root, "site/pages/assign.wd", [
    ":state a = 1",
    ":computed x = a = 2"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/assign.wd"), createPaths(root)),
    /Assignment is not allowed/
  );

  write(root, "site/pages/proto.wd", [
    ":state a = 1",
    ":computed x = a.constructor.constructor"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/proto.wd"), createPaths(root)),
    /not allowed in :computed/
  );

  write(root, "site/pages/chars.wd", [
    ":state a = 1",
    ":computed x = a; alert(1)"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/chars.wd"), createPaths(root)),
    /Unsupported syntax/
  );
});

// ---------------------------------------------------------------------------
// Stage 5: adapter round-trips and packaging
// ---------------------------------------------------------------------------

test(":form action + into emits a fetch round-trip form that degrades natively", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':form action="/api/subscribe" into reply',
    ":input email type=email required",
    ':submit "Subscribe"',
    ":endform",
    "",
    ":if reply",
    "Got { reply.status }",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<form data-wd-form="reply" action="\/api\/subscribe" method="post">/);
  assert.match(page.html, /data-wd-state>\{"reply":null\}/);
  assert.match(page.html, /\/__wd\/runtime\.js/);

  write(root, "site/pages/bad.wd", ':form bogus="x"\n:endform');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :form/
  );
});
