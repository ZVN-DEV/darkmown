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
  assert.match(html, /<textarea name="notes" placeholder="Your notes" aria-label="Your notes"><\/textarea>/);
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
