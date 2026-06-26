// :textarea and :select form controls (issue #17). They render <textarea> /
// <select> inside a :form and are captured by the runtime's FormData the same
// way :input is. Compiler-only feature — no runtime change.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compileWd(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-formctl-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return compilePage(file, createPaths(root)).html;
}

// ---------------------------------------------------------------------------
// :textarea
// ---------------------------------------------------------------------------

test(":textarea renders a named textarea with placeholder and derived aria-label", () => {
  const html = compileWd([
    ":form into profile",
    ':textarea notes placeholder="Your notes"',
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    html,
    /<textarea name="notes" placeholder="Your notes" aria-label="Your notes"><\/textarea>/
  );
});

test(":textarea supports rows and the required flag", () => {
  const html = compileWd([
    ":form into profile",
    ":textarea notes rows=6 required",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<textarea name="notes" rows="6" required aria-label="Notes"><\/textarea>/);
});

test(":textarea humanizes its aria-label from the field name when no placeholder", () => {
  const html = compileWd([
    ":form into profile",
    ":textarea case-notes",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<textarea name="case-notes" aria-label="Case notes"><\/textarea>/);
});

test(":textarea preserves an explicit aria-label and does not duplicate it", () => {
  const html = compileWd([
    ":form into profile",
    ':textarea notes aria-label="Case details" placeholder="Type…"',
    ':submit "Go"',
    ":endform"
  ]);
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Case details"]);
});

// ---------------------------------------------------------------------------
// :select
// ---------------------------------------------------------------------------

test(":select renders a named select with options from the following list lines", () => {
  const html = compileWd([
    ":form into profile",
    ":select topic",
    "- General inquiry",
    "- New case",
    "- Billing",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    html,
    /<select name="topic" aria-label="Topic"><option value="General inquiry">General inquiry<\/option><option value="New case">New case<\/option><option value="Billing">Billing<\/option><\/select>/
  );
});

test(":select supports the required flag", () => {
  const html = compileWd([
    ":form into profile",
    ":select topic required",
    "- General",
    "- Billing",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<select name="topic" required aria-label="Topic">/);
});

test(":select escapes option labels", () => {
  const html = compileWd([
    ":form into profile",
    ":select topic",
    "- Crowns & bridges",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<option value="Crowns &amp; bridges">Crowns &amp; bridges<\/option>/);
});

test(":select with no options is a clear compile error", () => {
  assert.throws(
    () => compileWd([":form into profile", ":select topic", ':submit "Go"', ":endform"]),
    /:select.*option/i
  );
});

// ---------------------------------------------------------------------------
// :checkbox — multi-select group, captured as an array (data-wd-multi marker)
// ---------------------------------------------------------------------------

test(":checkbox renders a labelled checkbox group marked for array capture", () => {
  const html = compileWd([
    ":form into profile",
    ":checkbox interests",
    "- Ortho",
    "- Pedo",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    html,
    /<div class="wd-checkboxes" role="group" data-wd-multi="interests" aria-label="Interests"><label><input type="checkbox" name="interests" value="Ortho"> Ortho<\/label><label><input type="checkbox" name="interests" value="Pedo"> Pedo<\/label><\/div>/
  );
});

test(":checkbox escapes option labels", () => {
  const html = compileWd([
    ":form into profile",
    ":checkbox services",
    "- Crowns & bridges",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    html,
    /<input type="checkbox" name="services" value="Crowns &amp; bridges"> Crowns &amp; bridges<\/label>/
  );
});

test(":checkbox with no options is a clear compile error", () => {
  assert.throws(
    () => compileWd([":form into profile", ":checkbox interests", ':submit "Go"', ":endform"]),
    /:checkbox.*option/i
  );
});

// ---------------------------------------------------------------------------
// :radio — single-select group, scalar capture (no data-wd-multi)
// ---------------------------------------------------------------------------

test(":radio renders a labelled radio group with no array marker", () => {
  const html = compileWd([
    ":form into profile",
    ":radio contact-pref",
    "- Email",
    "- Phone",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(
    html,
    /<div class="wd-radios" role="radiogroup" aria-label="Contact pref"><label><input type="radio" name="contact-pref" value="Email"> Email<\/label><label><input type="radio" name="contact-pref" value="Phone"> Phone<\/label><\/div>/
  );
  assert.doesNotMatch(html, /data-wd-multi/);
});

test(":radio required marks the group required", () => {
  const html = compileWd([
    ":form into profile",
    ":radio plan required",
    "- Basic",
    "- Pro",
    ':submit "Go"',
    ":endform"
  ]);
  assert.match(html, /<input type="radio" name="plan" value="Basic" required>/);
});

test(":checkbox honors an explicit aria-label over the humanized name", () => {
  const html = compileWd([
    ":form into profile",
    ':checkbox interests aria-label="Your interests"',
    "- A",
    ':submit "Go"',
    ":endform"
  ]);
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Your interests"]);
});
