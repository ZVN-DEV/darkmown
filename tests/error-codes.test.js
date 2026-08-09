import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { directiveCatalog } from "../src/catalog.js";
import {
  ACTION_EXAMPLE,
  BUTTON_EXAMPLE,
  EFFECT_EXAMPLE,
  EVERY_EXAMPLE
} from "../src/compiler/actions.js";
import { FETCH_EXAMPLE } from "../src/compiler/fetch.js";
import {
  BIND_EXAMPLE,
  CHECKBOX_EXAMPLE,
  FORM_EXAMPLE,
  INPUT_EXAMPLE,
  RADIO_EXAMPLE,
  SELECT_EXAMPLE,
  SLIDER_EXAMPLE,
  SUBMIT_EXAMPLE,
  TEXTAREA_EXAMPLE
} from "../src/compiler/forms.js";
import { LOOP_EXAMPLE } from "../src/compiler/loops.js";
import { AUDIO_EXAMPLE, EMBED_EXAMPLE, VIDEO_EXAMPLE } from "../src/compiler/media.js";
import {
  COMPUTED_EXAMPLE,
  STATE_EXAMPLE,
  STORE_EXAMPLE,
  THEME_EXAMPLE
} from "../src/compiler/state.js";
import {
  CAROUSEL_EXAMPLE,
  CONTAINER_EXAMPLE,
  IF_EXAMPLE,
  INCLUDE_EXAMPLE
} from "../src/compiler/structure.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import {
  ERROR_AREAS,
  errorCatalog,
  errorForCode,
  errorsMarkdown,
  RETIRED_CODES
} from "../src/errors.js";
import { compileSkin } from "../src/skin.js";

// ---------------------------------------------------------------------------
// The drift guard for the stable `WDxxx` compile-error codes.
//
// Codes are a public contract: users search them, docs/errors.md documents them,
// and `directiveCatalog().errors` publishes them. This suite is what makes that
// contract hold mechanically rather than by discipline:
//
//   1. every code thrown in src/ is registered, and every registered code is
//      thrown somewhere (no ghosts in either direction),
//   2. a code's number matches the subsystem block of the file it lives in,
//   3. no author-facing throw can bypass `wdError` (and therefore a code),
//   4. every registered code is documented, and docs/errors.md is in sync,
//   5. real compiled errors carry the `[WDxxx]` prefix AND `err.wd.code`.
// ---------------------------------------------------------------------------

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Every `src/**\/*.js` path, relative to `src/`, POSIX-separated. */
function srcFiles(dir = srcDir, prefix = "") {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...srcFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".js")) found.push(rel);
  }
  return found.sort();
}

const SOURCES = new Map(
  srcFiles().map((rel) => [rel, fs.readFileSync(path.join(srcDir, rel), "utf8")])
);

/** Files exempt from the code scan, each for a stated reason. */
const NOT_SCANNED = {
  "runtime.js":
    "browser reactive core: it renders compiled output and never authors compile errors",
  "errors.js": "the registry itself: it lists every code as data",
  "cli.js": "CLI argument failures use CliError, which the CLI prints without a stack",
  "api-runner.js": "request-time handler-contract TypeErrors, not compile-time authoring errors"
};

// Files whose remaining plain `throw new Error` calls are INTERNAL invariants:
// a throw there means Darkmown itself is broken, not that a page is malformed,
// so there is nothing for an author to look up.
const INTERNAL_INVARIANTS = {
  "compiler/expr-ast.js": "re-parses the compiler's own already-validated expression output",
  "compiler/reader.js": "guards the host Reader contract behind compileFromMemory"
};

// Author-facing throws that are NOT yet routed through `wdError`, with the code
// reserved for each. This list must shrink to empty; it exists only because the
// file is owned by a parallel change and must not be edited from here.
const PENDING_CODES = {
  "compiler/page.js": "WD612 (include cycle) — page.js is owned by another track"
};

/** The subsystem block (hundreds digit) each source file's codes must fall in. */
const FILE_BLOCK = {
  "compiler/frontmatter.js": 0,
  "compiler/interpolation.js": 0,
  "compiler/markdown.js": 0,
  "compiler/format.js": 0,
  "compiler/body.js": 0,
  "compiler/loops.js": 1,
  "compiler/collections.js": 1,
  "compiler/state.js": 2,
  "compiler/predicates.js": 2,
  "compiler/actions.js": 3,
  "compiler/forms.js": 4,
  "compiler/fetch.js": 5,
  "compiler/includes.js": 6,
  "compiler/structure.js": 6,
  "compiler/media.js": 7,
  "skin.js": 8,
  "router.js": 9,
  "scaffold.js": 9,
  "deploy.js": 9
};

