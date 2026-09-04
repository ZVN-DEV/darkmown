import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  formatDelta,
  measureFile,
  scoreItem,
  unbudgetedBehaviors
} from "../scripts/size-check.mjs";

// ---------------------------------------------------------------------------
// The size gate's own gate. `scripts/size-check.mjs` is the ONLY thing standing
// between a runtime regression and a release (the 8 KB ceiling is a brand
// promise), and Wave 2 spends against a 538-byte headroom — so its arithmetic
// and its failure conditions are tested rather than assumed.
//
// Everything here is synthetic. No build runs, and `.size-snapshot.json` is
// read only to assert the shipped snapshot is internally consistent.
// ---------------------------------------------------------------------------

const snapshot = JSON.parse(
  fs.readFileSync(new URL("../.size-snapshot.json", import.meta.url), "utf8")
);

// --- the budget is a ceiling, not a seat ----------------------------------

test("a size that REACHES its budget is a breach, not a pass", () => {
  const under = scoreItem("runtime", 8191, 8192, 7654);
  assert.equal(under.failed, false);

  const at = scoreItem("runtime", 8192, 8192, 7654);
  assert.equal(at.failed, true, "sitting exactly on the budget must fail");
  assert.match(at.error, /reached the 8192 B budget/);

  const over = scoreItem("runtime", 9000, 8192, 7654);
  assert.equal(over.failed, true);
  assert.match(over.error, /runtime 9000 B/);
});

test("a behavior breach fails the same way the runtime does", () => {
  // The audit's concern for Wave 2: behaviors must not be a soft budget.
  const item = scoreItem("behavior sortable", 2048, 2048, 1541);
  assert.equal(item.failed, true);
  assert.match(item.error, /behavior sortable 2048 B reached the 2048 B budget/);
});

// --- per-item deltas -------------------------------------------------------

test("every item prints a signed delta against its snapshot baseline", () => {
  assert.equal(formatDelta(7700, 7654), "+46 vs snapshot");
  assert.equal(formatDelta(7600, 7654), "-54 vs snapshot");
  assert.equal(formatDelta(7654, 7654), "+0 vs snapshot");
  assert.equal(formatDelta(1234, undefined), "no snapshot");

  // The delta must reach the printed line — that line is the whole point of the
  // script in a PR diff.
  const { line } = scoreItem("behavior carousel", 1400, 2048, 1380);
  assert.equal(line, "behavior carousel: 1400 B (+20 vs snapshot, budget 2048)");
});

// --- an unbudgeted behavior module fails ----------------------------------

test("a behavior module with no snapshot entry fails the gate and is named", () => {
  const unbudgeted = unbudgetedBehaviors(
    {
      sortable: { file: "src/behaviors/sortable.js" },
      carousel: { file: "src/behaviors/carousel.js" }
    },
    ["src/behaviors/sortable.js", "src/behaviors/carousel.js", "src/behaviors/tooltip.js"]
  );
  assert.deepEqual(unbudgeted, ["src/behaviors/tooltip.js"]);
});

test("the shipped tree has no unbudgeted behavior module", () => {
  const dir = fileURLToPath(new URL("../src/behaviors", import.meta.url));
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => `src/behaviors/${f}`);
  assert.ok(onDisk.length > 0, "no behavior modules found — the scan is broken");
  assert.deepEqual(
    unbudgetedBehaviors(snapshot.behaviors, onDisk),
    [],
    "a behavior module ships with no size budget"
  );
});

test("Windows-style snapshot paths still match POSIX paths on disk", () => {
  // `.size-snapshot.json` is authored with `/`; a path normalised the other way
  // must not read as unbudgeted.
  assert.deepEqual(
    unbudgetedBehaviors({ sortable: { file: "src\\behaviors\\sortable.js" } }, [
      "src/behaviors/sortable.js"
    ]),
    []
  );
});

// --- measurement matches what ships ---------------------------------------

test("measureFile gzips the comment-stripped source for behaviors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-size-"));
  const file = path.join(dir, "b.js");
  const body = "export function go() {\n  return 1;\n}\n";
  const comment = `/**\n * ${"A very long JSDoc block that compresses on its own. ".repeat(20)}\n */\n`;
  fs.writeFileSync(file, comment + body);
  try {
    const stripped = measureFile(file, true);
    const raw = measureFile(file, false);
    assert.ok(stripped < raw, "stripping comments must shrink the measured size");
    // …and the raw path really is a plain gzip of the bytes on disk.
    assert.equal(raw, gzipSync(fs.readFileSync(file)).length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the snapshot itself stays coherent ------------------------------------

test(".size-snapshot.json baselines are all under their own budgets", () => {
  // A snapshot whose baseline already exceeds its budget would make the gate
  // permanently red (or, worse, be "fixed" by raising the budget silently).
  assert.ok(snapshot.runtime.gzip < snapshot.runtime.budget);
  for (const [name, entry] of Object.entries(snapshot.behaviors)) {
    assert.ok(
      entry.gzip < entry.budget,
      `${name} baseline ${entry.gzip} B is not under its ${entry.budget} B budget`
    );
    assert.equal(typeof entry.file, "string");
  }
});

test("importing the size script does not run it", () => {
  // It reads `dist/` and calls process.exit; importing it in a test must not.
  const source = fs.readFileSync(
    fileURLToPath(new URL("../scripts/size-check.mjs", import.meta.url)),
    "utf8"
  );
  assert.match(
    source,
    /pathToFileURL\(process\.argv\[1\]\)\.href === import\.meta\.url\) main\(\);/
  );
});
