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

test("static container classes are unchanged by the reactive-class feature", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "::: card .product .featured\nHi\n:::");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<div class="card product featured">/);
  assert.doesNotMatch(page.html, /data-wd-class/);
  assert.equal(page.assets.runtime, false);
});

test(".class when <state> emits a global data-wd-class binding", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state hot = false",
    "::: card .sale when hot",
    "Deal",
    ":::"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-class="\[\[&quot;sale&quot;,&quot;\(S\(\\&quot;hot\\&quot;\)\)&quot;\]\]"/);
});

test(".class when <item.field> inside a reactive loop emits data-wd-each-class", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state products = [{\"id\":1,\"name\":\"A\",\"onSale\":true}]",
    "@loop products into p",
    "::: card .sale when p.onSale",
    "{ p.name }",
    ":::",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-each-class=/);
  assert.match(page.html, /I\(\\&quot;onSale\\&quot;\)/);
});

test(".class when <static value> folds at build time (no binding emitted)", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /card.wd with vip=true");
  write(root, "site/_/card.wd", "::: card .gold when vip\nHi\n:::");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<div class="card gold">/);
  assert.doesNotMatch(page.html, /data-wd-class/);
  assert.equal(page.assets.runtime, false);
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

test("reactive :else if chain desugars to nested data-wd-if regions", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state isPro = false",
    ":state isTrial = false",
    ":if isPro",
    "Pro plan",
    ":else if isTrial",
    "Trial plan",
    ":else",
    "Free plan",
    ":endif"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  // The chain compiles to two nested data-wd-if regions the runtime already drives.
  assert.match(page.html, /data-wd-if="isPro"/);
  assert.match(page.html, /data-wd-if="isTrial"/);
  // The second condition lives inside the first's falsy template (the desugar).
  assert.match(page.html, /<template data-wd-false><div data-wd-if="isTrial"/);
  // Initial active leaf is the bare :else branch (both flags false).
  assert.match(page.html, /<p>Free plan<\/p>/);
});

test("static :else if chain selects the matching branch at build time", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /tier.wd with isPro=false isTrial=true");
  write(root, "site/_/tier.wd", [
    ":if isPro",
    "Pro plan",
    ":else if isTrial",
    "Trial plan",
    ":else",
    "Free plan",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Trial plan/);
  assert.doesNotMatch(page.html, /Pro plan/);
  assert.doesNotMatch(page.html, /Free plan/);
  assert.equal(page.assets.runtime, false);
});

test(":else if after a bare :else is a compile error", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state open = false",
    ":if open",
    "A",
    ":else",
    "B",
    ":else if open",
    "C",
    ":endif"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /":else if" after ":else"/
  );
});

test(":if with a comparison emits a predicate-driven region with the right initial branch", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":state n = 3",
    ":if n > 5",
    "Big",
    ":else",
    "Small",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-if-expr="[^"]*S\(&quot;n&quot;\) &gt; 5/);
  // n=3 → false branch is the initial active one.
  assert.match(page.html, /data-wd-if-active="false"/);
  assert.match(page.html, /<div data-wd-if-out><p>Small<\/p><\/div>/);
});

test(":if supports ==, and/or, and not over state", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state plan = "pro"',
    ":state banned = false",
    ':if plan == "pro" and not banned',
    "Welcome",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-if-expr=/);
  // == comparison, && join, and a negated operand.
  assert.match(page.html, /S\(&quot;plan&quot;\) == &quot;pro&quot;/);
  assert.match(page.html, /&amp;&amp;/);
  assert.match(page.html, /!\(S\(&quot;banned&quot;\)\)/);
  // plan=="pro" && !false → true → Welcome is the initial branch.
  assert.match(page.html, /data-wd-if-active="true"/);
});

test(":if comparison over only static/literal values folds at build (no runtime)", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ":if 2 > 1",
    "Always",
    ":else",
    "Never",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Always/);
  assert.doesNotMatch(page.html, /Never/);
  assert.doesNotMatch(page.html, /data-wd-if/);
  assert.equal(page.assets.runtime, false);
});

