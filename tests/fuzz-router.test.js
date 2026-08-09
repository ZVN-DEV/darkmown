// Seeded, deterministic, zero-dependency property / fuzz tests for the ROUTER
// (`src/router.js`).
//
// Strategy
// --------
// Sibling of `tests/fuzz.test.js`, same shape and same rules: a SEEDED
// mulberry32 PRNG (never `Math.random`, so every failure reproduces), thousands
// of generated route strings and randomized page trees on disk, and assertions
// on INVARIANTS rather than on exact output. On failure we print the seed and a
// reproducing input.
//
// The router has two halves worth fuzzing, and they need different tactics.
//
//   A. `outputPathForRoute` is a pure string function guarding the BUILD OUTPUT
//      BOUNDARY. It is defense in depth: today every route comes from
//      `routeFromFile` walking `site/pages`, but the guard exists so a future
//      caller passing an unvetted route cannot make the build write outside
//      `dist/`. That guard has never been fuzzed, so it gets the most attention
//      here:
//
//        CONTAINMENT (the headline property). For an ARBITRARY route string,
//        including hostile ones built from `..`, absolute-looking segments,
//        URL-encoded traversal (`%2e%2e`, `..%2f`), backslashes, NUL bytes,
//        unicode lookalikes (fullwidth dot, fraction slash), RTL overrides, and
//        Windows drive prefixes, the call MUST either throw a real Error or
//        return a path strictly inside the output directory. It must never
//        resolve outside, and it must never return the output directory itself.
//        A prefix sibling (`dist-evil` next to `dist`) counts as outside.
//
//        NORMALIZATION is total and stable: `x`, `/x`, `x/`, and `/x/` all map
//        to the same output path, `/` and `""` both map to the root
//        `index.html`, and repeat calls agree.
//
//   B. `discoverRoutes` walks a real tree, so we generate randomized page trees
//      in a temp directory (same fixture pattern as `tests/router.test.js`) and
//      assert:
//
//        MODEL AGREEMENT. The generator knows, by construction, which files it
//        intended to be routable (page extension, no hidden `.`/`-`/`_` segment,
//        not a draft). Discovery must agree with that model exactly. This is a
//        real oracle, not a restatement of the implementation: the model is
//        written from the documented rules.
//
//        DETERMINISM. Two discoveries over the same tree are identical,
//        ordering included (route order is part of the contract: the list is
//        sorted, and `tests/unit-router.test.js` pins specific orderings).
//
//        WELL-FORMED ROUTES. Every route is leading- and trailing-slashed, has
//        no empty segment, and never exposes a hidden segment.
//
//        NO CLOBBER. Route to output-path mapping is injective across the whole
//        discovered set, and every output path lands inside the build output.
//        Two pages must never be able to write the same `index.html`.
//
//        DUPLICATES ARE LOUD. Whenever two files claim one route (`foo.md` vs
//        `foo.wd`, or `foo.wd` vs `foo/index.md`), discovery throws and the
//        error names BOTH files. Never a silent last-one-wins.
//
// A NOTE ON ERROR TEXT: we assert structural properties of thrown errors only
// (`instanceof Error`, non-empty message, mentions a file path). Error strings
// are being changed in parallel by another track; asserting their wording would
// be a false failure.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRoutes, outputPathForRoute, routeFromFile } from "../src/router.js";

// ---------------------------------------------------------------------------
// Seeded PRNG, identical to tests/fuzz.test.js. Deterministic and reproducible;
// the base seed is fixed so CI is stable, and `WD_FUZZ_SEED` overrides it to
// reproduce a reported failure or widen exploration locally. (Copied rather
// than imported: each fuzz suite stays a self-contained artifact a maintainer
// can run and read on its own, matching the existing file.)
// ---------------------------------------------------------------------------

const BASE_SEED = Number(process.env.WD_FUZZ_SEED) || 0xcc9e2d51;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    float: next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p
  };
}

// ---------------------------------------------------------------------------
// Route-string generators for the containment fuzz.
// ---------------------------------------------------------------------------

