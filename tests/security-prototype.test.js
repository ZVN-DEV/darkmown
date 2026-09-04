// ---------------------------------------------------------------------------
// The prototype-pollution boundary, on all three of its surfaces.
//
// CLAUDE.md states the invariant: "`constructor`/`prototype`/`__proto__` path
// segments are rejected in compiler AND runtime (`getPath`)". Two halves of that
// were unenforced:
//
//   * The compiler-side `getPath` guard had NO test at all — deleting it left the
//     whole suite green, so the invariant was documentation, not code.
//   * The guard covered path SEGMENTS but not DECLARATION NAMES, so
//     `:state __proto__ = {"polluted": true}` compiled clean, and the runtime's
//     boot `Object.assign(state, …)` wrote through `[[Set]]` and fired the
//     inherited `__proto__` setter — hijacking the state object's prototype.
//
// The third surface is `lookupVar`, which used `in` on a plain object and so
// answered "found" for every `Object.prototype` member.
//
// Also here: state keys emitted into `data-wd-*` attributes must be escaped. A
// section id is author-controlled and flows into the key, so an unescaped key
// closes the attribute and turns the rest into a live one — two characters away
// from an `id=` that has always been escaped.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-security-proto-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(lines, shelf = {}) {
  const root = fixture();
  write(root, "site/pages/index.wd", lines.join("\n"));
  for (const [name, value] of Object.entries(shelf)) {
    write(root, `site/_/${name}`, typeof value === "string" ? value : JSON.stringify(value));
  }
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const RESERVED = ["__proto__", "constructor", "prototype"];

// ---------------------------------------------------------------------------
// Declaration names (WD250)
// ---------------------------------------------------------------------------

// Every directive that puts a key into `comp.state`, and therefore into the JSON
// the runtime `Object.assign`s over its state object.
const DECLARERS = [
  { name: ":state", line: (n) => `:state ${n} = 1` },
  { name: ":store", line: (n) => `:store ${n} = 1` },
  { name: ":computed", line: (n) => `:computed ${n} = 1 + 1` },
  { name: ":theme", line: (n) => `:theme ${n}` },
  { name: ":fetch", line: (n) => `:fetch ${n} from "/api.json"` },
  { name: ":form", line: (n) => `:form into ${n}\n:submit "Go"\n:endform` },
  { name: ":slider", line: (n) => `:slider ${n} = 5` }
];

for (const declarer of DECLARERS) {
  for (const reserved of RESERVED) {
    test(`${declarer.name} rejects the declaration name "${reserved}" with WD250`, () => {
      assert.throws(
        () => compile([declarer.line(reserved)]),
        (err) => {
          assert.match(err.message, /^\[WD250\] /, "carries the code");
          assert.match(err.message, /is not allowed in/);
          assert.match(err.message, /Use: rename the key/, "carries a corrective suggestion");
          assert.equal(err.wd.code, "WD250");
          return true;
        }
      );
    });
  }
}

test("a state seed can never reach the runtime under a prototype key", () => {
  // The end-to-end property, stated over the emitted document rather than the
  // error: no seed script may carry one of the three names as a top-level key.
  for (const reserved of RESERVED) {
    assert.throws(() => compile([`:state ${reserved} = {"polluted": true}`]), /WD250/);
  }
  // Control: an ordinary name still seeds exactly as before.
  const ok = compile([':state proto_ok = {"polluted": true}']);
  assert.match(ok.html, /"proto_ok":\{"polluted":true\}/);
});

test("an ordinary name that merely CONTAINS a reserved word still compiles", () => {
  // The guard is exact-match, not substring: `constructorName` is a fine key.
  const page = compile([":state constructorName = 1", ":state my__proto__x = 2"]);
  assert.match(page.html, /"constructorName":1/);
  assert.match(page.html, /"my__proto__x":2/);
});

// ---------------------------------------------------------------------------
// Path segments — the compiler-side `getPath` guard (previously untested)
// ---------------------------------------------------------------------------

const POISON_PATHS = ["r.constructor.name", "r.__proto__.x", "r.prototype.y", "r.constructor"];