test(":if comparison over a loop item emits a per-row each-if predicate", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state products = [{"id":1,"name":"A","price":90}]',
    "@loop products into p",
    ":if p.price > 50",
    "pricey",
    ":else",
    "cheap",
    ":endif",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<span data-wd-each-if data-wd-if-expr="[^"]*I\(&quot;price&quot;\) &gt; 50/);
});

test(":else if chain with comparisons selects the matching branch statically", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /tier.wd with score=85");
  write(root, "site/_/tier.wd", [
    ":if score >= 90",
    "GradeAlpha",
    ":else if score >= 80",
    "GradeBeta",
    ":else",
    "GradeGamma",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /GradeBeta/);
  assert.doesNotMatch(page.html, /GradeAlpha/);
  assert.doesNotMatch(page.html, /GradeGamma/);
  assert.equal(page.assets.runtime, false);
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

test("page-colocated assets copy to dist; routes and skin/js do not double-emit", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home\n\n![logo](/logo.svg)");
  write(root, "site/pages/index.skin", "tokens\n  ink #111\npage\n  color $ink");
  write(root, "site/pages/index.js", "document.body.dataset.ready = 'true';");
  write(root, "site/pages/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  write(root, "site/pages/blog/index.wd", "# Blog");
  write(root, "site/pages/blog/cover.png", "PNGDATA");
  write(root, "site/pages/fonts/Inter.woff2", "FONTDATA");

  buildSite(root);

  // Page assets land at their path under dist.
  assert.equal(fs.existsSync(path.join(root, "dist/logo.svg")), true);
  assert.equal(fs.readFileSync(path.join(root, "dist/blog/cover.png"), "utf8"), "PNGDATA");
  assert.equal(fs.readFileSync(path.join(root, "dist/fonts/Inter.woff2"), "utf8"), "FONTDATA");

  // Routes are not copied verbatim; the colocated skin compiles to .css (not a raw .skin),
  // and the page script is the compiler's domain — neither is double-emitted as a raw asset.
  assert.equal(fs.existsSync(path.join(root, "dist/index.wd")), false);
  assert.equal(fs.existsSync(path.join(root, "dist/blog/index.wd")), false);
  assert.equal(fs.existsSync(path.join(root, "dist/index.skin")), false);
});

test("page-colocated private and symlinked assets do not copy to dist", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/.env", "SECRET=1");
  write(root, "site/pages/_private/secret.txt", "private");
  write(root, "site/pages/-draft/notes.txt", "draft");
  write(root, "outside-secret.txt", "outside");
  fs.symlinkSync(path.join(root, "outside-secret.txt"), path.join(root, "site/pages/link-secret.txt"));

  buildSite(root);

  assert.equal(fs.existsSync(path.join(root, "dist/.env")), false);
  assert.equal(fs.existsSync(path.join(root, "dist/_private/secret.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "dist/-draft/notes.txt")), false);
  assert.equal(fs.existsSync(path.join(root, "dist/link-secret.txt")), false);
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

test("image frontmatter emits og:image and a large social card", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "---",
    "title: Share me",
    "description: A social card test",
    "image: https://example.com/og.png",
    "---",
    "",
    "# Hello"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<meta property="og:image" content="https:\/\/example\.com\/og\.png">/);
  assert.match(page.html, /<meta name="twitter:image" content="https:\/\/example\.com\/og\.png">/);
  assert.match(page.html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(page.html, /<meta property="og:title" content="Share me">/);
});

test("a page without an image keeps the summary card and emits no og:image", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "title: Plain", "description: No image", "---", "", "# Hi"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.doesNotMatch(page.html, /og:image/);
  assert.match(page.html, /<meta name="twitter:card" content="summary">/);
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
// parseAction — expanded action vocabulary + dotted targets + ;-sequences
// ---------------------------------------------------------------------------

function compileWd(lines) {
  const root = fixture();
  write(root, "site/pages/index.wd", lines.join("\n"));
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

function compileWdThrows(lines, re) {
  const root = fixture();
  write(root, "site/pages/index.wd", lines.join("\n"));
  assert.throws(() => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)), re);
}

test("parseAction compiles the full new vocabulary to the right ops", () => {
  const page = compileWd([
    ":state n = 10",
    ":state flag = false",
    ":state list = []",
    ":state obj = {}",
    ':button "Sub" -> n -= 3',
    ':button "Toggle" -> flag toggle',
    ':button "Prepend" -> list prepend "a"',
    ':button "Member" -> list toggle "x"',
    ':button "RemoveVal" -> list remove "x"',
    ':button "ClearList" -> list clear',
    ':button "Merge" -> obj merge {"a": 1}',
    ':button "Delete" -> obj delete "a"',
    ':button "Reset" -> n reset'
  ]);
  assert.match(page.html, /data-wd-action="sub" data-wd-target="n" data-wd-value="3"/);
  assert.match(page.html, /data-wd-action="toggle" data-wd-target="flag"/);
  assert.match(page.html, /data-wd-action="prepend" data-wd-target="list" data-wd-value="&quot;a&quot;"/);
  assert.match(page.html, /data-wd-action="member-toggle" data-wd-target="list" data-wd-value="&quot;x&quot;"/);
  assert.match(page.html, /data-wd-action="remove-value" data-wd-target="list" data-wd-value="&quot;x&quot;"/);
  assert.match(page.html, /data-wd-action="clear" data-wd-target="list"/);
  assert.match(page.html, /data-wd-action="merge" data-wd-target="obj" data-wd-value="\{&quot;a&quot;:1\}"/);
  assert.match(page.html, /data-wd-action="delete" data-wd-target="obj" data-wd-value="&quot;a&quot;"/);
  assert.match(page.html, /data-wd-action="reset" data-wd-target="n"/);
});

test("parseAction accepts dotted targets for inc and set", () => {
  const page = compileWd([
    ':state cart = {"count": 0}',
    ':state user = {"name": ""}',
    ':button "Inc" -> cart.count++',
    ':button "Name" -> user.name = "x"'
  ]);
  assert.match(page.html, /data-wd-action="inc" data-wd-target="cart.count"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="user.name" data-wd-value="&quot;x&quot;"/);
});

test("parseAction merge accepts a state-key operand", () => {
  const page = compileWd([
    ':state a = {}',
    ':state b = {"x": 1}',
    ':button "Merge" -> a merge b'
  ]);
  assert.match(page.html, /data-wd-action="merge" data-wd-target="a" data-wd-value="&quot;b&quot;"/);
});

test("parseAction parses a ;-separated sequence into an ordered data-wd-actions array", () => {
  const page = compileWd([
    ":state cart = []",
    ":state count = 0",
    ':button "AddBoth" -> cart append "item"; count++'
  ]);
  assert.match(page.html, /data-wd-actions=/);
  const m = page.html.match(/data-wd-actions="([^"]+)"/);
  assert.ok(m, "emits a data-wd-actions attribute");
  const seq = JSON.parse(m[1].replace(/&quot;/g, '"'));
  assert.deepEqual(seq, [
    { op: "append", target: "cart", value: "item" },
    { op: "inc", target: "count" }
  ]);
});

test("parseAction rejects a dotted target with a poison segment, naming Use:", () => {
  compileWdThrows([
    ":state obj = {}",
    ':button "Bad" -> obj.__proto__.x = 1'
  ], /not allowed[\s\S]*Use:/);
});

test("parseAction rejects an unparseable operand with a Use: suggestion", () => {
  compileWdThrows([
    ":state n = 0",
    ':button "Bad" -> n -= notanumber'
  ], /Use:/);
});

test("parseAction reset/toggle/clear validate that the target is declared state", () => {
  compileWdThrows([':button "Bad" -> ghost reset'], /unknown state "ghost"[\s\S]*Declare it first/);
  compileWdThrows([':button "Bad" -> ghost toggle'], /unknown state "ghost"[\s\S]*Declare it first/);
});

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
  assert.match(page.html, /<input type="text" name="name" placeholder="Your name" required aria-label="Your name">/);
  assert.match(page.html, /<input type="email" name="email" aria-label="Email">/);
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

// ---------------------------------------------------------------------------
// :store — durable, page-global, cross-tab state
// ---------------------------------------------------------------------------

test(":store declares a global store, emits a store script, and turns the page reactive", () => {
  const page = compileWd([
    ":store cart = []",
    "{ cart.length } items"
  ]);
  assert.match(page.html, /<script type="application\/json" data-wd-store="cart">\[\]<\/script>/);
  assert.match(page.html, /<span data-wd-bind="cart" data-wd-path="length">0<\/span>/);
  assert.equal(page.assets.runtime, true);
});

test(":store ephemeral adds the ephemeral marker and still seeds the value", () => {
  const page = compileWd([
    ":store draft = 1 ephemeral"
  ]);
  assert.match(page.html, /<script type="application\/json" data-wd-store="draft" data-wd-store-ephemeral>1<\/script>/);
});

test(":store keys resolve in interpolation, :if, @loop, and actions", () => {
  const page = compileWd([
    ':store cart = [{"id": 1, "title": "One"}]',
    "{ cart.length }",
    ":if cart",
    "Has cart",
    ":endif",
    "@loop cart into item",
    "- { item.title }",
    "@endloop",
    ':button "Clear" -> cart clear'
  ]);
  assert.match(page.html, /data-wd-bind="cart" data-wd-path="length"/);
  assert.match(page.html, /data-wd-if="cart"/);
  assert.match(page.html, /data-wd-loop="cart"/);
  assert.match(page.html, /data-wd-action="clear" data-wd-target="cart"/);
});

test(":store stays page-global (bare name) even inside a section", () => {
  const page = compileWd([
    "::: section #shop",
    ":store cart = []",
    "{ cart.length }",
    ":::"
  ]);
  assert.match(page.html, /data-wd-store="cart"/);
  assert.doesNotMatch(page.html, /data-wd-store="shop:cart"/);
  assert.match(page.html, /data-wd-bind="cart" data-wd-path="length"/);
});

test(":store rejects a duplicate declaration with a Use: suggestion", () => {
  compileWdThrows([
    ":store cart = []",
    ":store cart = {}"
  ], /declared twice[\s\S]*Use: :store name = value/);
});

test(":store and :state declaring the same name collide with a Use: suggestion", () => {
  compileWdThrows([
    ":store cart = []",
    ":state cart = 0"
  ], /collides[\s\S]*Use: :store name = value/);
  compileWdThrows([
    ":state cart = 0",
    ":store cart = []"
  ], /collides[\s\S]*Use: :store name = value/);
});

test(":store rejects an invalid name with a Use: suggestion", () => {
  compileWdThrows([
    ":store 9bad = []"
  ], /Use: :store name = value/);
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

test("nested :if over loop items renders the inner branch inside the outer", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state team = [{"id": 1, "name": "A", "lead": true, "online": true}, {"id": 2, "name": "B", "lead": true, "online": false}]',
    "",
    "@loop team into member",
    "::: card",
    ":if member.lead",
    ":if member.online",
    "Lead online",
    ":else",
    "Lead away",
    ":endif",
    ":else",
    "Crew",
    ":endif",
    ":::",
    "@endloop"
  ].join("\n"));

  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // Outer region wraps an inner region inside its true template.
  assert.match(page.html, /data-wd-each-if data-wd-path="lead"/);
  assert.match(page.html, /data-wd-each-if data-wd-path="online"/);
  // Templates stay pristine (markers, not resolved values) for runtime toggling.
  assert.match(page.html, /<template data-wd-if-true><p>Lead online<\/p><\/template>/);
  // Row 1 (lead + online): outer out shows the inner region resolved to "Lead online".
  const first = page.html.match(/data-wd-loop-key="1"[\s\S]*?data-wd-loop-key="2"/)[0];
  assert.match(first, /Lead online/);
  assert.doesNotMatch(first.match(/data-wd-each-if-out>([\s\S]*?)<\/span><\/span>/)[1], /Crew/);
  // Row 2 (lead + offline): inner resolves to "Lead away".
  const second = page.html.split('data-wd-loop-key="2"')[1];
  assert.match(second, /Lead away/);
  assert.doesNotMatch(second, /Lead online<\/p><\/span><span data-wd-each-if-out>/);
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

test("view transitions: transitions:true emits the cross-document @view-transition rule", () => {
  // Re-enabled as a per-page opt-in. The earlier pull-back was a cross-document
  // @view-transition render-blocking regression; verified resolved on modern
  // Chrome (CSS-only, same-origin, graceful no-support fallback, no nav hang).
  // Default-off and `transitions: false` are covered in tests/view-transitions.test.js.
  const root = fixture();
  write(root, "site/pages/index.wd", "---\ntitle: Home\ntransitions: true\n---\n\n# Home");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<style>@view-transition \{ navigation: auto; \}<\/style>/);
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

test(":fetch and round-trip :form auto-declare their _error keys for display", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch team from "/__wd/data/team.json"',
    "",
    ":if team_error",
    "Fetch failed: { team_error }",
    ":endif",
    "",
    ':form action="/api/x" into reply',
    ":input a",
    ':submit "Go"',
    ":endform",
    "",
    ":if reply_error",
    "Submit failed: { reply_error }",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-if="team_error"/);
  assert.match(page.html, /data-wd-bind="team_error"/);
  assert.match(page.html, /data-wd-if="reply_error"/);
  assert.match(page.html, /data-wd-bind="reply_error"/);
});

// ---------------------------------------------------------------------------
// Stage 5: fetch lifecycle — loading/empty, options, dynamic URL, refetch
// ---------------------------------------------------------------------------

test(":fetch auto-declares four lifecycle state keys (value/error/loading/empty)", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch team from "/x.json"',
    "",
    ":if team_loading",
    "Loading…",
    ":endif",
    ":if team_empty",
    "Nothing here.",
    ":endif"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // Seeds: value null, error null, loading false, empty false (all four seeded
  // into one state script so the lifecycle regions resolve before the fetch).
  assert.match(page.html, /data-wd-state>\{"team":null,"team_error":null,"team_loading":false,"team_empty":false\}/);
  // The reactive regions resolve the auto-declared keys.
  assert.match(page.html, /data-wd-if="team_loading"/);
  assert.match(page.html, /data-wd-if="team_empty"/);
});

test(":fetch keyword args emit url/method/when/timeout/retry/headers/body/deps", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state hdrs = {}',
    ':state payload = {}',
    ':fetch save from "/api/save" method=POST timeout=4000 retry=2 when=visible headers=hdrs body=payload'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-fetch-key="save"/);
  assert.match(page.html, /data-wd-fetch-url="\/api\/save"/);
  assert.match(page.html, /data-wd-fetch-method="POST"/);
  assert.match(page.html, /data-wd-fetch-when="visible"/);
  assert.match(page.html, /data-wd-fetch-timeout="4000"/);
  assert.match(page.html, /data-wd-fetch-retry="2"/);
  assert.match(page.html, /data-wd-fetch-headers="hdrs"/);
  assert.match(page.html, /data-wd-fetch-body="payload"/);
});

test(":fetch extracts { } URL interpolation deps into data-wd-fetch-deps", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state userId = 1',
    ':fetch user from "/u/{ userId }"'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // URL retains the interpolation marker for the runtime to fill in.
  assert.match(page.html, /data-wd-fetch-url="\/u\/\{ userId \}"/);
  assert.match(page.html, /data-wd-fetch-deps="userId"/);
});

