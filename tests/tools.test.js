// ---------------------------------------------------------------------------
// The agent tool surface: `@zvndev/darkmown/tools`.
//
// Six tools an AI editor drives instead of rewriting whole files: outline (what
// is in this page), refs (where is this symbol used), deps (what does this page
// pull in), grammar (how do I write this directive), validate (does it compile),
// apply (make the edit). Plus `Session`, which stages edits so every tool sees
// one snapshot, and `parseToolCall`, which pulls a call out of a model's reply.
//
// What these pin is the CONTRACT a model depends on, not the wording: every tool
// answers {ok, text}, a refusal always carries a sentence saying what to do
// instead, and nothing throws. A tool that throws, or that fails in its own
// shape, is invisible to the model driving it and ends the run.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";
import { grammarCost } from "../src/tools/grammar.js";
import {
  apply,
  deps,
  grammar,
  outline,
  parseToolCall,
  refs,
  Session,
  TOOL_SPECS,
  toolPrompt,
  validate
} from "../src/tools/index.js";

const ENTRY = "site/pages/index.wd";

/** A small reactive page: state, a store, an action, a loop and a binding. */
const PAGE = `---
title: Shop
---

# Shop

:state count = 0
:store cart = []

:button "Add one" -> count++

@loop /products.json into p
- { p.name } at { p.price }
@endloop

The count is { count }.
`;

const files = () => ({
  [ENTRY]: PAGE,
  "site/_/products.json": '[{ "name": "Mug", "price": 12 }]'
});

/** A page that does not compile: `@loop` with no `into` clause. */
const BROKEN = "# Hi\n\n@loop /products.json\n- x\n@endloop\n";

// ---------------------------------------------------------------------------
// The contract every tool keeps
// ---------------------------------------------------------------------------

test("every tool answers {ok, text}, on success and on refusal", () => {
  const f = files();
  for (const r of [
    outline(f, ENTRY),
    refs(f, ENTRY, "count"),
    deps(f, ENTRY),
    grammar(["state"]),
    validate(f, ENTRY)
  ]) {
    assert.equal(r.ok, true);
    assert.equal(typeof r.text, "string");
    assert.ok(r.text.length > 0);
  }

  // The refusals are the cases that matter: the model only ever sees `text`, so
  // a tool that fails in a different shape tells it nothing it can act on.
  const refused = [
    grammar(["nonsense"]),
    refs(f, ENTRY), // no symbol name
    apply(f, ENTRY, []), // no edits
    apply(f, "site/pages/nope.wd", [{ op: "replace", line: 1, text: "x" }]),
    validate(f, "site/pages/nope.wd"),
    validate({ [ENTRY]: BROKEN }, ENTRY)
  ];
  for (const r of refused) {
    assert.equal(r.ok, false);
    assert.equal(typeof r.text, "string", `refusal had no text: ${JSON.stringify(r)}`);
    assert.ok(r.text.length > 0);
  }
});

test("no tool throws on an empty project", () => {
  for (const call of [
    () => outline({}, ENTRY),
    () => refs({}, ENTRY, "x"),
    () => deps({}, ENTRY),
    () => validate({}, ENTRY),
    () => apply({}, ENTRY, [{ op: "replace", line: 1, text: "x" }]),
    () => grammar(["", "  "])
  ]) {
    const r = call();
    assert.equal(r.ok, false);
    assert.equal(typeof r.text, "string");
    assert.ok(r.text.length > 0);
  }
});

