// Accessible names on generated form inputs.
//
// The audit found that generated `:input`/`:bind` <input> elements shipped with
// `name`/`placeholder` but no accessible name (no <label>, no aria). A placeholder
// is NOT an accessible name. So when the author supplies neither `aria-label` nor
// `aria-describedby`, the compiler now auto-adds a non-visual `aria-label` derived
// from the placeholder (if any) else a humanized version of the field name / state
// key. An author-supplied aria attribute is always preserved and never duplicated.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-a11y-"));
}

function compileWd(lines) {
  const root = fixture();
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return compilePage(file, createPaths(root)).html;
}

// Count aria-label occurrences on the (single) emitted input.
function ariaLabels(html) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// :input
// ---------------------------------------------------------------------------

test(":input with only a placeholder gets a matching aria-label", () => {
  const html = compileWd([
    ":form into profile",
    ':input quest placeholder="Your quest"',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<input type="text" name="quest" placeholder="Your quest" aria-label="Your quest">/);
  assert.deepEqual(ariaLabels(html), ["Your quest"], "exactly one aria-label, matching the placeholder");
});

test(":input with neither placeholder nor aria gets an aria-label humanized from its name", () => {
  const html = compileWd([
    ":form into profile",
    ":input quest",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<input type="text" name="quest" aria-label="Quest">/);
});

test(":input humanizes hyphenated names into a readable aria-label", () => {
  const html = compileWd([
    ":form into profile",
    ":input user-name",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /name="user-name" aria-label="User name"/);
});

test(":input preserves an explicit aria-label and does not duplicate it", () => {
  const html = compileWd([
    ":form into profile",
    ':input quest aria-label="Search the realm" placeholder="Type…"',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /aria-label="Search the realm"/);
  assert.deepEqual(ariaLabels(html), ["Search the realm"], "author aria-label wins, placeholder does not override it");
});

test(":input with aria-describedby is treated as having an accessible name (no auto aria-label)", () => {
  const html = compileWd([
    ":form into profile",
    ':input quest aria-describedby="hint"',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /aria-describedby="hint"/);
  assert.deepEqual(ariaLabels(html), [], "aria-describedby suppresses the auto aria-label");
});

// ---------------------------------------------------------------------------
// :bind
// ---------------------------------------------------------------------------

test(":bind with only a placeholder gets a matching aria-label", () => {
  const html = compileWd([
    ':state query = ""',
    ':bind query placeholder="Search"'
  ]);
  assert.match(html, /data-wd-bind-input="query"[^>]*placeholder="Search"[^>]*aria-label="Search"/);
  assert.deepEqual(ariaLabels(html), ["Search"]);
});

test(":bind with neither placeholder nor aria gets an aria-label from its state key", () => {
  const html = compileWd([
    ':state query = ""',
    ":bind query"
  ]);
  assert.match(html, /data-wd-bind-input="query"[^>]*aria-label="Query"/);
});

test(":bind preserves an explicit aria-label and does not duplicate it", () => {
  const html = compileWd([
    ':state query = ""',
    ':bind query aria-label="Site search" placeholder="Search"'
  ]);
  assert.match(html, /aria-label="Site search"/);
  assert.deepEqual(ariaLabels(html), ["Site search"]);
});

test("auto aria-label is HTML-escaped", () => {
  const html = compileWd([
    ":form into profile",
    ':input quest placeholder="Name & title"',
    ':submit "Go"',
    ":endform"
  ]);
  // The placeholder is escaped in both the placeholder attr and the derived aria-label.
  assert.match(html, /placeholder="Name &amp; title"/);
  assert.match(html, /aria-label="Name &amp; title"/);
});