test(":fetch with a plain URL emits no deps attribute", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ':fetch team from "/x.json"');
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.doesNotMatch(page.html, /data-wd-fetch-deps=/);
});

test(":fetch rejects unknown options with a corrective Use: hint", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ':fetch team from "/x.json" bogus=1');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Use: :fetch name from "url" \[method=…\] \[timeout=ms\] \[retry=N\] \[when=visible\] \[headers=key\] \[body=key\]/
  );
});

test(":fetch rejects an invalid method", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ':fetch team from "/x.json" method=FETCH');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /method/
  );
});

test(":fetch rejects a non-integer timeout/retry", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ':fetch team from "/x.json" timeout=soon');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /timeout/
  );
});

test(":fetch URL deps reject prototype-pollution path segments", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ':fetch x from "/y/{ __proto__.polluted }"');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /not allowed/
  );
});

test(":fetch allows relative, http(s), and leading-interpolation URLs", () => {
  for (const url of ["/__wd/data/team.json", "./local.json", "../up.json", "api/data.json", "https://api.example.com/v1/x", "http://localhost:3000/x", "{ apiBase }/users", "/u/{ id }"]) {
    const root = fixture();
    write(root, "site/pages/index.wd", `:state apiBase = ""\n:state id = "1"\n:fetch x from "${url}"`);
    const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
    assert.match(page.html, /data-wd-fetch-url=/, `expected ${url} to compile`);
  }
});

