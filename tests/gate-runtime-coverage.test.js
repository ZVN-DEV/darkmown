import assert from "node:assert/strict";
import test from "node:test";
import {
  directLineCoverage,
  gateFailures,
  lineStartOffsets,
  MEASURED,
  mappedLineCoverage,
  parseMappings,
  scoreFile,
  staleSnapshotEntries,
  unionEntryBytes
} from "../scripts/runtime-coverage-gate.mjs";

// ---------------------------------------------------------------------------
// The browser coverage gate's own gate. Everything runs against SYNTHETIC
// coverage entries and hand-encoded sourcemaps — no browser, no e2e run — so
// the merge semantics, the VLQ decoder, and the anti-self-deception rules are
// proven directly. The synthetic sourcemap mappings are produced by a tiny
// VLQ ENCODER below (the mirror of the gate's decoder), so a broken decoder
// cannot pass by agreeing with itself on a canned string.
// ---------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Signed base64-VLQ encoder, the spec mirror of the gate's decoder. */
function encodeVlq(value) {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

/** Encode one mappings segment from its absolute-against-previous delta fields. */
const encodeSegment = (fields) => fields.map(encodeVlq).join("");

/** A coverage entry as Playwright's stopJSCoverage() returns one. */
function entry(source, ranges) {
  return { source, functions: [{ ranges }] };
}

// --- line offsets ------------------------------------------------------------

test("lineStartOffsets marks every line's first byte", () => {
  assert.deepEqual(lineStartOffsets("ab\ncd\n\nxyz"), [0, 3, 6, 7]);
  assert.deepEqual(lineStartOffsets(""), [0]);
});

// --- byte merge semantics ----------------------------------------------------

test("unionEntryBytes: a byte covered in ANY entry is covered", () => {
  const source = "0123456789";
  const a = entry(source, [{ startOffset: 0, endOffset: 5, count: 1 }]);
  const b = entry(source, [{ startOffset: 4, endOffset: 10, count: 1 }]);
  const { inRange, covered } = unionEntryBytes([a, b]);
  for (let i = 0; i < 10; i++) {
    assert.equal(inRange[i], 1, `byte ${i} inside the union of ranges`);
    assert.equal(covered[i], 1, `byte ${i} covered by one entry or the other`);
  }
});

test("unionEntryBytes: a child count=0 carves out its parent — locally only", () => {
  const source = "0123456789";
  // One entry: parent covers 0..10, child at 2..4 never ran → 2,3 NOT covered.
  const ran = entry(source, [
    { startOffset: 0, endOffset: 10, count: 1 },
    { startOffset: 2, endOffset: 4, count: 0 }
  ]);
  const solo = unionEntryBytes([ran]);
  assert.equal(solo.covered[1], 1);
  assert.equal(solo.covered[2], 0, "child range with count 0 resets the parent's byte");
  assert.equal(solo.covered[3], 0);
  assert.equal(solo.covered[4], 1);

  // A second entry that DID run those bytes unions over the carve-out.
  const other = entry(source, [{ startOffset: 2, endOffset: 4, count: 1 }]);
  const merged = unionEntryBytes([ran, other]);
  assert.equal(merged.covered[2], 1, "another entry's execution wins the union");
});

test("unionEntryBytes: flags a source mismatch across entries", () => {
  const a = entry("aaaa", [{ startOffset: 0, endOffset: 4, count: 1 }]);
  const b = entry("bbbb", [{ startOffset: 0, endOffset: 4, count: 1 }]);
  assert.equal(unionEntryBytes([a, b]).sourceMismatch, true);
  assert.equal(unionEntryBytes([a, a]).sourceMismatch, false);
});

// --- direct (served-source) line coverage ------------------------------------

test("directLineCoverage counts executable lines and skips blanks", () => {
  // Lines: "aa" (covered), "" (blank — never executable), "bb" (in range, not run).
  const source = "aa\n\nbb\n";
  const { inRange, covered } = unionEntryBytes([
    entry(source, [
      { startOffset: 0, endOffset: 2, count: 1 },
      { startOffset: 4, endOffset: 6, count: 0 }
    ])
  ]);
  assert.deepEqual(directLineCoverage(source, inRange, covered), { total: 2, hit: 1 });
});

// --- the sourcemap VLQ decoder -----------------------------------------------

test("parseMappings decodes delta-encoded segments to absolute positions", () => {
  // Two generated lines. Line 0: col 0 → src line 0 col 0; col 1 → src 0:1.
  // Line 1: col 0 → src line 1 col 0. Source line/column deltas accumulate
  // ACROSS lines (only the generated column resets), so the last segment's
  // srcCol delta is -1 back from the previous segment's column 1.
  const mappings = `${encodeSegment([0, 0, 0, 0])},${encodeSegment([1, 0, 0, 1])};${encodeSegment([0, 0, 1, -1])}`;
  assert.deepEqual(parseMappings(mappings), [
    { genLine: 0, genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0 },
    { genLine: 0, genCol: 1, srcIndex: 0, srcLine: 0, srcCol: 1 },
    { genLine: 1, genCol: 0, srcIndex: 0, srcLine: 1, srcCol: 0 }
  ]);
});

test("parseMappings handles multi-digit and negative deltas", () => {
  // srcCol jumps by 40 (multi-digit VLQ), then back by 10 (negative delta).
  const mappings = `${encodeSegment([0, 0, 0, 40])},${encodeSegment([5, 0, 0, -10])}`;
  assert.deepEqual(parseMappings(mappings), [
    { genLine: 0, genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 40 },
    { genLine: 0, genCol: 5, srcIndex: 0, srcLine: 0, srcCol: 30 }
  ]);
});

test("parseMappings drops segments with no source position", () => {
  // A 1-field segment (generated column only, e.g. an unmapped run) is skipped.
  const mappings = `${encodeSegment([0])},${encodeSegment([3, 0, 0, 0])}`;
  assert.deepEqual(parseMappings(mappings), [
    { genLine: 0, genCol: 3, srcIndex: 0, srcLine: 0, srcCol: 0 }
  ]);
});

// --- mapped (minified runtime) line coverage ---------------------------------

test("mappedLineCoverage maps executed generated bytes back to source lines", () => {
  const generated = "ab\ncd\n"; // byte 0 on gen line 0, byte 3 on gen line 1
  const original = "x = 1\n\ny = 2\n"; // source lines 0 and 2 are real, line 1 is blank
  const mappings = [
    encodeSegment([0, 0, 0, 0]), // gen 0:0 -> src 0:0
    encodeSegment([1, 0, 2, 0]) // gen 0:1 -> src 2:0
  ].join(",");
  const inRange = new Uint8Array(generated.length);
  const covered = new Uint8Array(generated.length);
  inRange[0] = 1;
  covered[0] = 1; // src line 0 ran
  inRange[1] = 1; // src line 2 in range but never ran
  const result = mappedLineCoverage({ generated, original, mappings, inRange, covered });
  assert.deepEqual(result, { total: 2, hit: 1 });
});

test("mappedLineCoverage ignores blank source lines and unmapped generated bytes", () => {
  const generated = "zz";
  const original = "\n   \nreal = 1\n";
  // The only segment lands on a blank source line → nothing is executable.
  const mappings = encodeSegment([0, 0, 0, 0]);
  const inRange = new Uint8Array([1, 1]);
  const covered = new Uint8Array([1, 1]);
  assert.deepEqual(mappedLineCoverage({ generated, original, mappings, inRange, covered }), {
    total: 0,
    hit: 0
  });
});

// --- scoring + the gate -------------------------------------------------------

test("a file with zero executable lines is UNMEASURED, never 100%", () => {
  const row = scoreFile("/__wd/behaviors/new.js", 0, 0);
  assert.equal(row.unmeasured, true);
  assert.equal(row.pct, null, "0/0 must not resolve to a percentage at all");
});

test("zero coverage entries for a measured file fails the gate by name", () => {
  const report = {
    files: [
      {
        url: "/__wd/runtime.js",
        total: 900,
        hit: 900,
        pct: 100,
        unmeasured: false,
        entries: 4,
        src: "runtime.js"
      },
      {
        url: "/__wd/behaviors/carousel.js",
        total: 0,
        hit: 0,
        pct: null,
        unmeasured: true,
        entries: 0,
        src: "behaviors/carousel.js"
      }
    ]
  };
  const snapshot = {
    files: {
      "/__wd/runtime.js": { threshold: 50 },
      "/__wd/behaviors/carousel.js": { threshold: 30 }
    }
  };
  const failures = gateFailures(report, snapshot);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /behaviors\/carousel\.js/, "the failure names the file");
  assert.match(failures[0], /ZERO coverage entries/, "collection silence is a failure, not a pass");
});