// Fragments chosen to attack a path-containment check from every angle we could
// think of: literal traversal, encoded traversal (a decoder somewhere upstream
// would turn these back into `..`), separator confusion, NUL truncation,
// unicode homoglyphs for `.` and `/`, bidi overrides, and Windows path shapes.
const HOSTILE_FRAGMENTS = [
  "..",
  "../..",
  "...",
  "....",
  ".",
  "%2e%2e",
  "%2e%2e%2f",
  "..%2f",
  "..%5c",
  "....//",
  "..;",
  "\\..",
  "..\\",
  "\\",
  "\0",
  "a\0b",
  "\uff0e\uff0e", // fullwidth full stops
  "\u2044", // fraction slash
  "\u2215", // division slash
  "\u202e", // right-to-left override
  "\ufeff", // zero-width no-break space
  "\u0085", // next line
  "~",
  "C:",
  "C:\\Windows",
  "//",
  "///",
  " ",
  "\t",
  "\n",
  "index.html",
  ".git",
  "node_modules",
  "%00",
  "e\u0301", // combining acute, NFD form of é
  "é",
  "a".repeat(80)
];

const BENIGN_SEGMENTS = ["about", "blog", "docs", "a", "b-c", "x_y", "post1", "deep", ""];

function randRoute(rng) {
  const parts = [];
  const n = 1 + rng.int(6);
  for (let i = 0; i < n; i++) {
    parts.push(rng.bool(0.6) ? rng.pick(HOSTILE_FRAGMENTS) : rng.pick(BENIGN_SEGMENTS));
  }
  const joiner = rng.pick(["/", "/", "/", "//", "\\", ""]);
  const lead = rng.bool(0.7) ? "/" : "";
  const tail = rng.bool(0.7) ? "/" : "";
  return `${lead}${parts.join(joiner)}${tail}`;
}

// ---------------------------------------------------------------------------
// Page-tree generators for the discovery fuzz.
// ---------------------------------------------------------------------------

const SEGMENTS = ["about", "blog", "docs", "guide", "a", "b2", "deep-dive", "x-y", "post1", "team"];
const HIDDEN_SEGMENTS = [".secret", "-draft", "_partials", ".git", "_support"];
const NON_PAGE_EXTENSIONS = [".mdx", ".txt", ".skin", ".json", ".png", ".js"];
const PAGE_EXTENSIONS = [".md", ".wd"];

// Content variants and whether each one marks the page a draft. The scalar
// frontmatter parser yields `true` for `draft: true` and the string `"true"` for
// the quoted form, and `isDraft` accepts both, so both count as drafts here.
const CONTENTS = [
  { body: "# Plain page\n\nNo frontmatter at all.\n", draft: false },
  { body: "---\ntitle: Live\n---\n\nShipped.\n", draft: false },
  { body: "---\ntitle: Later\ndraft: true\n---\n\nWIP.\n", draft: true },
  { body: '---\ndraft: "true"\n---\n\nQuoted draft flag.\n', draft: true },
  { body: "---\ntitle: Live\ndraft: false\n---\n\nExplicitly not a draft.\n", draft: false },
  { body: "---\ntitle: Post\ndate: 2026-01-02\n---\n\nDated.\n", draft: false },
  { body: "", draft: false }
];

/**
 * The MODEL: the route a source file is documented to claim, or null when the
 * file is not routable at all. Written from the documented rules (page
 * extension, `.`/`-`/`_` names are hidden forever, a trailing `index` collapses
 * to its directory), NOT from the implementation.
 */
function modelRoute(dirs, base, ext) {
  if (!PAGE_EXTENSIONS.includes(ext)) return null;
  if (dirs.some(isHidden) || isHidden(base)) return null;
  const parts = [...dirs];
  if (base !== "index") parts.push(base);
  return parts.length === 0 ? "/" : `/${parts.join("/")}/`;
}

function isHidden(name) {
  return name.startsWith(".") || name.startsWith("-") || name.startsWith("_");
}