test(":fetch rejects protocol-relative and non-http(s) scheme URLs", () => {
  for (const [url, re] of [
    ['//evil.example.com/x', /Protocol-relative/],
    ['file:///etc/passwd', /"file:" scheme is not allowed/],
    ['data:text/html,<script>', /"data:" scheme is not allowed/],
    ['javascript:alert(1)', /"javascript:" scheme is not allowed/]
  ]) {
    const root = fixture();
    write(root, "site/pages/bad.wd", `:fetch x from "${url}"`);
    assert.throws(
      () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
      re,
      `expected ${url} to be rejected`
    );
  }
});

test(":fetch refresh= emits the refresh and headers attributes", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':store session = { "Authorization": "Bearer x" }',
    ':fetch feed from "/api/feed" headers=session refresh="/auth/refresh"'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-fetch-headers="session"/);
  assert.match(page.html, /data-wd-fetch-refresh="\/auth\/refresh"/);
});

test(":fetch refresh= requires headers=", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ':fetch feed from "/api/feed" refresh="/auth/refresh"');
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /refresh= needs headers=/
  );
});

test(":fetch refresh= validates the URL scheme", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", [
    ':store session = { "Authorization": "Bearer x" }',
    ':fetch feed from "/api/feed" headers=session refresh="javascript:alert(1)"'
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /"javascript:" scheme is not allowed/
  );
});