/** code → the src files that throw it. */
function codesInSource() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  for (const [rel, source] of SOURCES) {
    if (rel in NOT_SCANNED) continue;
    for (const match of source.matchAll(/code:\s*"(WD\d{3})"/g)) {
      const files = found.get(match[1]) ?? [];
      if (!files.includes(rel)) files.push(rel);
      found.set(match[1], files);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. The registry is internally sound.
// ---------------------------------------------------------------------------

test("every registered code is well-formed, unique, and in ascending order", () => {
  const entries = errorCatalog();
  assert.ok(entries.length > 100, `expected a full registry, got ${entries.length} entries`);
  const seen = new Set();
  let previous = "";
  for (const entry of entries) {
    assert.match(entry.code, /^WD\d{3}$/, `bad code shape: ${entry.code}`);
    assert.ok(!seen.has(entry.code), `duplicate code in the registry: ${entry.code}`);
    seen.add(entry.code);
    assert.ok(entry.code > previous, `registry is out of order at ${entry.code}`);
    previous = entry.code;
  }
});

test("every registered code is documented (title, cause, fix) and in a real area", () => {
  const areas = new Set(ERROR_AREAS.map((area) => area.name));
  for (const entry of errorCatalog()) {
    for (const [field, minimum] of [
      ["title", 5],
      ["cause", 20],
      ["fix", 20]
    ]) {
      assert.ok(
        typeof entry[field] === "string" && entry[field].trim().length >= minimum,
        `${entry.code} has no meaningful ${field}`
      );
    }
    assert.ok(areas.has(entry.area), `${entry.code} has unknown area "${entry.area}"`);
    assert.equal(
      entry.area,
      ERROR_AREAS[Number(entry.code[2])].name,
      `${entry.code} area mismatch`
    );
  }
});

test("documented examples are drawn from the compiler's own example constants", () => {
  // Same guarantee the directive catalog gives: a documented example is never
  // hand-typed prose, it is the exact constant an error hint already ships, so
  // it compiles for as long as the directive does.
  const constants = new Set([
    ACTION_EXAMPLE,
    AUDIO_EXAMPLE,
    BIND_EXAMPLE,
    BUTTON_EXAMPLE,
    CAROUSEL_EXAMPLE,
    CHECKBOX_EXAMPLE,
    COMPUTED_EXAMPLE,
    CONTAINER_EXAMPLE,
    EFFECT_EXAMPLE,
    EMBED_EXAMPLE,
    EVERY_EXAMPLE,
    FETCH_EXAMPLE,
    FORM_EXAMPLE,
    IF_EXAMPLE,
    INCLUDE_EXAMPLE,
    INPUT_EXAMPLE,
    LOOP_EXAMPLE,
    RADIO_EXAMPLE,
    SELECT_EXAMPLE,
    SLIDER_EXAMPLE,
    STATE_EXAMPLE,
    STORE_EXAMPLE,
    SUBMIT_EXAMPLE,
    TEXTAREA_EXAMPLE,
    THEME_EXAMPLE,
    VIDEO_EXAMPLE
  ]);
  for (const entry of errorCatalog()) {
    if (!entry.example) continue;
    assert.ok(
      constants.has(entry.example),
      `${entry.code} documents a hand-written example that can rot: ${entry.example}`
    );
  }
});

test("a retired code is never reused by a live one", () => {
  const live = new Set(errorCatalog().map((entry) => entry.code));
  for (const code of RETIRED_CODES) {
    assert.ok(!live.has(code), `retired code ${code} was reused — codes are permanent`);
  }
});

test("errorForCode looks a code up, and misses cleanly", () => {
  assert.equal(errorForCode("WD201")?.title, "Malformed `:state`");
  assert.equal(errorForCode("WD000"), undefined);
});

// ---------------------------------------------------------------------------
// 2. The registry and the source cannot drift apart.
// ---------------------------------------------------------------------------

test("every code thrown in src/ is registered, and every registered code is thrown", () => {
  const thrown = codesInSource();
  const registered = new Set(errorCatalog().map((entry) => entry.code));

  for (const [code, files] of thrown) {
    assert.ok(
      registered.has(code),
      `${code} is thrown in ${files.join(", ")} but is not registered in src/errors.js`
    );
  }
  for (const code of registered) {
    assert.ok(
      thrown.has(code),
      `${code} is registered but nothing throws it — remove it, or retire it in RETIRED_CODES`
    );
  }
});

test("each code's number matches the subsystem block of the file that throws it", () => {
  for (const [code, files] of codesInSource()) {
    for (const rel of files) {
      const block = FILE_BLOCK[rel];
      assert.notEqual(
        block,
        undefined,
        `${rel} throws ${code} but has no subsystem block — add it to FILE_BLOCK`
      );
      assert.equal(
        Number(code[2]),
        block,
        `${code} is thrown from ${rel}, which belongs to the WD${block}xx block`
      );
    }
  }
});

test("no author-facing throw bypasses wdError (and therefore a code)", () => {
  const offenders = [];
  for (const [rel, source] of SOURCES) {
    if (rel in NOT_SCANNED || rel in INTERNAL_INVARIANTS || rel in PENDING_CODES) continue;
    if (/throw new (?:Error|TypeError)\(/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files throw a plain Error: route it through wdError with a code, or document it as an internal invariant`
  );
});

test("the internal-invariant and pending allowlists still describe reality", () => {
  // Both lists are escape hatches, so they must stay honest: an entry that no
  // longer throws a plain Error has to be deleted, not left to rot.
  for (const rel of [...Object.keys(INTERNAL_INVARIANTS), ...Object.keys(PENDING_CODES)]) {
    const source = SOURCES.get(rel);
    assert.ok(source, `${rel} is allowlisted but does not exist`);
    assert.match(
      source,
      /throw new Error\(/,
      `${rel} no longer throws a plain Error — drop it from the allowlist`
    );
  }
  // The pending list is temporary by construction; keep it visible and small.
  assert.deepEqual(Object.keys(PENDING_CODES), ["compiler/page.js"]);
});

// ---------------------------------------------------------------------------
// 3. The generated docs and the machine-readable catalog stay in sync.
// ---------------------------------------------------------------------------

test("docs/errors.md is the generated registry (run: node scripts/gen-errors.mjs)", () => {
  const committed = fs.readFileSync(path.join(repoRoot, "docs/errors.md"), "utf8");
  assert.equal(committed, errorsMarkdown(), "docs/errors.md is stale");
});

test("docs/errors.md documents every registered code", () => {
  const doc = fs.readFileSync(path.join(repoRoot, "docs/errors.md"), "utf8");
  for (const entry of errorCatalog()) {
    assert.ok(doc.includes(`\`${entry.code}\``), `docs/errors.md is missing ${entry.code}`);
  }
});

test("the directive catalog publishes the error codes and their areas", () => {
  const cat = directiveCatalog();
  assert.deepEqual(
    cat.errors.map((entry) => entry.code),
    errorCatalog().map((entry) => entry.code)
  );
  assert.deepEqual(
    cat.errorAreas.map((area) => area.range),
    ERROR_AREAS.map((area) => area.range)
  );
});

// ---------------------------------------------------------------------------
// 4. Real thrown errors carry the code, in the message and on `err.wd`.
// ---------------------------------------------------------------------------

function project(source, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-codes-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), source);
  return root;
}

