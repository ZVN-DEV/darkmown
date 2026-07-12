import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The human-readable runtime size ("~7.5 KB") is quoted in marketing/docs prose in
// several places. It must never drift from the ACTUAL shipped size, which has one
// source of truth: `.size-snapshot.json`'s `runtime.gzip` (the same file that owns
// the CI budget — see size.test.js). This guard derives the human figure from that
// number and asserts every PRESENT-TENSE size claim in the docs matches it, so a
// runtime that grows/shrinks can't leave the copy saying an old number.
const snapshot = JSON.parse(readFileSync(".size-snapshot.json", "utf8"));
const gzip = snapshot.runtime.gzip;

// Same rounding the prose uses: bytes → "~N.N KB" (e.g. 7518 → "~7.5 KB").
const EXPECTED = `~${(gzip / 1000).toFixed(1)} KB`;

// Files whose present-tense size claims must track the snapshot.
const FILES = [
  "README.md",
  "docs/spec-alignment.md",
  "site/pages/index.wd",
  "site/pages/docs/index.wd",
  "site/pages/app.wd",
  "site/pages/showcase/index.wd",
  "site/pages/blog/zero-js-by-default.md",
  "site/_/footer.wd",
  "AGENTS.md",
  "CLAUDE.md"
];

// Any `~N.N KB` token — matches both the current figure and any stale/historical
// one, including the `&nbsp;` spelling used in inline-HTML prose.
const SIZE_CLAIM = /~\d+\.\d+(?:\s|&nbsp;)?KB/g;

// HISTORICAL lines: version-history / changelog-style prose that deliberately records
// an OLD runtime size (e.g. "the runtime moved from ~5.8 KB to ~7.4 KB"). These are a
// record of what shipped at a past version and must NOT be rewritten to the current
// figure — allowlisted by a distinctive phrase so edits above them don't shift line
// numbers. All live in the spec-alignment stage-notes today.
const HISTORICAL_PHRASES = [
  "the runtime moved from", // 1.0 entry: ~5.8 KB → ~7.4 KB
  "shipped runtime stays", //  :checkbox/:radio note: stays ~5.8 KB
  "reactive runtime grew to" // Stage 9 note: grew to ~5.7 KB
];

test("every present-tense runtime-size claim in docs matches .size-snapshot.json", () => {
  assert.match(EXPECTED, /^~\d+\.\d+ KB$/, `derived figure looks wrong: ${EXPECTED}`);

  let checked = 0;
  const usedPhrases = new Set();

  for (const file of FILES) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const matches = line.match(SIZE_CLAIM);
      if (!matches) return;

      const historical = HISTORICAL_PHRASES.find((p) => line.includes(p));
      if (historical) {
        usedPhrases.add(historical);
        return;
      }

      for (const claim of matches) {
        checked += 1;
        assert.equal(
          claim.replace(/&nbsp;/g, " ").replace(/\s/g, " "),
          EXPECTED,
          `${file}:${i + 1} — size claim "${claim}" drifted from the snapshot (${gzip} B ⇒ "${EXPECTED}"). ` +
            `Update the prose, or if this is version history, allowlist its line in size-prose.test.js.\n  ${line.trim()}`
        );
      }
    });
  }

  // The guard is only meaningful if it actually inspected present-tense claims —
  // a regex/rename that silently matched nothing must fail, not pass green.
  assert.ok(
    checked > 0,
    "found no present-tense size claims to check — the scan or file list is broken"
  );

  // Every allowlisted historical phrase must still match a real line; a stale
  // allowlist entry means the exclusion is dead and should be pruned.
  for (const phrase of HISTORICAL_PHRASES) {
    assert.ok(
      usedPhrases.has(phrase),
      `historical allowlist phrase "${phrase}" matched no line — prune it from size-prose.test.js`
    );
  }

  console.log(
    `size-prose: ${checked} present-tense claim(s) verified as "${EXPECTED}" (runtime ${gzip} B gzipped)`
  );
});
