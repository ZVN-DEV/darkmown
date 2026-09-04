// `tools.validate()` reporting: skins, and the non-fatal WARNING class.
//
// Warnings are the framework's silent-failure surface — a directive that will
// render as literal text, `.wd` syntax sitting in a `.md` file, frontmatter that
// forgot its opening `---`. None of them fail the compile, so a model looking
// only at `ok` sees a green build and ships the broken page. `validate`'s TEXT
// is the surface an agent actually reads, so the count belongs in its first
// line, ahead of everything else.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { validate } from "../src/tools/index.js";

const ENTRY = "site/pages/index.wd";

test("validate counts skins from the asset SET, not from Object.keys on it", () => {
  // `assets.skins` is a Set. `Object.keys(set)` is always `[]`, so this
  // reported "0 skins" for every page that had one — including the page whose
  // whole point was the colocated skin.
  const withSkin = validate(
    {
      [ENTRY]: "---\ntitle: Home\n---\n\n# Home\n",
      "site/pages/index.skin": "page\n  color #222\n"
    },
    ENTRY
  );
  assert.equal(withSkin.ok, true);
  assert.equal(withSkin.data.skins, 1);
  assert.match(withSkin.text, /1 skin\b/);
  assert.doesNotMatch(withSkin.text, /0 skins/);

  const bare = validate({ [ENTRY]: "---\ntitle: Home\n---\n\n# Home\n" }, ENTRY);
  assert.equal(bare.data.skins, 0);
  assert.match(bare.text, /0 skins/);
});

test("a clean compile still says plainly that it compiled", () => {
  const r = validate({ [ENTRY]: "---\ntitle: Home\n---\n\n# Home\n" }, ENTRY);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.warnings, []);
  assert.equal(r.text.split("\n")[0], "compiles. static (ships zero JavaScript), 0 skins.");
});

test("one warning is counted in the headline and listed under it, with ok still true", () => {
  // `:State` is a real directive mis-cased — it matches nothing and renders as
  // literal text, which is exactly the failure a model cannot see in the HTML.
  const r = validate({ [ENTRY]: "---\ntitle: Home\n---\n\n:State count = 0\n" }, ENTRY);

  assert.equal(r.ok, true, "a warning is not an error");
  assert.equal(r.data.warnings.length, 1);
  const [headline, ...rest] = r.text.split("\n");
  assert.match(headline, /^compiles with 1 warning\./, `headline was: ${headline}`);
  assert.match(headline, /static \(ships zero JavaScript\)/, "the facts are still reported");
  assert.deepEqual(rest, [`- ${r.data.warnings[0]}`]);
  assert.match(r.text, /":State" looks like a directive but matches none/);
});

test("several warnings are pluralised, counted, and every one is listed", () => {
  const r = validate(
    { [ENTRY]: "---\ntitle: Home\n---\n\n:State count = 0\n\n:Button go\n\n@Loop x into y\n" },
    ENTRY
  );

  assert.equal(r.ok, true);
  assert.equal(r.data.warnings.length, 3);
  assert.match(r.text.split("\n")[0], /^compiles with 3 warnings\./);
  for (const warning of r.data.warnings) assert.ok(r.text.includes(`- ${warning}`), warning);
  assert.equal(r.text.split("\n").length, 4, "one headline plus one line per warning");
});

test("a .md file carrying .wd syntax warns through validate too", () => {
  const md = "site/pages/notes.md";
  const r = validate({ [md]: "---\ntitle: Notes\n---\n\n@loop items into i\n" }, md);
  assert.equal(r.ok, true);
  assert.match(r.text, /^compiles with 1 warning\./);
  assert.match(r.text, /rename the file to \.wd to activate it/);
});

// ---------------------------------------------------------------------------
// `darkmown build` surfaces the same warnings, in its own hint vocabulary.
// ---------------------------------------------------------------------------

test("a build prints every page warning as a hint, once per distinct warning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-build-warn-"));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write("site/pages/index.wd", "---\ntitle: Home\n---\n\n:State count = 0\n");
  write("site/pages/about.wd", "---\ntitle: About\n---\n\n:Button go\n");

  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    buildSite(root);
  } finally {
    console.warn = original;
  }

  const hints = warns.filter((warn) => /looks like a directive but matches none/.test(warn));
  assert.equal(hints.length, 2, `one hint per page warning: ${JSON.stringify(warns)}`);
  for (const hint of hints) assert.match(hint, /^hint: /, "warnings use the build's hint prefix");
  assert.ok(hints.some((hint) => hint.includes(":State")));
  assert.ok(hints.some((hint) => hint.includes(":Button")));
});