/** Compile `source` and return the Error it throws. */
function thrownBy(source, files) {
  const root = project(source, files);
  let err;
  try {
    compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } catch (e) {
    err = e;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(err, `expected "${source}" to throw`);
  return err;
}

test("a real compile error prefixes its message with the code and mirrors it on err.wd", () => {
  const err = thrownBy(":state x");
  assert.equal(err.wd.code, "WD201");
  assert.ok(err.message.startsWith("[WD201] "), `message lost its code: ${err.message}`);
  // The code is additive: the file:line, the Use: hint, and the concrete example
  // all survive ahead of and behind it, exactly as before.
  assert.match(err.message, /\[WD201\] Malformed :state in .*index\.wd:1: :state x\./);
  assert.match(err.message, / — e\.g\. :state count = 0$/);
  assert.equal(err.wd.example, ":state count = 0");
  assert.equal(err.wd.line, 1);
});

test("one error per subsystem block carries the right code end to end", () => {
  const cases = [
    { code: "WD001", source: "---\ntitle: T\n" },
    { code: "WD015", source: ":state open = true\n:if open\nyes\n" },
    { code: "WD101", source: "@loop bad\n@endloop" },
    { code: "WD204", source: ":state a = 1\n:state a = 2" },
    { code: "WD311", source: ':state x = 0\n:button "Go" -> x.push(1)' },
    { code: "WD402", source: ":input " },
    { code: "WD501", source: ":fetch bad" },
    { code: "WD602", source: "@include /nope.wd" },
    { code: "WD704", source: ":embed " }
  ];
  for (const { code, source } of cases) {
    const err = thrownBy(source);
    assert.equal(err.wd.code, code, `wrong code for:\n${source}\n${err.message}`);
    assert.ok(err.message.startsWith(`[${code}] `), `missing prefix: ${err.message}`);
    assert.ok(errorForCode(code), `${code} is not registered`);
  }
});

test("a skin error carries its code with no file (compileSkin knows no paths)", () => {
  let err;
  try {
    compileSkin("card\n  color red\nscoped\n", { scope: "wd-abcd" });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected a scoped-skin error");
  assert.equal(err.wd.code, "WD801");
  assert.equal(err.wd.file, undefined);
  assert.ok(err.message.startsWith("[WD801] "));
});