/**
 * Generate a randomized page tree as a list of `{ rel, body, draft, route }`
 * entries. Entries whose route would collide are dropped, so a generated tree
 * always discovers cleanly. Collisions get their own dedicated test below.
 *
 * Names stay lowercase and ASCII-unique on purpose: macOS ships a
 * case-insensitive, unicode-normalizing filesystem, so `About.wd` vs `about.wd`
 * or NFC vs NFD pairs would collide in the FILESYSTEM rather than in the router
 * and would make this suite platform-dependent.
 */
function randTree(rng) {
  const entries = [];
  const takenPaths = new Set();
  const takenRoutes = new Set();
  const wanted = 2 + rng.int(5);

  for (let attempt = 0; attempt < wanted * 3 && entries.length < wanted; attempt++) {
    const dirs = [];
    const depth = rng.int(4);
    for (let d = 0; d < depth; d++) {
      dirs.push(rng.bool(0.15) ? rng.pick(HIDDEN_SEGMENTS) : rng.pick(SEGMENTS));
    }
    const base = rng.bool(0.12)
      ? rng.pick(HIDDEN_SEGMENTS)
      : rng.bool(0.3)
        ? "index"
        : rng.pick(SEGMENTS);
    const ext = rng.bool(0.85) ? rng.pick(PAGE_EXTENSIONS) : rng.pick(NON_PAGE_EXTENSIONS);
    const rel = [...dirs, base + ext].join("/");
    if (takenPaths.has(rel)) continue;

    // Deduplicate on the route the file WOULD claim regardless of draft status,
    // so the tree stays collision-free with and without `includeDrafts`.
    const route = modelRoute(dirs, base, ext);
    if (route !== null) {
      if (takenRoutes.has(route)) continue;
      takenRoutes.add(route);
    }
    takenPaths.add(rel);

    const content = rng.pick(CONTENTS);
    entries.push({ rel, dirs, base, ext, body: content.body, draft: content.draft, route });
  }

  return entries;
}

/** Write a generated tree under `<root>/site/pages` and return that root. */
function writeTree(root, entries) {
  const routesRoot = path.join(root, "site/pages");
  fs.mkdirSync(routesRoot, { recursive: true });
  for (const entry of entries) {
    const abs = path.join(routesRoot, entry.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, entry.body);
  }
  return routesRoot;
}

function describeTree(entries) {
  return entries
    .map(
      (e) => `  ${e.rel}${e.draft ? "  (draft)" : ""}${e.route ? ` -> ${e.route}` : " -> (none)"}`
    )
    .join("\n");
}

function assertErrorish(err, repro) {
  assert.ok(err instanceof Error, repro(`threw a non-Error: ${String(err)}`));
  assert.ok(
    typeof err.message === "string" && err.message.length > 0,
    repro("thrown Error had an empty message")
  );
}

/** A path is contained when it sits strictly BELOW `root`, never at or beside it. */
function isInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved !== resolvedRoot && resolved.startsWith(resolvedRoot + path.sep);
}

// ---------------------------------------------------------------------------
// Test 1: CONTAINMENT. The single most valuable property in this file.
// ---------------------------------------------------------------------------

// Fixed adversarial cases, always run alongside the generated corpus so the
// escape branch can never go unexercised if the generator drifts. The last two
// attack the PREFIX SIBLING case (`dist-evil` starts with `dist`), which a naive
// `startsWith(distRoot)` check without the separator would wave through.
const FIXED_ESCAPES = [
  "/../escape/",
  "/..",
  "..",
  "/blog/../../escape/",
  "/a/b/../../../c/",
  `/../${path.basename("/tmp/wd-fuzz-project/dist")}-evil/`,
  "/../dist-evil/index.html/"
];

