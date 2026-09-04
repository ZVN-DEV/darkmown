// ---------------------------------------------------------------------------
// F3 — `:select`, `:radio`, `:checkbox` as bound controls outside a `:form`.
//
// The same three lines mean two different things depending on where they sit.
// Inside a `:form` they are FORM FIELDS and nothing here may change that (the
// golden below is the whole in-form surface, byte for byte). Outside one they
// bind to a declared `:state`, exactly like `:bind` and `:slider`.
//
// The runtime half (control → state, state → control) lives in
// tests/runtime-dom.test.js.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-bound-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), lines.join("\n"));
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const body = (page) => page.html.slice(page.html.indexOf("<main"), page.html.indexOf("</main>"));

function errorFor(lines) {
  try {
    compile(lines);
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// The in-form surface is frozen.
// ---------------------------------------------------------------------------

const IN_FORM_SOURCE = [
  ':form into contact action="/api/echo"',
  ":select topic",
  "- Bug",
  "- Idea",
  ":checkbox toppings",
  "- Cheese",
  "- Ham",
  ":radio size required",
  "- S",
  "- M",
  ':submit "Send"',
  ":endform"
];

const IN_FORM_GOLDEN =
  '<select name="topic" aria-label="Topic">' +
  '<option value="Bug">Bug</option><option value="Idea">Idea</option></select>\n' +
  '<div class="wd-checkboxes" role="group" data-wd-multi="toppings" aria-label="Toppings">' +
  '<label><input type="checkbox" name="toppings" value="Cheese"> Cheese</label>' +
  '<label><input type="checkbox" name="toppings" value="Ham"> Ham</label></div>\n' +
  '<div class="wd-radios" role="radiogroup" aria-label="Size">' +
  '<label><input type="radio" name="size" value="S" required> S</label>' +
  '<label><input type="radio" name="size" value="M" required> M</label></div>\n' +
  '<button type="submit">Send</button>';

test("GOLDEN: the in-form field surface is byte-identical", () => {
  const html = body(compile(IN_FORM_SOURCE));
  assert.ok(html.includes(IN_FORM_GOLDEN), `in-form output drifted:\n${html}`);
  assert.doesNotMatch(html, /data-wd-bind-input/, "a form field is not a bound control");
});

test("a field inside a form is a form field even when state of that name exists", () => {
  // The rule cannot be "bind if a state of that name happens to exist": an
  // unrelated declaration elsewhere on the page would silently rewire a form.
  const html = body(
    compile([
      ':state topic = "Bug"',
      ':form into contact action="/api/echo"',
      ":select topic",
      "- Bug",
      "- Idea",
      ":endform"
    ])
  );
  assert.match(html, /<select name="topic"/);
  assert.doesNotMatch(html, /data-wd-bind-input/);
});

test("a field nested inside a container inside a form is still a form field", () => {
  const html = body(
    compile([
      ':state topic = "Bug"',
      ':form into contact action="/api/echo"',
      "::: fieldset",
      ":select topic",
      "- Bug",
      ":::",
      ":endform"
    ])
  );
  assert.match(html, /<select name="topic"/);
});

// ---------------------------------------------------------------------------
// Outside a form: bound controls.
// ---------------------------------------------------------------------------

test(":select outside a form binds the state and opens on its value", () => {
  const html = body(compile([':state topic = "Idea"', ":select topic", "- Bug", "- Idea"]));
  assert.match(html, /<select data-wd-bind-input="topic" aria-label="Topic">/);
  assert.match(html, /<option value="Idea" selected>Idea<\/option>/);
  assert.doesNotMatch(html, /<select name=/, "a bound control is not a form field");
});

test(":radio outside a form binds the state and checks the matching option", () => {
  const html = body(compile([':state size = "M"', ":radio size", "- S", "- M"]));
  // The shared `name` is what makes the group mutually exclusive in the browser,
  // so it stays — keyed by the state key.
  assert.match(
    html,
    /<input type="radio" name="size" value="M" data-wd-bind-input="size" checked>/
  );
  assert.match(html, /<input type="radio" name="size" value="S" data-wd-bind-input="size">/);
});

test(":checkbox outside a form binds a boolean", () => {
  const on = body(compile([":state agree = true", ":checkbox agree", "- I agree"]));
  assert.match(
    on,
    /<input type="checkbox" name="agree" value="I agree" data-wd-bind-input="agree" checked>/
  );
  const off = body(compile([":state agree = false", ":checkbox agree", "- I agree"]));
  assert.doesNotMatch(off, /checked/);
  assert.doesNotMatch(off, /data-wd-multi/, "a bound checkbox is a boolean, not an array");
});

test("a bound control flips the page reactive", () => {
  assert.equal(compile([':state topic = "Bug"', ":select topic", "- Bug"]).assets.runtime, true);
});

test("a bound control resolves a section-scoped state key", () => {
  const html = body(
    compile(["::: section #panel", ':state topic = "Bug"', ":select topic", "- Bug", ":::"])
  );
  assert.match(html, /data-wd-bind-input="panel:topic"/);
});

test("a :store can back a bound control too", () => {
  const html = body(compile([':store theme = "dark"', ":radio theme", "- dark", "- light"]));
  assert.match(html, /data-wd-bind-input="theme"/);
});

test("a bound control records the state it targets as a symbol", () => {
  const page = compile([':state topic = "Bug"', ":select topic", "- Bug"]);
  const field = page.symbols.find((s) => s.kind === "field");
  assert.equal(field.target, "topic");
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

test("a standalone field with no matching state is WD450, with both fixes", () => {
  const error = errorFor([":select nope", "- A"]);
  assert.match(error.message, /\[WD450\]/);
  assert.match(error.message, /outside a :form and has no matching state/);
  assert.match(error.message, /:state nope = "…"/, "names the declaration to write");
  assert.match(error.message, /move :select inside a :form/, "names the other reading");
  assert.equal(error.wd.code, "WD450");
  assert.equal(error.wd.line, 1);
});

test("a hyphenated name outside a form is WD450 — it can never be a state key", () => {
  const error = errorFor([":radio t-shirt", "- S"]);
  assert.match(error.message, /\[WD450\]/);
});

test("a bound :checkbox with several options is WD451", () => {
  const error = errorFor([":state picks = false", ":checkbox picks", "- A", "- B"]);
  assert.match(error.message, /\[WD451\]/);
  assert.match(error.message, /single true\/false/);
  assert.match(error.message, /:radio group/, "names the multi-value alternative");
});

test("a checkbox group with several options is still fine INSIDE a form", () => {
  // The control for WD451: the array form is the in-form behavior and is kept.
  const html = body(
    compile([
      ':form into order action="/api/echo"',
      ":checkbox toppings",
      "- Cheese",
      "- Ham",
      ":endform"
    ])
  );
  assert.match(html, /data-wd-multi="toppings"/);
});