test(":effect emits a zero-output marker with watch + actions", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state q = ""',
    ":state hits = 0",
    ":effect q -> hits++"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /<script type="application\/json" data-wd-effect>/);
  assert.match(page.html, /"watch":"q"/);
  assert.match(page.html, /"op":"inc"/);
  assert.match(page.html, /"target":"hits"/);
});

test(":effect supports ;-chained actions", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state q = ""',
    ":state a = 0",
    ":state b = 0",
    ":effect q -> a++; b++"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /"actions":\[\{"op":"inc","target":"a"\},\{"op":"inc","target":"b"\}\]/);
});

test(":effect over unknown state throws with guidance", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ":state x = 0\n:effect ghost -> x++");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /watches unknown state "ghost"/
  );
});

test(":effect malformed throws with a Use hint", () => {
  const root = fixture();
  write(root, "site/pages/bad.wd", ":state q = 0\n:effect q");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/bad.wd"), createPaths(root)),
    /Malformed :effect[\s\S]*Use: :effect/
  );
});

test("button -> name refetch parses to a refetch action op", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch team from "/x.json"',
    ':button "Reload" -> team refetch'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-action="refetch"/);
  assert.match(page.html, /data-wd-target="team"/);
});

test("@loop over a dotted fetched source resolves end to end", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':fetch payload from "/x.json"',
    "",
    "@loop payload.items into row",
    "- { row.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-loop="payload\.items"/);
  assert.match(page.html, /data-wd-each data-wd-path="name"/);
});