test("fuzz: outputPathForRoute never resolves outside the build output directory", () => {
  const CASES = 4000;
  const DIST = path.join("/tmp/wd-fuzz-project", "dist");
  let contained = 0;
  let rejected = 0;

  const check = (route, seed) => {
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (router: containment) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\n` +
      `distRoot: ${DIST}\n` +
      `route: ${JSON.stringify(route)}\n`;

    let out;
    try {
      out = outputPathForRoute(DIST, route);
    } catch (err) {
      assertErrorish(err, repro);
      // A rejection must be stable: the same input rejects again.
      assert.throws(() => outputPathForRoute(DIST, route), repro("rejection was not stable"));
      rejected++;
      return;
    }

    assert.equal(typeof out, "string", repro("returned a non-string path"));
    assert.ok(
      out.endsWith(`${path.sep}index.html`),
      repro(`returned a path that is not an index.html: ${JSON.stringify(out)}`)
    );
    assert.ok(
      isInside(DIST, out),
      repro(`ESCAPED the build output directory: ${JSON.stringify(path.resolve(out))}`)
    );
    assert.equal(out, outputPathForRoute(DIST, route), repro("mapping was not stable"));
    contained++;
  };

  for (const route of FIXED_ESCAPES) check(route, "fixed");
  for (let i = 0; i < CASES; i++) {
    const seed = (BASE_SEED + i) >>> 0;
    check(randRoute(makeRng(seed)), seed);
  }

  // Anti-vacuity: the corpus must exercise BOTH outcomes. All-contained would
  // mean the traversal generator never produced an escape; all-rejected would
  // mean the guard is refusing everything.
  assert.ok(contained > 0, `expected some routes to map inside dist (got ${contained})`);
  assert.ok(rejected > 0, `expected some traversal routes to be rejected (got ${rejected})`);
});

test("fuzz: containment holds for a build output whose sibling shares its name prefix", () => {
  // `/tmp/x/dist` and `/tmp/x/dist-evil`: a prefix check without a trailing
  // separator would consider the sibling "inside". Fuzzed with real traversal.
  const DIST = "/tmp/wd-fuzz-prefix/dist";
  const CASES = 600;
  let rejected = 0;

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x5a5a5a5a) + i) >>> 0;
    const rng = makeRng(seed);
    const suffix = rng.pick(["-evil", "2", "-x/y", "..", "-evil/nested"]);
    const route = `${rng.bool() ? "/" : ""}..${rng.pick(["/", "//"])}dist${suffix}/`;
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (router: prefix sibling) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\nroute: ${JSON.stringify(route)}\n`;

    // The call is the ONLY thing inside the try: an assertion is itself an
    // Error, so asserting inside a catch that accepts Errors would swallow the
    // failure and make this test unable to fail.
    let out;
    let error = null;
    try {
      out = outputPathForRoute(DIST, route);
    } catch (err) {
      error = err;
    }
    if (error) {
      assertErrorish(error, repro);
      rejected++;
    } else {
      assert.ok(isInside(DIST, out), repro(`ESCAPED to ${JSON.stringify(path.resolve(out))}`));
    }
  }

  assert.ok(rejected > 0, `expected prefix-sibling traversal to be rejected (got ${rejected})`);
});

// ---------------------------------------------------------------------------
// Test 2: route-string normalization is total and stable.
// ---------------------------------------------------------------------------

