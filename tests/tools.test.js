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