test("no tool echoes the virtual project root back at the model", () => {
  // The model never saw `/site/pages/`; a path it copies from there resolves to
  // nothing. Every tool shortens to what the author would call the file.
  const f = files();
  const texts = [
    outline(f, ENTRY).text,
    refs(f, ENTRY, "count").text,
    deps(f, ENTRY).text,
    validate({ [ENTRY]: BROKEN }, ENTRY).text
  ];
  for (const t of texts) assert.doesNotMatch(t, /site\/pages\//, t);
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test("outline names the page's declarations with their lines", () => {
  const r = outline(files(), ENTRY);
  assert.equal(r.ok, true);
  assert.match(r.text, /state\s+count/);
  assert.match(r.text, /store\s+cart/);
  assert.match(r.text, /loop/);
  // A line number is what makes an edit addressable at all.
  assert.match(r.text, /:7\b/);
  // A block gets its span, not just its opener: a model told only where a loop
  // STARTS replaces the header and strands the closer.
  assert.match(r.text, /:12-14/);
});

test("outline says whether the page went reactive", () => {
  assert.match(outline(files(), ENTRY).text, /reactive/);
  assert.equal(outline(files(), ENTRY).data.runtime, true);

  const staticPage = outline(
    { "site/pages/about.wd": "# About\n\nJust prose.\n" },
    "site/pages/about.wd"
  );
  assert.equal(staticPage.data.runtime, false);
  assert.match(staticPage.text, /static/);
});

test("refs separates a declare, a write and a read of one symbol", () => {
  const r = refs(files(), ENTRY, "count");
  assert.equal(r.ok, true);
  assert.match(r.text, /declare/);
  assert.match(r.text, /write/); // :button … -> count++
  assert.match(r.text, /read/); // { count } in prose
  assert.equal(r.data.refs.length, 3);
});

test("refs on an unknown name answers, rather than refusing", () => {
  // Not an error: "nothing references this" is a real answer, and naming what
  // the page does have is what lets a model recover from a typo in one turn.
  const r = refs(files(), ENTRY, "nosuchthing");
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.refs, []);
  assert.match(r.text, /count/);
  assert.match(r.text, /cart/);
});

test("deps reports the data file the loop reads", () => {
  const r = deps(files(), ENTRY);
  assert.equal(r.ok, true);
  assert.match(r.text, /products\.json/);
  assert.equal(r.data.includes.length, 1);
});

test("validate reports the static/reactive split, which is the framework's core promise", () => {
  const r = validate(files(), ENTRY);
  assert.equal(r.ok, true);
  assert.equal(r.data.runtime, true);
  assert.match(r.text, /reactive/);

  const plain = validate(
    { "site/pages/about.wd": "# About\n\nJust prose.\n" },
    "site/pages/about.wd"
  );
  assert.equal(plain.data.runtime, false);
  assert.match(plain.text, /zero JavaScript/);
});

test("validate turns a compile error into a code, a location and a template", () => {
  const r = validate({ [ENTRY]: BROKEN }, ENTRY);
  assert.equal(r.ok, false);
  assert.match(r.text, /WD\d{3}/);
  assert.equal(r.data.code, "WD101");
  assert.equal(r.data.line, 3);
  assert.equal(r.data.file, "index.wd");
  // The corrective template is the part a model can act on without guessing.
  assert.match(r.text, /@loop src into item|@loop .* into /);
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

test("apply edits by line and hands back a new snapshot", () => {
  const f = files();
  const r = apply(f, ENTRY, [{ op: "replace", line: 7, text: ":state count = 5" }]);
  assert.equal(r.ok, true);
  assert.match(r.data.files[ENTRY], /:state count = 5/);
  // The caller's copy is untouched: apply returns a new set rather than mutating.
  assert.match(f[ENTRY], /:state count = 0/);
});

test("apply edits by symbol, so the caller never counts lines", () => {
  const r = apply(files(), ENTRY, [
    { op: "replace", symbol: "state:count", text: ":state count = 9" }
  ]);
  assert.equal(r.ok, true);
  assert.match(r.data.files[ENTRY], /:state count = 9/);
});

test("apply catches a stale line through `expect`", () => {
  const r = apply(files(), ENTRY, [
    { op: "replace", line: 7, expect: ":store cart", text: ":state count = 1" }
  ]);
  assert.equal(r.ok, false);
  assert.match(r.text, /outline/); // tells it how to recover
});

test("apply refuses an anchor that is not in the file", () => {
  const r = apply(files(), ENTRY, [{ op: "replace", anchor: "not in this file", text: "x" }]);
  assert.equal(r.ok, false);
  assert.ok(r.text.length > 0);
});

test("apply refuses an unknown op instead of guessing", () => {
  const r = apply(files(), ENTRY, [{ op: "frobnicate", line: 1, text: "x" }]);
  assert.equal(r.ok, false);
  assert.match(r.text, /replace/);
  assert.match(r.text, /insert_after/);
});

test("apply refuses overlapping edits rather than produce a plausible wrong file", () => {
  const r = apply(files(), ENTRY, [
    { op: "replace", line: 7, text: "a" },
    { op: "replace", line: 7, text: "b" }
  ]);
  assert.equal(r.ok, false);
});

test("an edit and the compile that checks it agree on the same page", () => {
  // The loop the whole surface exists to support: outline, edit, validate.
  const s = new Session(files(), ENTRY);
  assert.match(s.call("outline", {}).text, /state\s+count/);
  assert.equal(
    s.call("apply", { edits: [{ op: "replace", symbol: "state:count", text: ":state count = 3" }] })
      .ok,
    true
  );
  const after = s.call("validate", {});
  assert.equal(after.ok, true);
  assert.match(s.content(), /:state count = 3/);
});

// ---------------------------------------------------------------------------
// Driving it
// ---------------------------------------------------------------------------

test("a Session stages edits, and can throw them away", () => {
  const s = new Session(files(), ENTRY);
  s.call("apply", { edits: [{ op: "replace", symbol: "state:count", text: ":state count = 3" }] });
  assert.match(s.content(), /:state count = 3/);
  s.reset();
  assert.match(s.content(), /:state count = 0/);
});

test("a Session records every call, so a run can be scored on how many it took", () => {
  const s = new Session(files(), ENTRY);
  s.call("outline", {});
  s.call("grammar", { categories: ["state"] });
  assert.deepEqual(
    s.history.map((h) => [h.tool, h.ok]),
    [
      ["outline", true],
      ["grammar", true]
    ]
  );
});

test("a rejected apply leaves the session unchanged", () => {
  const s = new Session(files(), ENTRY);
  assert.equal(s.call("apply", { edits: [{ op: "frobnicate", line: 1, text: "x" }] }).ok, false);
  assert.equal(s.content(), PAGE);
});

test("an unknown tool is answered with the list, not an exception", () => {
  const s = new Session(files(), ENTRY);
  const r = s.call("teleport", {});
  assert.equal(r.ok, false);
  for (const spec of TOOL_SPECS) assert.match(r.text, new RegExp(spec.name));
});

test("the tool prompt names every dispatchable tool", () => {
  const prompt = toolPrompt();
  for (const spec of TOOL_SPECS) {
    assert.match(prompt, new RegExp(spec.name));
    assert.ok(new Session(files(), ENTRY).call(spec.name, {}).text.length > 0);
  }
  // No `[optional]` bracket notation: small models copy schematic notation into
  // their output verbatim.
  assert.doesNotMatch(prompt, /\[optional\]/);
});

test("parseToolCall pulls a call out of a model's surrounding prose", () => {
  const r = parseToolCall('Sure! I will look first.\n{"tool":"outline","args":{}}\nThen edit.');
  assert.equal(r.ok, true);
  assert.equal(r.call.tool, "outline");
  assert.deepEqual(r.call.args, {});
});

test("parseToolCall survives the braces a Darkmown edit always contains", () => {
  // `{ count }` inside the payload is the case a naive indexOf("}") truncates,
  // and it is in exactly the calls that matter most.
  const r = parseToolCall(
    '```json\n{"tool":"apply","args":{"edits":[{"op":"replace","line":7,"text":"Total: { count }"}]}}\n```'
  );
  assert.equal(r.ok, true);
  assert.equal(r.call.tool, "apply");
  assert.equal(r.call.args.edits[0].text, "Total: { count }");
});

test("parseToolCall refuses a malformed or toolless reply with a reason", () => {
  for (const reply of [
    '{"tool": "outline", oops}',
    "I think you should add a button.",
    '{"args": {}}'
  ]) {
    const r = parseToolCall(reply);
    assert.equal(r.ok, false);
    assert.ok(r.error.length > 0);
  }
});

// ---------------------------------------------------------------------------
// The grammar tool
// ---------------------------------------------------------------------------

test("grammar returns only the category asked for", () => {
  const r = grammar(["state"]);
  assert.equal(r.ok, true);
  assert.match(r.text, /:state/);
  assert.deepEqual(r.data.categories, ["state"]);
  assert.doesNotMatch(r.text, /@loop/);
});

test("grammar with no argument returns every category", () => {
  const all = grammar();
  assert.equal(all.ok, true);
  assert.ok(all.data.categories.length > 1);
  assert.ok(all.text.length > grammar(["state"]).text.length);
});

test("an unknown category is refused with the list of real ones", () => {
  const r = grammar(["nonsense"]);
  assert.equal(r.ok, false);
  for (const c of grammar().data.categories) assert.match(r.text, new RegExp(c));
});

// ---------------------------------------------------------------------------
// The rest of the refusal surface.
//
// Every case below is a sentence a model reads and has to recover from in one
// turn, which is the only reason these paths exist. A refusal that does not say
// what would have worked costs the same tokens as a crash.
// ---------------------------------------------------------------------------

test("apply refuses a line past the end, and says how to append", () => {
  const r = apply(files(), ENTRY, [{ op: "replace", line: 9999, text: "x" }]);
  assert.equal(r.ok, false);
  assert.match(r.text, /outside the file/);
  // The recovery is spelled as a call it can copy, not described.
  assert.match(r.text, /"op": "insert_after"/);
});

test("apply refuses an unknown symbol by listing the real ones", () => {
  const r = apply(files(), ENTRY, [{ op: "replace", symbol: "state:nope", text: "x" }]);
  assert.equal(r.ok, false);
  assert.match(r.text, /state:count/);
  assert.match(r.text, /store:cart/);
});

test("apply refuses an ambiguous symbol and says how to qualify it", () => {
  // `items` is both a declared store and a loop variable, so a bare name has
  // two homes. Guessing one silently edits the wrong construct.
  const page = [
    "# Two",
    "",
    ":store items = []",
    "",
    "@loop /products.json into items",
    "- { items.name }",
    "@endloop"
  ].join("\n");
  const r = apply({ [ENTRY]: page, "site/_/products.json": "[]" }, ENTRY, [
    { op: "replace", symbol: "items", text: ":store items = [1]" }
  ]);
  assert.equal(r.ok, false);
  assert.match(r.text, /ambiguous/);
  assert.match(r.text, /kind:name/);
});

test("apply refuses an anchor that appears more than once", () => {
  const page = "# Hi\n\nSame line\n\nSame line\n";
  const r = apply({ [ENTRY]: page }, ENTRY, [{ op: "replace", anchor: "Same line", text: "x" }]);
  assert.equal(r.ok, false);
  assert.match(r.text, /appears 2 times/);
  assert.match(r.text, /3, 5/); // the lines, so it can pick one
});

test("apply refuses an edit that says nothing about where it goes", () => {
  const r = apply(files(), ENTRY, [{ op: "replace", text: "x" }]);
  assert.equal(r.ok, false);
  for (const form of [/"line": 7/, /"symbol"/, /"anchor"/]) assert.match(r.text, form);
});

test("apply refuses a write with no text", () => {
  const r = apply(files(), ENTRY, [{ op: "replace", line: 7 }]);
  assert.equal(r.ok, false);
  assert.match(r.text, /needs "text"/);
});

test("apply refuses a symbol target when the file does not compile", () => {
  // Symbols come from a compile, so on a broken file there are none to resolve
  // against. Saying "no such symbol" would send the model looking for a typo
  // that is not there; the real fix is the compile error.
  const r = apply({ [ENTRY]: BROKEN }, ENTRY, [
    { op: "replace", symbol: "state:count", text: "x" }
  ]);
  assert.equal(r.ok, false);
  assert.match(r.text, /does not compile/);
  assert.match(r.text, /target a line/);
});

test("apply does insert_after, insert_before and delete", () => {
  const after = apply(files(), ENTRY, [{ op: "insert_after", line: 7, text: ":state seen = 0" }]);
  assert.equal(after.ok, true);
  assert.match(after.data.files[ENTRY].split("\n")[7], /:state seen = 0/);

  const before = apply(files(), ENTRY, [{ op: "insert_before", line: 7, text: ":state seen = 0" }]);
  assert.equal(before.ok, true);
  assert.match(before.data.files[ENTRY].split("\n")[6], /:state seen = 0/);

  const gone = apply(files(), ENTRY, [{ op: "delete", line: 7 }]);
  assert.equal(gone.ok, true);
  assert.doesNotMatch(gone.data.files[ENTRY], /:state count/);
});

test("apply targets a whole block, not just its opening line", () => {
  // Replacing a `@loop` by name has to take the `@endloop` with it, or the
  // edit strands a closer and the next compile fails on the model's behalf.
  const r = apply(files(), ENTRY, [{ op: "replace", symbol: "loop:p", text: "No products yet." }]);
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.data.files[ENTRY], /@endloop/);
  assert.match(r.data.files[ENTRY], /No products yet\./);
});

test("outline reports a compile failure rather than an empty page", () => {
  const r = outline({ [ENTRY]: BROKEN }, ENTRY);
  assert.equal(r.ok, false);
  assert.match(r.text, /@loop/);
});

test("outline says so when a page declares nothing", () => {
  const r = outline({ "site/pages/about.wd": "# About\n\nJust prose.\n" }, "site/pages/about.wd");
  assert.equal(r.ok, true);
  assert.match(r.text, /no directives/);
});

test("deps names a page it could not read, instead of dropping it", () => {
  // A project where one page is broken still has a real answer for the others.
  // Silently skipping it would report "included by nothing" as though it were
  // established, when it is actually unknown.
  const r = deps({ ...files(), "site/pages/broken.wd": BROKEN }, ENTRY);
  assert.equal(r.ok, true);
  assert.match(r.text, /does not compile/);
  assert.deepEqual(r.data.broken, ["site/pages/broken.wd"]);
});

test("deps finds the pages that include this one", () => {
  const partial = "site/_/nav.wd";
  const project = {
    [partial]: "- [Home](/)\n",
    "site/pages/index.wd": `# Home\n\n@include /nav.wd\n`,
    "site/pages/about.wd": `# About\n\n@include /nav.wd\n`
  };
  const r = deps(project, partial);
  assert.equal(r.ok, true);
  assert.equal(r.data.usedBy.length, 2);
  assert.match(r.text, /included by/);
});

test("parseToolCall is not fooled by braces or quotes inside a string", () => {
  // An escaped quote must not close the string, or the brace counter resumes
  // inside it and cuts the object short.
  const r = parseToolCall('{"tool":"apply","args":{"text":"say \\"} { \\" out loud"}}');
  assert.equal(r.ok, true);
  assert.equal(r.call.args.text, 'say "} { " out loud');
});

test("parseToolCall refuses an object that is never closed", () => {
  const r = parseToolCall('{"tool": "outline", "args": {');
  assert.equal(r.ok, false);
  assert.match(r.error, /never closed/);
});

test("validate refuses a call with no files at all", () => {
  const r = validate(null, ENTRY);
  assert.equal(r.ok, false);
  assert.equal(r.data.code, "TOOL_ARGS");
});

test("grammarCost measures what asking for one category saves", () => {
  // The tool exists to spend fewer tokens on syntax the edit does not touch,
  // so the saving is measured rather than asserted.
  const cost = grammarCost(["state"]);
  assert.ok(cost.sliceChars > 0);
  assert.ok(cost.fullChars > cost.sliceChars);
  assert.equal(cost.saved, cost.fullChars - cost.sliceChars);
  assert.ok(cost.savedPct > 0 && cost.savedPct < 100);
});

test("apply edits by anchor, spanning every line the anchor covers", () => {
  const r = apply(files(), ENTRY, [
    { op: "replace", anchor: ':button "Add one" -> count++', text: ':button "Add" -> count += 2' }
  ]);
  assert.equal(r.ok, true);
  assert.match(r.data.files[ENTRY], /count \+= 2/);
  assert.doesNotMatch(r.data.files[ENTRY], /Add one/);

  // A multi-line anchor replaces the whole span, not just its first line.
  const multi = apply(files(), ENTRY, [
    { op: "replace", anchor: ":state count = 0\n:store cart = []", text: ":state count = 7" }
  ]);
  assert.equal(multi.ok, true);
  assert.doesNotMatch(multi.data.files[ENTRY], /:store cart/);
});

test("outline covers every file in the project, entry first", () => {
  // Two includes, so the listing has to order files that are neither the entry
  // nor each other's neighbour. Whatever else moves, the entry leads: it is the
  // file being edited, and a model reads the first block.
  const project = {
    "site/_/nav.wd": ":state open = false\n",
    "site/_/foot.wd": ":state year = 2026\n",
    [ENTRY]: "# Home\n\n@include /nav.wd\n\n@include /foot.wd\n"
  };
  const r = outline(project, ENTRY);
  assert.equal(r.ok, true);
  const files_ = r.text.split("\n").filter((l) => /^\S.*\(\d+ lines\)/.test(l));
  assert.equal(files_.length, 3);
  assert.match(files_[0], /index\.wd/);
  // The two includes are listed in a stable order, so a second call to outline
  // never hands the model a different picture of the same project.
  assert.deepEqual(
    files_.slice(1).map((l) => l.trim().split(" ")[0]),
    ["_/foot.wd", "_/nav.wd"]
  );
});