test("fuzz: leading/trailing slash handling is total, stable, and slash-agnostic", () => {
  const CASES = 1500;
  const DIST = "/tmp/wd-fuzz-project/dist";

  for (let i = 0; i < CASES; i++) {
    const seed = ((BASE_SEED ^ 0x3c3c3c3c) + i) >>> 0;
    const rng = makeRng(seed);
    const segments = [];
    const n = 1 + rng.int(4);
    for (let s = 0; s < n; s++) {
      segments.push(rng.pick(BENIGN_SEGMENTS.filter((seg) => seg !== "")));
    }
    const core = segments.join("/");
    const repro = (msg) =>
      `\n\n=== FUZZ INVARIANT VIOLATION (router: normalization) ===\n` +
      `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
      `reason: ${msg}\nsegments: ${JSON.stringify(segments)}\n`;

    // All four slash spellings of the same route are one output path, and that
    // path is exactly the documented mapping.
    const expected = path.join(DIST, ...segments, "index.html");
    for (const spelling of [core, `/${core}`, `${core}/`, `/${core}/`]) {
      assert.equal(
        outputPathForRoute(DIST, spelling),
        expected,
        repro(`spelling ${JSON.stringify(spelling)} did not normalize to ${expected}`)
      );
    }
  }

  // The two spellings of the home route both land on the root index.html.
  const home = path.join(DIST, "index.html");
  assert.equal(outputPathForRoute(DIST, "/"), home);
  assert.equal(outputPathForRoute(DIST, ""), home);
});

// ---------------------------------------------------------------------------
// Test 3: discovery over generated page trees.
// ---------------------------------------------------------------------------

test("fuzz: route discovery agrees with the model, is stable, and never clobbers", () => {
  const TREES = 150;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-router-"));
  const dist = path.join(root, "dist");
  let totalRoutes = 0;
  let totalDrafts = 0;
  let sawHiddenFile = 0;

  try {
    for (let i = 0; i < TREES; i++) {
      const seed = ((BASE_SEED ^ 0x11111111) + i) >>> 0;
      const rng = makeRng(seed);
      const entries = randTree(rng);
      const routesRoot = writeTree(path.join(root, `t${i}`), entries);
      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (router: discovery) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\n` +
        `--- generated tree (under site/pages) ---\n${describeTree(entries)}\n--- end tree ---\n`;

      const discovered = discoverRoutes(routesRoot);
      const withDrafts = discoverRoutes(routesRoot, { includeDrafts: true });

      // Determinism: a second walk of the same tree is byte-identical,
      // ordering included.
      assert.deepEqual(
        discoverRoutes(routesRoot),
        discovered,
        repro("two discoveries of the same tree disagreed")
      );

      // MODEL AGREEMENT: exactly the files the generator intended as routable,
      // minus drafts by default and including them on request.
      const model = entries.filter((e) => e.route !== null);
      assert.deepEqual(
        discovered.map((r) => r.route),
        model
          .filter((e) => !e.draft)
          .map((e) => e.route)
          .sort((a, b) => a.localeCompare(b)),
        repro("discovered routes did not match the model (drafts excluded)")
      );
      assert.deepEqual(
        withDrafts.map((r) => r.route),
        model.map((e) => e.route).sort((a, b) => a.localeCompare(b)),
        repro("discovered routes did not match the model (drafts included)")
      );

      // The default result is always a subset of the includeDrafts result.
      const draftedRoutes = new Set(withDrafts.map((r) => r.route));
      for (const r of discovered) {
        assert.ok(
          draftedRoutes.has(r.route),
          repro(`route ${r.route} vanished with includeDrafts`)
        );
      }
      totalDrafts += withDrafts.length - discovered.length;

      const outputs = new Set();
      for (const r of withDrafts) {
        // Well-formed route strings.
        assert.ok(r.route.startsWith("/"), repro(`route ${JSON.stringify(r.route)} is not rooted`));
        assert.ok(
          r.route.endsWith("/"),
          repro(`route ${JSON.stringify(r.route)} has no trailing slash`)
        );
        assert.ok(
          !r.route.includes("//"),
          repro(`route ${JSON.stringify(r.route)} has an empty segment`)
        );
        for (const segment of r.route.split("/").filter(Boolean)) {
          assert.ok(
            !isHidden(segment),
            repro(`route ${r.route} exposed hidden segment "${segment}"`)
          );
        }

        // The file behind the route is real, is a page, and lives under the root.
        assert.ok(fs.existsSync(r.file), repro(`route ${r.route} points at a missing file`));
        assert.ok(path.isAbsolute(r.file), repro(`route ${r.route} carries a relative file path`));
        assert.ok(
          PAGE_EXTENSIONS.includes(path.extname(r.file)),
          repro(`route ${r.route} came from a non-page file ${r.file}`)
        );
        assert.ok(isInside(routesRoot, r.file), repro(`route file ${r.file} escaped site/pages`));

        // Round trip: the file maps back to the very route it was found under.
        assert.equal(
          routeFromFile(routesRoot, r.file),
          r.route,
          repro(`routeFromFile did not round-trip for ${r.file}`)
        );

        // NO CLOBBER: distinct routes must map to distinct output paths, all
        // inside the build output.
        const out = outputPathForRoute(dist, r.route);
        assert.ok(isInside(dist, out), repro(`route ${r.route} mapped outside dist: ${out}`));
        assert.ok(!outputs.has(out), repro(`two routes mapped to the same output path: ${out}`));
        outputs.add(out);
        if (r.meta && typeof r.meta !== "object")
          assert.fail(repro("route.meta was not an object"));
      }

      // Sorted, and free of duplicates.
      const routeList = withDrafts.map((r) => r.route);
      assert.equal(
        new Set(routeList).size,
        routeList.length,
        repro("discovery returned a duplicate")
      );
      for (let k = 1; k < routeList.length; k++) {
        assert.ok(
          routeList[k - 1].localeCompare(routeList[k]) <= 0,
          repro(`routes are not sorted: ${routeList[k - 1]} before ${routeList[k]}`)
        );
      }

      totalRoutes += withDrafts.length;
      if (entries.some((e) => e.route === null)) sawHiddenFile++;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Anti-vacuity: the corpus produced real routes, real drafts, and real
  // non-routable files (hidden names / non-page extensions).
  assert.ok(totalRoutes > 0, `expected the trees to produce routes (got ${totalRoutes})`);
  assert.ok(totalDrafts > 0, `expected some drafts to be filtered (got ${totalDrafts})`);
  assert.ok(sawHiddenFile > 0, `expected some non-routable files (got ${sawHiddenFile})`);
});

// ---------------------------------------------------------------------------
// Test 4: duplicate routes are always loud, and name both files.
// ---------------------------------------------------------------------------

test("fuzz: two files claiming one route always throw, naming both files", () => {
  const TREES = 110;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-router-dup-"));
  let extensionClashes = 0;
  let indexClashes = 0;

  try {
    for (let i = 0; i < TREES; i++) {
      const seed = ((BASE_SEED ^ 0x22222222) + i) >>> 0;
      const rng = makeRng(seed);
      const entries = randTree(rng).map((e) => ({ ...e, body: CONTENTS[1].body, draft: false }));
      // Pick a routable victim to collide with; skip the tree if it has none.
      const victims = entries.filter((e) => e.route !== null);
      if (victims.length === 0) continue;
      const victim = rng.pick(victims);

      // Two ways two files can claim one route: the same base with the other
      // page extension, or the directory-index spelling of the same route.
      const other = victim.ext === ".md" ? ".wd" : ".md";
      const asExtension = [...victim.dirs, victim.base + other].join("/");
      const asIndex = [...victim.dirs, victim.base, `index${other}`].join("/");
      const useIndex = victim.base !== "index" && rng.bool(0.5);
      const twinRel = useIndex ? asIndex : asExtension;

      const routesRoot = writeTree(path.join(root, `t${i}`), entries);
      const twinAbs = path.join(routesRoot, twinRel);
      fs.mkdirSync(path.dirname(twinAbs), { recursive: true });
      fs.writeFileSync(twinAbs, CONTENTS[1].body);
      const victimAbs = path.join(routesRoot, victim.rel);

      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (router: duplicates) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\n` +
        `route: ${victim.route}\n` +
        `files: ${victim.rel}  +  ${twinRel}\n` +
        `--- generated tree (under site/pages) ---\n${describeTree(entries)}\n--- end tree ---\n`;

      let routes;
      let error = null;
      try {
        routes = discoverRoutes(routesRoot);
      } catch (err) {
        error = err;
      }
      assert.ok(
        error,
        repro(`duplicate route was silently accepted (${routes?.length} routes returned)`)
      );
      assertErrorish(error, repro);
      // Structural, not textual: the message must name BOTH colliding files so a
      // maintainer can act on it. Never asserting the sentence itself.
      assert.ok(
        error.message.includes(victimAbs),
        repro(`error did not name the first file (${victimAbs}). Message: ${error.message}`)
      );
      assert.ok(
        error.message.includes(twinAbs),
        repro(`error did not name the second file (${twinAbs}). Message: ${error.message}`)
      );

      if (useIndex) indexClashes++;
      else extensionClashes++;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.ok(extensionClashes > 0, `expected .md/.wd clashes (got ${extensionClashes})`);
  assert.ok(indexClashes > 0, `expected file-vs-directory-index clashes (got ${indexClashes})`);
});

test("fuzz: a draft twin cannot collide until drafts are included", () => {
  // Duplicate detection runs AFTER draft filtering, so an unpublished draft
  // cannot break a build that does not publish it. The clash appears the moment
  // drafts are included (`darkmown dev`, `build --drafts`). Pinning the ordering
  // keeps a future refactor from moving the check above the filter.
  const TREES = 60;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-router-draft-"));
  let checked = 0;

  try {
    for (let i = 0; i < TREES; i++) {
      const seed = ((BASE_SEED ^ 0x33333333) + i) >>> 0;
      const rng = makeRng(seed);
      const entries = randTree(rng).map((e) => ({ ...e, body: CONTENTS[1].body, draft: false }));
      const victims = entries.filter((e) => e.route !== null);
      if (victims.length === 0) continue;
      const victim = rng.pick(victims);

      const other = victim.ext === ".md" ? ".wd" : ".md";
      const routesRoot = writeTree(path.join(root, `t${i}`), entries);
      const twinAbs = path.join(routesRoot, [...victim.dirs, victim.base + other].join("/"));
      fs.writeFileSync(twinAbs, CONTENTS[2].body); // draft: true

      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (router: draft twin) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\nroute: ${victim.route}\n`;

      const published = discoverRoutes(routesRoot);
      assert.ok(
        published.some((r) => r.route === victim.route),
        repro("the published page disappeared behind its draft twin")
      );
      assert.throws(
        () => discoverRoutes(routesRoot, { includeDrafts: true }),
        (err) => err instanceof Error && err.message.length > 0,
        repro("including drafts did not surface the collision")
      );
      checked++;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.ok(checked > 0, `expected some draft-twin trees (got ${checked})`);
});

// ---------------------------------------------------------------------------
// Test 5: a malformed page fails discovery loudly, naming the file.
// ---------------------------------------------------------------------------

test("fuzz: an unparseable page makes discovery throw an Error naming the file", () => {
  const CASES = 90;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fuzz-router-bad-"));
  let thrown = 0;

  try {
    for (let i = 0; i < CASES; i++) {
      const seed = ((BASE_SEED ^ 0x44444444) + i) >>> 0;
      const rng = makeRng(seed);
      const entries = randTree(rng).map((e) => ({ ...e, body: CONTENTS[1].body, draft: false }));
      const routesRoot = writeTree(path.join(root, `t${i}`), entries);
      // Unterminated frontmatter: an opening fence with no closing fence.
      const badRel = `broken-${i}${rng.pick(PAGE_EXTENSIONS)}`;
      const badAbs = path.join(routesRoot, badRel);
      fs.writeFileSync(badAbs, `---\ntitle: ${rng.pick(SEGMENTS)}\nnever closed\n`);

      const repro = (msg) =>
        `\n\n=== FUZZ INVARIANT VIOLATION (router: malformed page) ===\n` +
        `seed: ${seed} (re-run: WD_FUZZ_SEED=${seed})\n` +
        `reason: ${msg}\nfile: ${badAbs}\n`;

      let error = null;
      try {
        discoverRoutes(routesRoot);
      } catch (err) {
        error = err;
      }
      assert.ok(error, repro("an unparseable page was discovered without complaint"));
      assertErrorish(error, repro);
      assert.ok(
        error.message.includes(badAbs) || error.message.includes(badRel),
        repro(`error did not name the offending file. Message: ${error.message}`)
      );
      thrown++;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.equal(thrown, CASES, "every unparseable page must fail discovery");
});

// ---------------------------------------------------------------------------
// Test 6: determinism guard. A printed seed is only useful if it reproduces.
// ---------------------------------------------------------------------------

test("fuzz: the router generators are deterministic and reproducible for a given seed", () => {
  const a = makeRng(97531);
  const b = makeRng(97531);
  for (let i = 0; i < 500; i++) assert.equal(a.float(), b.float());

  assert.equal(randRoute(makeRng(4242)), randRoute(makeRng(4242)));
  assert.notEqual(randRoute(makeRng(1)), randRoute(makeRng(2)));
  assert.deepEqual(randTree(makeRng(8080)), randTree(makeRng(8080)));
});
