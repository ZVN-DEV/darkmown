import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Integration: full-pipeline behaviors and EVERY compile-error path not yet
// exercised by the existing suites. Each error assertion checks both that it
// throws and that the message is actionable (names the file and/or a Use: hint).
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-pipeline-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(lines, extra) {
  const root = fixture();
  if (extra) for (const [file, content] of Object.entries(extra)) write(root, file, content);
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

function compileThrows(lines, re, extra) {
  const root = fixture();
  if (extra) for (const [file, content] of Object.entries(extra)) write(root, file, content);
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  assert.throws(() => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)), re);
}

// --- Static vs reactive gating (the core invariant) -------------------------

test("a page with only prose + a static loop stays runtime:false", () => {
  const page = compile(["# Title", "@loop /rows.json into r", "- { r.name }", "@endloop"], {
    "site/_/rows.json": JSON.stringify([{ name: "x" }])
  });
  assert.equal(page.assets.runtime, false);
  assert.doesNotMatch(page.html, /data-wd/);
});

test("any :state declaration flips the page to runtime:true", () => {
  const page = compile([":state n = 0", "Value { n }"]);
  assert.equal(page.assets.runtime, true);
});

// --- :input full surface ----------------------------------------------------

test(":input emits type, attributes, and boolean flags", () => {
  const page = compile([
    ":form into f",
    ':input email type=email placeholder="you@x.com" required autofocus',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    page.html,
    /<input type="email" name="email" placeholder="you@x.com" required autofocus aria-label="you@x.com">/
  );
});

test(":input emits escaped accessibility attributes", () => {
  const page = compile([
    ":form into f",
    ':input email aria-label="Email <address> & contact" aria-describedby="email-help&more"',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(page.html, /aria-label="Email &lt;address&gt; &amp; contact"/);
  assert.match(page.html, /aria-describedby="email-help&amp;more"/);
});

test(":bind emits escaped accessibility attributes", () => {
  const page = compile([
    ':state query = ""',
    ':bind query placeholder="Search" aria-label="Search <site> & docs" aria-describedby="search-help&hint"'
  ]);
  assert.match(page.html, /data-wd-bind-input="query"/);
  assert.match(page.html, /aria-label="Search &lt;site&gt; &amp; docs"/);
  assert.match(page.html, /aria-describedby="search-help&amp;hint"/);
});

test(":input rejects an unknown attribute", () => {
  compileThrows(
    [":form into f", ':input email onfocus="evil()"', ":endform"],
    /Unknown :input attribute "onfocus"/
  );
});

test(":input rejects an unknown boolean flag", () => {
  compileThrows(
    [":form into f", ":input email sketchy", ":endform"],
    /Unknown :input flag "sketchy"/
  );
});

// --- :fetch error paths -----------------------------------------------------

test(":fetch with a malformed line throws with a Use: hint", () => {
  compileThrows(":fetch posts", /Malformed :fetch[\s\S]*Use: :fetch/);
});

test(":fetch when=visible carries the attribute through", () => {
  const page = compile(':fetch posts from "/__wd/data/posts.json" when=visible');
  assert.match(page.html, /data-wd-fetch-when="visible"/);
});

// --- :form error paths ------------------------------------------------------

test(":form with neither into nor action is rejected with all three forms shown", () => {
  // `:form method="post"` matches the directive but supplies neither a target
  // (into) nor a destination (action) → the corrective error lists all 3 forms.
  compileThrows(
    [':form method="post"', ":endform"],
    /Use ':form into name'[\s\S]*action[\s\S]*both/
  );
});

test(":form with leftover unknown tokens is rejected", () => {
  compileThrows([':form into f bogus="x"', ":endform"], /Malformed :form/);
});

test(":form action-only stays native (no runtime, no data-wd-form)", () => {
  const page = compile([
    ':form action="/subscribe" method="get"',
    ":input email type=email",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(page.html, /<form action="\/subscribe" method="get">/);
  assert.doesNotMatch(page.html, /data-wd-form/);
  assert.equal(page.assets.runtime, false);
});

test(":form action rejects unsafe URL schemes", () => {
  compileThrows(
    [':form action="javascript:alert(1)"', ':submit "Go"', ":endform"],
    /Unsafe :form action URL[\s\S]*javascript/
  );

  compileThrows(
    [':form action="//evil.example/collect" into reply', ':submit "Go"', ":endform"],
    /Protocol-relative URLs are not allowed/
  );
});

// --- :state error paths -----------------------------------------------------

test(":state declared twice in the same scope throws", () => {
  compileThrows([":state x = 1", ":state x = 2"], /declared twice in the same scope/);
});

test(":state inside a reactive @loop body is rejected", () => {
  compileThrows(
    [":state items = [1, 2]", "@loop items into item", ":state inner = 0", "@endloop"],
    /cannot be declared inside a reactive @loop/
  );
});

test(":state malformed (no value) throws", () => {
  compileThrows(":state x", /Malformed :state/);
});

// --- @include error paths ---------------------------------------------------

test("@include of a missing file throws a resolve error naming the spec", () => {
  compileThrows("@include /nope.wd", /Could not resolve include "\/nope\.wd"/);
});

test("@include argument referencing an out-of-scope value throws", () => {
  compileThrows(
    "@include /card.wd with title={ missing.value }",
    /does not match any value in scope/,
    { "site/_/card.wd": "{ title }" }
  );
});

test("@include traversal outside the shelf/pages roots is rejected", () => {
  const root = fixture();
  write(root, "secret.wd", "# Secret");
  write(root, "site/pages/index.wd", "@include ../../secret.wd");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /outside site\/pages or site\/_/
  );
});

// --- @loop error paths ------------------------------------------------------

test("@loop over an in-scope non-array value is rejected with file:line + hint", () => {
  // The @loop sits on file line 5 (after the 3-line frontmatter block), and the
  // error must report that TRUE file line, plus a corrective Use: hint.
  compileThrows(
    [
      "---",
      "name: solo",
      "---",
      "<main>",
      "@loop meta.name into x",
      "- { x }",
      "@endloop",
      "</main>"
    ],
    /index\.wd:5 found an in-scope value, but it is not a list \(got string\)[\s\S]*Use:/
  );
});

test("@loop over a missing optional frontmatter field loops zero rows and renders @empty", () => {
  // `tags` is absent from the frontmatter (an optional field) — the loop must
  // resolve to an empty list, not a fatal error.
  const page = compile([
    "---",
    "title: No tags here",
    "---",
    "@loop meta.tags into tag",
    "- { tag }",
    "@endloop",
    "@loop meta.tags into tag",
    "- { tag }",
    "@empty",
    "No tags yet.",
    "@endloop"
  ]);
  assert.match(page.html, /No tags yet\./);
  assert.doesNotMatch(page.html, /<li>/);
  assert.equal(page.assets.runtime, false, "an empty static loop stays zero-JS");
});

test("@loop over a JSON file that is not an array is rejected", () => {
  compileThrows(["@loop /obj.json into x", "- { x }", "@endloop"], /must be a JSON array/, {
    "site/_/obj.json": JSON.stringify({ not: "array" })
  });
});

test("malformed @loop (missing 'into') throws with a Use: hint", () => {
  compileThrows(["@loop /rows.json", "- x", "@endloop"], /Malformed @loop[\s\S]*Use: @loop/, {
    "site/_/rows.json": "[]"
  });
});

// --- Retired syntax & strays ------------------------------------------------

test("retired @repeat throws with the @loop replacement", () => {
  compileThrows(
    "@repeat /card.wd from /cards.json",
    /@repeat was replaced by @loop[\s\S]*Use: @loop/
  );
});

test("retired :for throws with the @loop replacement", () => {
  compileThrows(":for item in items", /:for was replaced by @loop[\s\S]*Use: @loop/);
});

test("a stray :endloop / :endif / :else / :endform throws with no-matching-opener text", () => {
  compileThrows("@endloop", /Stray "@endloop" with no matching opener/);
  compileThrows(":endif", /Stray ":endif" with no matching opener/);
  compileThrows(":else", /Stray ":else" with no matching opener/);
  compileThrows(":endform", /Stray ":endform" with no matching opener/);
});

// --- :if reactive vs static -------------------------------------------------

test(":if over :state emits both branch templates and the active initial branch", () => {
  const page = compile([":state open = true", ":if open", "Visible", ":else", "Hidden", ":endif"]);
  assert.match(page.html, /data-wd-if="open" data-wd-if-active="true"/);
  assert.match(page.html, /<div data-wd-if-out><p>Visible<\/p><\/div>/);
  assert.match(page.html, /<template data-wd-false><p>Hidden<\/p><\/template>/);
});

test(":if with a comparison compiles to a predicate-driven region", () => {
  const page = compile([":state n = 0", ":if n > 5", "Big", ":endif"]);
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-if-expr=/);
  // n=0 so the truthy branch is not the initial active one.
  assert.match(page.html, /<div data-wd-if-out><\/div>/);
});

test(":if over an unknown name in a comparison still throws", () => {
  compileThrows([":state n = 0", ":if ghost > 5", "x", ":endif"], /unknown name "ghost"/);
});

// --- Containers & demo directives -------------------------------------------

test("a named container becomes a div with the name as a class plus extra classes", () => {
  const page = compile(["::: hero .center #top", "Welcome", ":::"]);
  assert.match(page.html, /<div id="top" class="hero center">/);
});

test("an unexpected container token is rejected", () => {
  compileThrows(["::: section !bad", "x", ":::"], /Unexpected token "!bad"/);
});

test(":try, :note, and :sprint demo directives render their markup", () => {
  const page = compile([
    ':try "Reactive" href="/reactive/"',
    ':note "Heads up"',
    ':sprint min=2 max=5 roles="PM, Dev, QA"'
  ]);
  assert.match(page.html, /<a class="try-card" href="\/reactive\/"><span>Try<\/span>Reactive<\/a>/);
  assert.match(page.html, /<aside class="note">Heads up<\/aside>/);
  assert.match(page.html, /<section class="sprint-board" data-min="2" data-max="5">/);
  assert.match(page.html, /<article><strong>PM<\/strong>/);
});

test(":try escapes safe hrefs and allows whitelisted schemes", () => {
  const page = compile([
    ':try "Docs" href="https://example.com/docs?a=1&b=2"',
    ':try "Mail" href="mailto:hello@example.com"',
    ':try "Hash" href="#intro"'
  ]);
  assert.match(page.html, /href="https:\/\/example\.com\/docs\?a=1&amp;b=2"/);
  assert.match(page.html, /href="mailto:hello@example\.com"/);
  assert.match(page.html, /href="#intro"/);
});

test(":try rejects dangerous href schemes", () => {
  compileThrows(
    ':try "Bad" href="javascript:alert(1)"',
    /Unsafe :try href[\s\S]*Use a relative URL/
  );
});

// --- safeScriptJson escaping (via state script tag) -------------------------

test("state JSON containing < is escaped to \\u003c so it can't break out of the script tag", () => {
  const page = compile([':state payload = "</script><img>"', "{ payload }"]);
  // The literal "</script>" must not appear inside the JSON state block.
  const stateBlock = page.html.match(/data-wd-state>([^<]*?)<\/script>/);
  assert.ok(stateBlock, "state script block present");
  assert.match(page.html, /\\u003c\/script>/);
});

// --- html:false opt-out on .wd ----------------------------------------------

test("frontmatter html:false escapes raw HTML in a .wd prose body", () => {
  const page = compile(["---", "html: false", "---", '<div class="raw">hi</div>']);
  assert.doesNotMatch(page.html, /<div class="raw">hi<\/div>/);
  assert.match(page.html, /&lt;div/);
});

test("page title and description from frontmatter populate head meta tags", () => {
  const page = compile(["---", "title: My Page", "description: A great page", "---", "# Body"]);
  assert.match(page.html, /<title>My Page<\/title>/);
  assert.match(page.html, /<meta name="description" content="A great page">/);
  assert.match(page.html, /<meta property="og:title" content="My Page">/);
});

// --- code fences keep directives literal across the parser ------------------

test("a fenced block keeps directive-looking lines as literal code", () => {
  const page = compile(["```", ":state x = 0", "@loop a into b", "```"]);
  assert.match(page.html, /<code>/);
  assert.match(page.html, /:state x = 0/);
  assert.equal(page.assets.runtime, false);
});