test("a file below its snapshot threshold fails with both numbers", () => {
  const report = {
    files: [
      {
        url: "/__wd/runtime.js",
        total: 1000,
        hit: 400,
        pct: 40,
        unmeasured: false,
        entries: 3,
        src: "runtime.js"
      }
    ]
  };
  const snapshot = { files: { "/__wd/runtime.js": { threshold: 41 } } };
  const failures = gateFailures(report, snapshot);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /40\.00%/);
  assert.match(failures[0], /41%/);
  // At the threshold, the same report passes.
  assert.equal(
    gateFailures(report, { files: { "/__wd/runtime.js": { threshold: 40 } } }).length,
    0
  );
});

test("a measured file with no snapshot threshold fails — the gate cannot silently lose a file", () => {
  const report = {
    files: [
      {
        url: "/__wd/runtime.js",
        total: 100,
        hit: 100,
        pct: 100,
        unmeasured: false,
        entries: 2,
        src: "runtime.js"
      }
    ]
  };
  const failures = gateFailures(report, { files: {} });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no threshold/);
});

test("a stale snapshot entry (a URL the gate does not measure) fails", () => {
  const snapshot = {
    files: {
      "/__wd/runtime.js": { threshold: 50 },
      "/__wd/behaviors/deleted.js": { threshold: 30 }
    }
  };
  assert.deepEqual(staleSnapshotEntries(snapshot.files), ["/__wd/behaviors/deleted.js"]);
  const report = {
    files: [
      {
        url: "/__wd/runtime.js",
        total: 100,
        hit: 100,
        pct: 100,
        unmeasured: false,
        entries: 1,
        src: "runtime.js"
      }
    ]
  };
  const failures = gateFailures(report, snapshot);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /stale/);
});

test("a fully green report passes", () => {
  const report = {
    files: [
      {
        url: "/__wd/runtime.js",
        total: 900,
        hit: 800,
        pct: (800 / 900) * 100,
        unmeasured: false,
        entries: 12,
        src: "runtime.js"
      }
    ]
  };
  const snapshot = { files: { "/__wd/runtime.js": { threshold: 80 } } };
  assert.deepEqual(gateFailures(report, snapshot), []);
});

test("MEASURED declares the runtime (sourcemap) and both behaviors (served-source)", () => {
  assert.equal(MEASURED.get("/__wd/runtime.js")?.via, "sourcemap");
  assert.equal(MEASURED.get("/__wd/behaviors/carousel.js")?.via, "served-source");
  assert.equal(MEASURED.get("/__wd/behaviors/sortable.js")?.via, "served-source");
});
