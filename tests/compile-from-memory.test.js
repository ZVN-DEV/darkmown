// The fs-free compile path (`compileFromMemory`) must be a faithful mirror of
// the on-disk compile: same HTML, includes resolving inside the in-memory map,
// and the same `file:line` compile errors. These tests build a small fixture on
// disk, then compile it BOTH ways (fs reader vs memory map of the same files)
// and assert parity — the golden the strategic vfs refactor rests on.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { memoryReader } from "../src/compiler/reader.js";
import { compileFromMemory, compilePage, enhanceImages } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

/** Fixture files, keyed by project-relative POSIX path. */
const FIXTURE = {
  "site/_/nav.wd": `---
html: true
---
<nav class="topnav"><a href="/">Home</a></nav>
`,
  "site/_/note.md": `A shared **markdown** note included from the shelf.
`,
  "site/pages/index.skin": `page
  color: #111

.topnav a
  color: #06c
`,
  "site/pages/index.wd": `---
title: Memory Fixture
html: true
---
@include /nav.wd

# { meta.title }

@include /note.md

:state count = 0

The count is { count }.

:button "Add one" -> count++

:state items = [{"name":"Alpha"},{"name":"Beta"}]

@loop items into it
- { it.name }
@endloop
`
};

/**
 * Write the fixture to a fresh temp dir and return its root.
 * @param {Record<string, string>} files
 * @returns {string}
 */
function writeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mem-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test("compileFromMemory matches the on-disk fs compile byte-for-byte", () => {
  const root = writeFixture(FIXTURE);
  const context = createPaths(root);
  const fsResult = compilePage(path.join(root, "site/pages/index.wd"), context);
  // Same files, but supplied as an in-memory map keyed the same way, compiled
  // through the fs-free path (cwd = the same root so absolute paths align).
  const memResult = compileFromMemory(FIXTURE, "site/pages/index.wd", { cwd: root });

  assert.equal(memResult.html, fsResult.html, "HTML must be identical across fs and memory");
  assert.equal(memResult.assets.runtime, fsResult.assets.runtime);
  assert.deepEqual([...memResult.assets.skins], [...fsResult.assets.skins]);
  // The include actually resolved from the map (its markup is present).
  assert.match(memResult.html, /<nav class="topnav"><a href="\/">Home<\/a><\/nav>/);
  assert.match(memResult.html, /shared <strong>markdown<\/strong> note/);
  // The reactive loop + state seed made it through.
  assert.match(memResult.html, /data-wd-loop=/);
  assert.match(memResult.html, /Alpha/);
  assert.equal(memResult.assets.runtime, true);
});

test("compileFromMemory accepts a Map as well as an object", () => {
  const root = writeFixture(FIXTURE);
  const asMap = new Map(Object.entries(FIXTURE));
  const fromObject = compileFromMemory(FIXTURE, "site/pages/index.wd", { cwd: root });
  const fromMap = compileFromMemory(asMap, "site/pages/index.wd", { cwd: root });
  assert.equal(fromMap.html, fromObject.html);
});

test("compile errors keep file:line in the memory path", () => {
  const files = {
    "site/pages/bad.wd": `---
title: Bad
---
@loop into
@endloop
`
  };
  assert.throws(
    () => compileFromMemory(files, "site/pages/bad.wd"),
    /bad\.wd:4/,
    "a malformed @loop must still report file:line"
  );
});

test("an @include missing from the map is reported as unresolved", () => {
  const files = {
    "site/pages/index.wd": `---
title: X
---
@include /does-not-exist.wd
`
  };
  assert.throws(
    () => compileFromMemory(files, "site/pages/index.wd"),
    /Could not resolve include "\/does-not-exist\.wd"/
  );
});

test("memoryReader reports existence and throws ENOENT-style on a missing read", () => {
  const reader = memoryReader({ "site/pages/a.wd": "hi" }, "/");
  assert.equal(reader.exists("/site/pages/a.wd"), true);
  assert.equal(reader.exists("/site/pages/missing.wd"), false);
  assert.equal(reader.readText("/site/pages/a.wd"), "hi");
  assert.throws(() => reader.readText("/site/pages/missing.wd"), /no in-memory file/);
  assert.throws(() => reader.readBinary("/site/pages/a.wd"), /binary reads are unsupported/);
  assert.equal(reader.realpath("/site/pages/a.wd"), "/site/pages/a.wd");
});

test("memoryReader resolves POSIX-identically regardless of host platform", () => {
  // An in-memory compile has no real filesystem, so the same file map must
  // resolve the same way everywhere: the browser playground and a mobile host
  // have no drive letters. Using the host `path` meant that on Windows
  // `path.resolve("/site/pages/a.wd")` returned `D:\site\pages\a.wd`, so keys
  // missed and realpath (the include-cycle key) was host-specific.
  const reader = memoryReader({ "site/pages/a.wd": "hi" }, "/");
  // Windows-style separators map onto the same POSIX key.
  assert.equal(reader.exists("\\site\\pages\\a.wd"), true);
  assert.equal(reader.readText("\\site\\pages\\a.wd"), "hi");
  // realpath never leaks a host drive letter or backslash.
  const real = reader.realpath("/site/pages/a.wd");
  assert.equal(real, "/site/pages/a.wd");
  assert.ok(!real.includes("\\"), `realpath leaked a backslash: ${real}`);
  assert.ok(!/^[A-Za-z]:/.test(real), `realpath leaked a drive letter: ${real}`);
});

test("a local <img> degrades to no dimensions in the memory path (no fs image read)", () => {
  const files = {
    "site/pages/pic.wd": `---
title: Pic
html: true
---
<main>
<img src="/logo.png" alt="logo">
</main>
`
  };
  const result = compileFromMemory(files, "site/pages/pic.wd");
  // measureImage's readBinary throws in memory, is caught, and no width/height
  // is stamped — but decoding/fetchpriority hardening still applies.
  assert.doesNotMatch(result.html, /<img[^>]*\swidth=/);
  assert.match(result.html, /<img[^>]*decoding="async"/);
});

test("the barrel enhanceImages hardens <img> with the default fs reader", () => {
  const paths = createPaths(os.tmpdir());
  // A remote image needs no fs read, so it exercises the fs-default wrapper
  // without touching disk: hardening still adds decoding + fetchpriority.
  const html = enhanceImages('<img src="https://example.com/a.png" alt="a">', paths);
  assert.match(html, /decoding="async"/);
  assert.match(html, /fetchpriority="high"/);
});