for (const expr of POISON_PATHS) {
  test(`{ ${expr} } renders empty — the compiler-side getPath guard`, () => {
    const page = compile(["@loop /r.json into r", `A[{ ${expr} }]B`, "@endloop"], {
      "r.json": [{ n: 1 }]
    });
    const body = page.html.slice(page.html.indexOf("<main"));
    assert.ok(body.includes("A[]B"), `expected an empty value, got: ${body.match(/A\[.*?\]B/)}`);
    assert.doesNotMatch(body, /\[object|native code|function /i);
  });
}

test("a poisoned segment in a :button target is a hard error, not an empty read", () => {
  // The other half of the same rule: `validatePath` throws where `getPath` folds.
  assert.throws(() => compile([":state obj = {}", ':button "Go" -> obj.__proto__ = 1']), /WD002/);
});

// ---------------------------------------------------------------------------
// lookupVar: own keys only
// ---------------------------------------------------------------------------

const INHERITED = ["toString", "valueOf", "hasOwnProperty", "constructor"];

for (const member of INHERITED) {
  test(`{ ${member} } is not a variable just because Object.prototype has one`, () => {
    // `in` walks the prototype chain, so `{ toString }` used to render
    // "function toString() { [native code] }" straight into the page.
    const page = compile([`X{ ${member} }Y`]);
    const body = page.html.slice(page.html.indexOf("<main"));
    assert.ok(
      body.includes(`X{ ${member} }Y`),
      `expected the braces left as literal text, got: ${body}`
    );
    assert.doesNotMatch(body, /native code/);
  });
}

test("an @include argument naming an inherited member is a compile error, not a value", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "@include /p.wd with v={ toString }");
  write(root, "site/_/p.wd", "Value: { v }\n");
  try {
    assert.throws(
      () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
      /WD604/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a real own variable of the same shape still resolves (control)", () => {
  // Guards against over-correcting into "reject these names everywhere": a JSON
  // row that genuinely has a `valueOf` field is ordinary data.
  const page = compile(["@loop /r.json into r", "V{ r.valueOf }W", "@endloop"], {
    "r.json": [{ valueOf: "mine" }]
  });
  assert.match(page.html, /VmineW/);
});

// ---------------------------------------------------------------------------
// State keys are attribute values, so they need attribute escaping
// ---------------------------------------------------------------------------

// A `::: name #id` id becomes the state-key prefix, and every one of these
// attributes carries that key.
test("a quote-bearing section id cannot inject an attribute through a state key", () => {
  const page = compile([
    '::: card #a"onmouseover=alert(1)x',
    ":state n = 1 persist",
    ":computed d = n + 1",
    ":bind n",
    ":slider s = 5 persist",
    ':button "Go" -> n++',
    ":form into f",
    ':submit "Send"',
    ":endform",
    ':fetch feed from "/api.json"',
    ":store g = 1",
    "Value { n }",
    ":::"
  ]);
  const body = page.html.slice(page.html.indexOf("<main"));
  // Nothing may look like a live event-handler attribute…
  assert.doesNotMatch(body, /\sonmouseover=/, "an unescaped key opened a live attribute");
  // …and every key-bearing attribute must carry the ESCAPED form.
  for (const attr of [
    "data-wd-persist",
    "data-wd-computed-key",
    "data-wd-bind-input",
    "data-wd-target",
    "data-wd-form",
    "data-wd-fetch-key",
    "data-wd-bind"
    // `data-wd-store` / `data-wd-theme` are deliberately absent: a store is
    // page-global and never section-scoped, so its key can only ever be the bare
    // `[A-Za-z_$][\w$]*` name the parser accepted. They are escaped at the emit
    // site anyway, so the rule is one rule.
  ]) {
    assert.match(
      body,
      new RegExp(`${attr}="[^"]*&quot;`),
      `${attr} emitted the raw quote instead of &quot;`
    );
  }
});

test("an ordinary section id still produces plain, readable keys (control)", () => {
  const page = compile(["::: card #cart", ":state n = 1", "Value { n }", ":::"]);
  assert.match(page.html, /data-wd-bind="cart:n"/);
});
