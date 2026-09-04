import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { directiveCatalog } from "../src/catalog.js";
import { compileFromMemory } from "../src/compiler.js";
import { compileSkin } from "../src/skin.js";

// ---------------------------------------------------------------------------
// The VS Code extension's snippets, checked against the REAL compiler.
//
// A snippet is the fastest path from "I opened a .wd file" to "I wrote a
// directive", so a snippet that does not compile is a bug shipped straight into
// a user's editor. The extension's own test suite can only prove tokenization,
// so this gate lives here, where the compiler does.
//
// Every snippet body is expanded (placeholders → their defaults) and compiled.
// ---------------------------------------------------------------------------

const wdSnippets = JSON.parse(
  fs.readFileSync(new URL("../editors/vscode/snippets/darkmown.json", import.meta.url), "utf8")
);
const skinSnippets = JSON.parse(
  fs.readFileSync(new URL("../editors/vscode/snippets/skin.json", import.meta.url), "utf8")
);

/** Expand a snippet body: `${1:default}` → `default`, `${1}` / `$0` → nothing. */
function expand(body) {
  return body
    .join("\n")
    .replace(/\$\{\d+:([^{}]*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$0/g, "")
    .replace(/\\\$/g, "$");
}

/** State/fetch keys the harness declares so a snippet's references resolve. */
const PREAMBLE = [
  [":state", "name", '""'],
  [":state", "items", "[]"],
  [":state", "count", "0"],
  [":state", "total", "0"],
  [":state", "query", '""'],
  [":state", "searches", "0"],
  [":state", "seconds", "0"],
  [":state", "volume", "50"],
  [":state", "cart", "[]"],
  [":state", "session", "{}"],
  [":fetch", "board", null]
];

const FIXTURES = {
  "site/_/partial.wd": "# Partial\n",
  "site/_/card.wd": "# { title }\n",
  "site/_/rows.json": JSON.stringify([{ name: "A" }]),
  "site/__wd/data/items.json": "[]"
};

/**
 * The declarations the harness must NOT make, because the snippet makes them
 * itself (a duplicate `:state` is WD204 — a harness artifact, not a snippet bug).
 */
function declaredBy(source) {
  const names = new Set();
  for (const line of source.split("\n")) {
    const m = line.match(
      /^\s*(?::state|:store|:slider|:fetch|:theme|:computed)\s+([A-Za-z_$][\w$]*)/
    );
    if (m) names.add(m[1]);
  }
  return names;
}

function preambleFor(source) {
  const own = declaredBy(source);
  return PREAMBLE.filter(([, key]) => !own.has(key))
    .map(([kind, key, value]) =>
      kind === ":fetch" ? `:fetch ${key} from "/board.json"` : `${kind} ${key} = ${value}`
    )
    .concat("")
    .join("\n");
}

/**
 * Snippets whose expansion is a FRAGMENT that needs a host construct to be
 * meaningful. Each names the wrapper, never an exemption from compiling.
 */
const WRAPPED = {
  // `@include /card.wd with title={ row.name }` passes a LOOP ROW down, so the
  // snippet only resolves inside a loop — which is exactly how it is used.
  "Include with args": (body) => `@loop /rows.json into row\n${body}\n@endloop\n`,
  // The frontmatter snippet IS the document head; it needs a body after it.
  Frontmatter: (body) => `${body}\n# Hello\n`,
  // A field directive reads two ways: a FORM FIELD inside a `:form`, a control
  // bound to `:state` outside one. All three snippets describe the form-field
  // reading ("capturing every checked value"), so the form is the host
  // construct they are written for.
  Select: inFormWrapper,
  "Checkbox group": inFormWrapper,
  "Radio group": inFormWrapper
};

/** @param {string} body */
function inFormWrapper(body) {
  return `:form into contact action="/api/echo"\n${body}\n:submit "Send"\n:endform\n`;
}

test("every .wd snippet the extension ships compiles", () => {
  const names = Object.keys(wdSnippets);
  assert.ok(names.length >= 30, `only ${names.length} snippets — the file did not load`);

  for (const [name, snippet] of Object.entries(wdSnippets)) {
    const expanded = expand(snippet.body);
    const wrap = WRAPPED[name];
    const source = wrap ? wrap(expanded) : `${preambleFor(expanded)}${expanded}\n`;
    assert.doesNotThrow(
      () =>
        compileFromMemory({ ...FIXTURES, "site/pages/index.wd": source }, "site/pages/index.wd"),
      `VS Code snippet "${name}" does not compile:\n${expanded}`
    );
  }
});

test("every .skin snippet the extension ships compiles", () => {
  for (const [name, snippet] of Object.entries(skinSnippets)) {
    const expanded = expand(snippet.body);
    const opts = expanded.startsWith("scoped") ? { scope: "wd-test" } : {};
    assert.doesNotThrow(
      () => compileSkin(expanded, opts),
      `VS Code skin snippet "${name}" does not compile:\n${expanded}`
    );
  }
});

test("the snippet compile-check is not vacuous — an invented directive fails it", () => {
  // Negative control. If `compileFromMemory` silently tolerated unknown
  // directives, the sweeps above would pass for any snippet at all.
  assert.throws(
    () =>
      compileFromMemory(
        { "site/pages/index.wd": ':state count = 0\n:button "x" -> count frobnicate\n' },
        "site/pages/index.wd"
      ),
    /WD311/
  );
  // …and an expansion that still contained a placeholder would not compile as
  // the snippet intends, so prove the expander really removes them.
  assert.equal(expand([":state ${1:name} = ${2:0}"]), ":state name = 0");
  assert.equal(expand(["::: section #${1:id}", "$0", ":::"]), "::: section #id\n\n:::");
});

test("the snippet set covers every catalog directive", () => {
  // The extension shipped snippets for 9 of 25 directives. A missing snippet is
  // a silent gap: the user never learns the directive exists.
  const bodies = Object.values(wdSnippets)
    .map((s) => s.body.join("\n"))
    .join("\n");
  const missing = directiveCatalog()
    .directives.map((d) => d.name)
    .filter((token) => !bodies.includes(token));
  assert.deepEqual(missing, [], `directives with no VS Code snippet: ${missing.join(", ")}`);
});
