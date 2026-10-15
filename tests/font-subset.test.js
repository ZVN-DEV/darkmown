// Build-time font subsetting (2.10.0): src/font-subset.js + the
// src/font-subset-worker.js child process.
//
// A `.skin` `@font-face` that references a project-local font gets a subsetted
// `<name>-subset.woff2` emitted beside the original in dist, and the emitted
// CSS is rewritten to lead with it. The toolchain (harfbuzzjs + wawoff2) is an
// optional dependency, so the failure modes are the point of half these tests:
// toolchain absent (via the WD_HARFBUZZ_WASM / WD_WAWOFF2_MODULE seams) → one
// hint and 2.9.0-identical output; a corrupt font → a hint naming the file; a
// second build → all cache hits and zero wasm work.
//
// The fixture font (tests/fixtures/fonts/HankenGrotesk-Subset.ttf) is an
// OFL-licensed subset of Hanken Grotesk — see tests/fixtures/fonts/README.md.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSite } from "../src/builder.js";
import { createPaths } from "../src/config.js";
import {
  BASE_CODEPOINTS,
  charsetFromTexts,
  rewriteFontFaceCss,
  runSubsetJobs,
  subsetFonts
} from "../src/font-subset.js";
import { runJobsFile, subsetFont } from "../src/font-subset-worker.js";

const FIXTURE = new URL("./fixtures/fonts/HankenGrotesk-Subset.ttf", import.meta.url);
const FIXTURE_BYTES = fs.readFileSync(FIXTURE);

/** A fresh temp project root with `site/pages` created. */
function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fonts-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  return root;
}

/** Write a source file (text or bytes) into the project. */
function write(root, rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
  return abs;
}

/** Copy the fixture font into the project at `rel`. */
function plantFont(root, rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.copyFileSync(fileURLToPath(FIXTURE), abs);
  return abs;
}

/** The skin source declaring one @font-face against `url`, plus a body rule. */
function skinWithFont(url) {
  return [
    "@font-face",
    '  font-family "Hanken"',
    `  src url("${url}") format("truetype")`,
    "  font-display swap",
    "",
    "body",
    '  font-family "Hanken", sans-serif',
    ""
  ].join("\n");
}

/** A one-page project with a colocated skin referencing the given font url. */
function fontProject(root, url, body = "# Hello\n\nPlain text.\n") {
  write(root, "site/pages/index.wd", `---\ntitle: T\n---\n\n${body}`);
  write(root, "site/pages/index.skin", skinWithFont(url));
}

/** Run `fn` with console.warn captured; returns { result, warns }. */
function withWarns(fn) {
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    return { result: fn(), warns };
  } finally {
    console.warn = original;
  }
}

/** Swap an env var for the duration of `fn` (sync or async). */
async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

/** The one emitted stylesheet of a built test project. */
function readEmittedCss(root, name = "site_pages_index.css") {
  return fs.readFileSync(path.join(root, "dist/__wd/styles", name), "utf8");
}

test("a shelf font is subsetted to woff2 beside the original, and the CSS leads with it", () => {
  const root = freshRoot();
  plantFont(root, "site/_/fonts/hanken.ttf");
  fontProject(root, "/__wd/media/fonts/hanken.ttf", "# Café ★\n\nUn café, s'il vous plaît.\n");
  const { result } = withWarns(() => buildSite(root));

  assert.deepEqual(result.fonts, { subsetted: 1, cached: 0, unavailable: false });
  const subset = path.join(root, "dist/__wd/media/fonts/hanken-subset.woff2");
  assert.ok(fs.existsSync(subset), "the subset ships beside the original");
  const bytes = fs.readFileSync(subset);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", "it really is woff2");
  assert.ok(bytes.length < FIXTURE_BYTES.length, "the subset is smaller than the source");
  assert.ok(
    fs.existsSync(path.join(root, "dist/__wd/media/fonts/hanken.ttf")),
    "the original ships as the fallback"
  );
  const css = readEmittedCss(root);
  assert.match(
    css,
    /src: url\("\/__wd\/media\/fonts\/hanken-subset\.woff2"\) format\("woff2"\), url\("\/__wd\/media\/fonts\/hanken\.ttf"\) format\("truetype"\);/,
    "the subset is listed first, the original kept as fallback"
  );
  assert.match(css, /font-display: swap;/, "every other descriptor is untouched");
});

test("a pages-colocated font resolves against site/pages", () => {
  const root = freshRoot();
  plantFont(root, "site/pages/fonts/body.ttf");
  fontProject(root, "/fonts/body.ttf");
  const { result } = withWarns(() => buildSite(root));

  assert.deepEqual(result.fonts, { subsetted: 1, cached: 0, unavailable: false });
  assert.ok(fs.existsSync(path.join(root, "dist/fonts/body-subset.woff2")));
  assert.match(
    readEmittedCss(root),
    /src: url\("\/fonts\/body-subset\.woff2"\) format\("woff2"\), url\("\/fonts\/body\.ttf"\)/
  );
});

test("the second build does zero wasm work: the subset comes from the cache", () => {
  const root = freshRoot();
  plantFont(root, "site/_/fonts/hanken.ttf");
  fontProject(root, "/__wd/media/fonts/hanken.ttf");
  withWarns(() => buildSite(root));
  const cacheDir = path.join(root, "node_modules/.cache/darkmown-fonts");
  const cacheNames = fs.readdirSync(cacheDir);
  assert.equal(cacheNames.length, 1, "one cache entry: font hash + charset hash");
  const mtimes = cacheNames.map((n) => fs.statSync(path.join(cacheDir, n)).mtimeMs);

  const second = withWarns(() => buildSite(root));
  assert.deepEqual(second.result.fonts, { subsetted: 0, cached: 1, unavailable: false });
  assert.deepEqual(
    fs.readdirSync(cacheDir).map((n) => fs.statSync(path.join(cacheDir, n)).mtimeMs),
    mtimes,
    "cache files untouched — the worker never ran"
  );
  assert.match(
    readEmittedCss(root),
    /hanken-subset\.woff2"\) format\("woff2"\),/,
    "the rebuilt CSS still leads with the subset"
  );
});

test("the page's own characters flow into the charset (out-of-base text changes the cache key)", () => {
  const ascii = freshRoot();
  plantFont(ascii, "site/_/fonts/hanken.ttf");
  fontProject(ascii, "/__wd/media/fonts/hanken.ttf", "# Hello\n\nPlain ASCII only.\n");
  withWarns(() => buildSite(ascii));
  const asciiCache = fs.readdirSync(path.join(ascii, "node_modules/.cache/darkmown-fonts"))[0];

  // é, ★, — are already in the base set, so the divergence needs characters
  // beyond it: a CJK string and a symbol only this page renders.
  const accented = freshRoot();
  plantFont(accented, "site/_/fonts/hanken.ttf");
  fontProject(accented, "/__wd/media/fonts/hanken.ttf", "# Café ★\n\n日本語のページ ⚡\n");
  withWarns(() => buildSite(accented));
  const accentedCache = fs.readdirSync(
    path.join(accented, "node_modules/.cache/darkmown-fonts")
  )[0];

  // Same font, so the font-hash half of the key matches; the charset half must differ.
  assert.equal(asciiCache.split("-")[0], accentedCache.split("-")[0], "same font hash");
  assert.notEqual(asciiCache, accentedCache, "the page text changed the charset hash");
});

test("toolchain absent: one hint, and output identical to not having the feature", async () => {
  const root = freshRoot();
  plantFont(root, "site/_/fonts/hanken.ttf");
  fontProject(root, "/__wd/media/fonts/hanken.ttf");
  const captured = await withEnv("WD_HARFBUZZ_WASM", "/nonexistent/hb-subset.wasm", () =>
    Promise.resolve(withWarns(() => buildSite(root)))
  );
  const { result, warns } = captured;
  assert.deepEqual(result.fonts, { subsetted: 0, cached: 0, unavailable: true });
  const hints = warns.filter((w) => w.includes("npm i -D harfbuzzjs wawoff2"));
  assert.equal(hints.length, 1, "exactly one toolchain hint per build");
  assert.match(hints[0], /1 font could be subsetted to woff2 \(site\/_\/fonts\/hanken\.ttf\)/);
  assert.ok(!fs.existsSync(path.join(root, "dist/__wd/media/fonts/hanken-subset.woff2")));
  assert.doesNotMatch(readEmittedCss(root), /subset\.woff2/, "the CSS is untouched");
});

test("a corrupt font is a hint naming the file, and the good font still subsets", () => {
  const root = freshRoot();
  plantFont(root, "site/_/fonts/hanken.ttf");
  write(root, "site/_/fonts/broken.ttf", "this is not a font, just prose bytes");
  write(root, "site/pages/index.wd", "---\ntitle: T\n---\n\n# Hi\n");
  write(
    root,
    "site/pages/index.skin",
    `${skinWithFont("/__wd/media/fonts/hanken.ttf")}\n@font-face\n  font-family "Broken"\n  src url("/__wd/media/fonts/broken.ttf") format("truetype")\n`
  );
  const { result, warns } = withWarns(() => buildSite(root));

  assert.deepEqual(result.fonts, { subsetted: 1, cached: 0, unavailable: false });
  assert.ok(
    warns.some(
      (w) => w.includes("site/_/fonts/broken.ttf") && w.includes("could not be subsetted")
    ),
    "the failure hint names the corrupt file"
  );
  assert.ok(fs.existsSync(path.join(root, "dist/__wd/media/fonts/hanken-subset.woff2")));
  assert.ok(!fs.existsSync(path.join(root, "dist/__wd/media/fonts/broken-subset.woff2")));
  const css = readEmittedCss(root);
  assert.match(css, /hanken-subset\.woff2/);
  assert.match(
    css,
    /@font-face \{\n {2}font-family: "Broken";\n {2}src: url\("\/__wd\/media\/fonts\/broken\.ttf"\)/,
    "the corrupt font's block keeps the original src"
  );
});

test("a site with no @font-face does nothing and says nothing", () => {
  const root = freshRoot();
  write(root, "site/pages/index.wd", "---\ntitle: T\n---\n\n# Hello\n");
  const { result, warns } = withWarns(() => buildSite(root));
  assert.deepEqual(result.fonts, { subsetted: 0, cached: 0, unavailable: false });
  assert.ok(!warns.some((w) => w.includes("font")), "no font hint");
  assert.ok(!fs.existsSync(path.join(root, "node_modules/.cache/darkmown-fonts")));
});

test("an incremental rebuild keeps the rewrite idempotent (no double subset entry)", () => {
  const root = freshRoot();
  plantFont(root, "site/_/fonts/hanken.ttf");
  fontProject(root, "/__wd/media/fonts/hanken.ttf");
  withWarns(() => buildSite(root, { depMap: true }));

  write(root, "site/pages/index.wd", "---\ntitle: T\n---\n\n# Hello\n\nMore prose.\n");
  const { result } = withWarns(() => buildSite(root, { changed: ["site/pages/index.wd"] }));
  assert.ok(result.incremental, "the rebuild really was incremental");
  assert.deepEqual(result.fonts, { subsetted: 0, cached: 1, unavailable: false });
  const css = readEmittedCss(root);
  assert.equal(
    css.match(/hanken-subset\.woff2/g)?.length,
    1,
    "the subset reference appears exactly once"
  );
});

// --- the post-pass module's own seams ----------------------------------------

test("subsetFonts is a no-op without a dist directory", () => {
  const root = freshRoot();
  const plan = subsetFonts(createPaths(root));
  assert.deepEqual(plan, { subsetted: 0, cached: 0, unavailable: false });
});

test("non-candidate urls are skipped silently: remote, protocol-relative, data, relative, woff2, missing, escaping", () => {
  const root = freshRoot();
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<html><body><p>Hi</p></body></html>");
  write(
    root,
    "dist/style.css",
    [
      '@font-face { font-family: "a"; src: url("https://cdn.example.com/a.ttf") format("truetype"); }',
      '@font-face { font-family: "b"; src: url("//cdn.example.com/b.ttf") format("truetype"); }',
      '@font-face { font-family: "c"; src: url(data:font/ttf;base64,AAAA) format("truetype"); }',
      '@font-face { font-family: "d"; src: url("../fonts/d.ttf") format("truetype"); }',
      '@font-face { font-family: "e"; src: url("/fonts/e.woff2") format("woff2"); }',
      '@font-face { font-family: "f"; src: url("/fonts/missing.ttf") format("truetype"); }',
      '@font-face { font-family: "g"; src: url("/../escaped.ttf") format("truetype"); }',
      '@font-face { font-family: "h"; src: url("/fonts/%E0%A4%A.ttf") format("truetype"); }'
    ].join("\n")
  );
  const cssBefore = fs.readFileSync(path.join(root, "dist/style.css"), "utf8");
  const { result, warns } = withWarns(() => subsetFonts(paths));
  assert.deepEqual(result, { subsetted: 0, cached: 0, unavailable: false });
  assert.deepEqual(warns, [], "every skip is silent");
  assert.equal(fs.readFileSync(path.join(root, "dist/style.css"), "utf8"), cssBefore);
});

test("a symlinked font pointing OUTSIDE the project is never subsetted — its bytes never reach dist", {
  skip: process.platform === "win32"
}, () => {
  const root = freshRoot();
  const paths = createPaths(root);
  // The audit repro: a font linked in from outside the project (a "system
  // font"). The fixture's real path is outside the temp project root.
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-font-outside-"));
  const outside = path.join(outsideDir, "system.ttf");
  fs.copyFileSync(fileURLToPath(FIXTURE), outside);
  try {
    fs.mkdirSync(path.join(root, "site/pages/fonts"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "site/pages/fonts/evil.ttf"));
    fs.mkdirSync(paths.distRoot, { recursive: true });
    write(root, "dist/index.html", "<p>Hi</p>");
    write(
      root,
      "dist/style.css",
      '@font-face { font-family: "e"; src: url("/fonts/evil.ttf") format("truetype"); }'
    );
    const cssBefore = fs.readFileSync(path.join(root, "dist/style.css"), "utf8");
    const { result, warns } = withWarns(() => subsetFonts(paths));
    assert.deepEqual(result, { subsetted: 0, cached: 0, unavailable: false });
    assert.deepEqual(warns, [], "silent, like every other non-candidate skip");
    assert.equal(
      fs.readFileSync(path.join(root, "dist/style.css"), "utf8"),
      cssBefore,
      "the CSS keeps the original src verbatim"
    );
    assert.ok(!fs.existsSync(path.join(root, "dist/fonts/evil-subset.woff2")));
    assert.ok(
      !fs.existsSync(path.join(root, "node_modules/.cache/darkmown-fonts")),
      "the target's bytes never even entered the subset cache"
    );
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("a symlinked ANCESTOR directory escaping the project is also not project-local", {
  skip: process.platform === "win32"
}, () => {
  const root = freshRoot();
  const paths = createPaths(root);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-font-outdir-"));
  fs.copyFileSync(fileURLToPath(FIXTURE), path.join(outsideDir, "evil.ttf"));
  try {
    // site/pages/fonts is itself the symlink; evil.ttf inside it is a plain
    // file, so only the canonical (realpath) containment check can catch this.
    fs.symlinkSync(outsideDir, path.join(root, "site/pages/fonts"));
    fs.mkdirSync(paths.distRoot, { recursive: true });
    write(root, "dist/index.html", "<p>Hi</p>");
    write(
      root,
      "dist/style.css",
      '@font-face { font-family: "e"; src: url("/fonts/evil.ttf") format("truetype"); }'
    );
    const { result, warns } = withWarns(() => subsetFonts(paths));
    assert.deepEqual(result, { subsetted: 0, cached: 0, unavailable: false });
    assert.deepEqual(warns, []);
    assert.ok(!fs.existsSync(path.join(root, "dist/fonts/evil-subset.woff2")));
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("an IN-PROJECT symlink is skipped too, matching the asset-copy convention", {
  skip: process.platform === "win32"
}, () => {
  const root = freshRoot();
  const paths = createPaths(root);
  // emitPageAssets (and the image pre-pass) never publish symlinks at all, so
  // subsetting one would emit a -subset.woff2 whose original never ships.
  const real = plantFont(root, "site/_/fonts/real.ttf");
  fs.symlinkSync(real, path.join(root, "site/_/fonts/alias.ttf"));
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<p>Hi</p>");
  write(
    root,
    "dist/style.css",
    [
      '@font-face { font-family: "a"; src: url("/__wd/media/fonts/alias.ttf") format("truetype"); }',
      '@font-face { font-family: "r"; src: url("/__wd/media/fonts/real.ttf") format("truetype"); }'
    ].join("\n")
  );
  const plan = subsetFonts(paths, {
    runJobs: (payload) => {
      for (const job of payload.jobs) {
        fs.mkdirSync(path.dirname(job.out), { recursive: true });
        fs.writeFileSync(job.out, "wOF2-fake");
      }
      return { unavailable: false, failed: [] };
    }
  });
  assert.deepEqual(plan, { subsetted: 1, cached: 0, unavailable: false }, "only the real font");
  assert.ok(!fs.existsSync(path.join(root, "dist/__wd/media/fonts/alias-subset.woff2")));
  assert.ok(fs.existsSync(path.join(root, "dist/__wd/media/fonts/real-subset.woff2")));
});

test("a symlinked font in a full build stays out of dist and the CSS is untouched", {
  skip: process.platform === "win32"
}, () => {
  const root = freshRoot();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-font-outside-"));
  const outside = path.join(outsideDir, "system.ttf");
  fs.copyFileSync(fileURLToPath(FIXTURE), outside);
  try {
    fs.mkdirSync(path.join(root, "site/pages/fonts"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "site/pages/fonts/evil.ttf"));
    fontProject(root, "/fonts/evil.ttf");
    const { result, warns } = withWarns(() => buildSite(root));
    assert.deepEqual(result.fonts, { subsetted: 0, cached: 0, unavailable: false });
    assert.ok(!warns.some((w) => w.includes("evil.ttf")), "no hint either way for a symlink");
    assert.ok(!fs.existsSync(path.join(root, "dist/fonts/evil-subset.woff2")));
    assert.doesNotMatch(readEmittedCss(root), /subset\.woff2/, "no rewrite happened");
  } finally {
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("runSubsetJobs passes a spawn timeout, and a timed-out worker reads as `unavailable`", async () => {
  // The stub captures the options: the two-minute default rides along.
  /** @type {unknown} */
  let seen;
  const missing = runSubsetJobs({ charset: [65], jobs: [] }, (_cmd, _args, opts) => {
    seen = opts;
  });
  assert.deepEqual(missing, { unavailable: true, failed: [] });
  assert.equal(/** @type {{ timeout: number }} */ (seen).timeout, 120000);

  // End-to-end with the REAL spawnSync and an injected short timeout: a worker
  // that sleeps past it is killed, leaves no results file, and is reported as
  // `unavailable` (a hint upstream), never a build failure.
  const { spawnSync } = await import("node:child_process");
  const result = runSubsetJobs(
    { charset: [65], jobs: [] },
    /** @type {any} */ (
      (cmd, _args, opts) => spawnSync(cmd, ["-e", "setTimeout(() => {}, 30000)"], opts)
    ),
    100
  );
  assert.deepEqual(result, { unavailable: true, failed: [] });
});

test("a subsetted url with a query string still resolves and rewrites", () => {
  const root = freshRoot();
  const paths = createPaths(root);
  plantFont(root, "site/_/fonts/hanken.ttf");
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<p>Hi</p>");
  write(
    root,
    "dist/__wd/styles/site_pages_index.css",
    '@font-face {\n  font-family: "Hanken";\n  src: url("/__wd/media/fonts/hanken.ttf?v=3") format("truetype");\n}'
  );
  const plan = subsetFonts(paths, {
    runJobs: (payload) => {
      for (const job of payload.jobs) {
        fs.mkdirSync(path.dirname(job.out), { recursive: true });
        fs.writeFileSync(job.out, "wOF2-fake");
      }
      return { unavailable: false, failed: [] };
    }
  });
  assert.equal(plan.subsetted, 1);
  const css = fs.readFileSync(path.join(root, "dist/__wd/styles/site_pages_index.css"), "utf8");
  assert.match(
    css,
    /src: url\("\/__wd\/media\/fonts\/hanken-subset\.woff2"\) format\("woff2"\), url\("\/__wd\/media\/fonts\/hanken\.ttf\?v=3"\)/
  );
});

test("an unreadable font file is a hint, not a throw", {
  skip: process.platform === "win32"
}, () => {
  const root = freshRoot();
  const paths = createPaths(root);
  const font = plantFont(root, "site/_/fonts/locked.ttf");
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<p>Hi</p>");
  write(
    root,
    "dist/style.css",
    '@font-face { font-family: "L"; src: url("/__wd/media/fonts/locked.ttf") format("truetype"); }'
  );
  fs.chmodSync(font, 0o000);
  let captured;
  try {
    captured = withWarns(() => subsetFonts(paths));
  } finally {
    fs.chmodSync(font, 0o644);
  }
  assert.ok(
    captured.warns.some((w) => w.includes("locked.ttf") && w.includes("could not be read")),
    "the hint names the unreadable file"
  );
  assert.equal(captured.result.subsetted + captured.result.cached, 0);
});

test("the toolchain-absent hint pluralizes and quiet mode suppresses every hint", () => {
  const root = freshRoot();
  const paths = createPaths(root);
  plantFont(root, "site/_/fonts/a.ttf");
  plantFont(root, "site/_/fonts/b.ttf");
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<p>Hi</p>");
  write(
    root,
    "dist/style.css",
    '@font-face { font-family: "a"; src: url("/__wd/media/fonts/a.ttf"); }\n' +
      '@font-face { font-family: "b"; src: url("/__wd/media/fonts/b.ttf"); }'
  );
  const unavailable = () => ({ unavailable: true, failed: [] });
  const loud = withWarns(() => subsetFonts(paths, { runJobs: unavailable }));
  assert.equal(loud.result.unavailable, true);
  assert.equal(loud.warns.length, 1);
  assert.match(
    loud.warns[0],
    /2 fonts could be subsetted to woff2 \(site\/_\/fonts\/a\.ttf, site\/_\/fonts\/b\.ttf\)/
  );
  const quiet = withWarns(() => subsetFonts(paths, { runJobs: unavailable, quiet: true }));
  assert.equal(quiet.result.unavailable, true, "the flag is still recorded");
  assert.deepEqual(quiet.warns, [], "dev-server rebuilds stay silent");
});

test("a toolchain failure on one font skips just that font (worker-reported failure)", () => {
  const root = freshRoot();
  const paths = createPaths(root);
  plantFont(root, "site/_/fonts/a.ttf");
  plantFont(root, "site/_/fonts/b.ttf");
  fs.mkdirSync(paths.distRoot, { recursive: true });
  write(root, "dist/index.html", "<p>Hi</p>");
  write(
    root,
    "dist/style.css",
    '@font-face { font-family: "a"; src: url("/__wd/media/fonts/a.ttf"); }\n' +
      '@font-face { font-family: "b"; src: url("/__wd/media/fonts/b.ttf"); }'
  );
  const { result, warns } = withWarns(() =>
    subsetFonts(paths, {
      runJobs: (payload) => {
        // Subset only the first job; report the second as failed, like the
        // worker does when harfbuzz rejects one file.
        const [ok, bad] = payload.jobs;
        fs.mkdirSync(path.dirname(ok.out), { recursive: true });
        fs.writeFileSync(ok.out, "wOF2-fake");
        return { unavailable: false, failed: [{ file: bad.source, error: "boom" }] };
      }
    })
  );
  assert.deepEqual(result, { subsetted: 1, cached: 0, unavailable: false });
  assert.ok(
    warns.some((w) => w.includes("b.ttf") && w.includes("boom")),
    "the error travels"
  );
  assert.ok(fs.existsSync(path.join(root, "dist/__wd/media/fonts/a-subset.woff2")));
  assert.ok(!fs.existsSync(path.join(root, "dist/__wd/media/fonts/b-subset.woff2")));
});

test("runSubsetJobs reports unavailable when the worker leaves no results file", () => {
  const result = runSubsetJobs({ charset: [65], jobs: [] }, () => {});
  assert.deepEqual(result, { unavailable: true, failed: [] });
});

test("runSubsetJobs reports unavailable when the worker writes garbage", () => {
  const result = runSubsetJobs({ charset: [65], jobs: [] }, (_cmd, args) => {
    fs.writeFileSync(args[2], "not json");
  });
  assert.deepEqual(result, { unavailable: true, failed: [] });
});

// --- the CSS rewriter ---------------------------------------------------------

test("rewriteFontFaceCss leads src with the subset and keeps the fallback", () => {
  const css =
    '@font-face {\n  font-family: "Hanken";\n  src: url("/f/a.ttf") format("truetype");\n  font-display: swap;\n}';
  const out = rewriteFontFaceCss(css, new Map([["/f/a.ttf", "/f/a-subset.woff2"]]));
  assert.equal(
    out,
    '@font-face {\n  font-family: "Hanken";\n' +
      '  src: url("/f/a-subset.woff2") format("woff2"), url("/f/a.ttf") format("truetype");\n' +
      "  font-display: swap;\n}"
  );
  // Idempotent: rewriting the rewritten CSS changes nothing.
  assert.equal(rewriteFontFaceCss(out, new Map([["/f/a.ttf", "/f/a-subset.woff2"]])), out);
});

test("rewriteFontFaceCss leaves untouched what it must", () => {
  // Empty map: identity fast path.
  const css = '@font-face { src: url("/f/a.ttf"); }';
  assert.equal(rewriteFontFaceCss(css, new Map()), css);
  // A block with no src declaration.
  const noSrc = '@font-face { font-family: "x"; }';
  assert.equal(rewriteFontFaceCss(noSrc, new Map([["/f/a.ttf", "/f/a-s.woff2"]])), noSrc);
  // A url the map does not know.
  const other = '@font-face { src: url("/f/other.ttf"); }';
  assert.equal(rewriteFontFaceCss(other, new Map([["/f/a.ttf", "/f/a-s.woff2"]])), other);
  // Single-quoted and bare url() targets rewrite too.
  const quoted = "@font-face { src: url('/f/a.ttf'); }\n@font-face { src: url(/f/b.ttf); }";
  const out = rewriteFontFaceCss(
    quoted,
    new Map([
      ["/f/a.ttf", "/f/a-subset.woff2"],
      ["/f/b.ttf", "/f/b-subset.woff2"]
    ])
  );
  assert.match(out, /src: url\("\/f\/a-subset\.woff2"\) format\("woff2"\), url\('\/f\/a\.ttf'\)/);
  assert.match(out, /src: url\("\/f\/b-subset\.woff2"\) format\("woff2"\), url\(\/f\/b\.ttf\)/);
  // The same url listed twice in one src earns ONE prefix.
  const dup = '@font-face { src: url("/f/a.ttf"), url("/f/a.ttf"); }';
  const duped = rewriteFontFaceCss(dup, new Map([["/f/a.ttf", "/f/a-subset.woff2"]]));
  assert.equal(duped.match(/a-subset\.woff2/g)?.length, 1);
});

// --- the charset --------------------------------------------------------------

test("charsetFromTexts carries the base set and unions page text and entities", () => {
  // Base set: ASCII, Latin-1, punctuation, arrows, stars/checks.
  for (const cp of [0x41, 0xe9, 0xb7, 0x2014, 0x2019, 0x2026, 0x2022, 0x2192, 0x2605, 0x2713]) {
    assert.ok(BASE_CODEPOINTS.includes(cp), `base set carries U+${cp.toString(16)}`);
  }
  const cps = charsetFromTexts(["<p>Café ★ こんにちは</p>", "<p>&#19990;&#x754c;</p>"]);
  assert.ok(cps.includes(0x3053), "page text: こ");
  assert.ok(cps.includes(0x4e16), "decimal entity: 世");
  assert.ok(cps.includes(0x754c), "hex entity: 界");
  assert.deepEqual(
    cps,
    [...cps].sort((a, b) => a - b),
    "sorted"
  );
  assert.equal(new Set(cps).size, cps.length, "deduped");
  // An out-of-range numeric reference is ignored, never a throw.
  const withBogus = charsetFromTexts(["<p>&#x110000;</p>"]);
  assert.deepEqual(withBogus, BASE_CODEPOINTS);
});

// --- the worker, in process (the child-process path is covered by the builds) --

test("the worker subsets a real font and reports a corrupt one as failed", async () => {
  const root = freshRoot();
  const good = plantFont(root, "good.ttf");
  const corrupt = write(root, "corrupt.ttf", "not a font at all");
  const jobsFile = path.join(root, "jobs.json");
  const resultsFile = path.join(root, "results.json");
  fs.writeFileSync(
    jobsFile,
    JSON.stringify({
      charset: [0x20, 0x41, 0xe9, 0x2605],
      jobs: [
        { source: good, out: path.join(root, "out/good.woff2") },
        { source: corrupt, out: path.join(root, "out/corrupt.woff2") }
      ]
    })
  );
  await runJobsFile(jobsFile, resultsFile);
  const result = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  assert.equal(result.unavailable, false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].file, corrupt);
  const bytes = fs.readFileSync(path.join(root, "out/good.woff2"));
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2");
  assert.ok(bytes.length < FIXTURE_BYTES.length);
});

test("the worker reports unavailable when the toolchain cannot load", async () => {
  const root = freshRoot();
  const jobsFile = path.join(root, "jobs.json");
  const resultsFile = path.join(root, "results.json");
  fs.writeFileSync(jobsFile, JSON.stringify({ charset: [65], jobs: [{ source: "x", out: "y" }] }));
  await withEnv("WD_WAWOFF2_MODULE", "/nonexistent/wawoff2", () =>
    runJobsFile(jobsFile, resultsFile)
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(resultsFile, "utf8")), {
    unavailable: true,
    failed: []
  });
});

test("the worker rejects when its jobs file is unreadable", async () => {
  const root = freshRoot();
  await assert.rejects(() =>
    runJobsFile(path.join(root, "missing.json"), path.join(root, "results.json"))
  );
});

test("subsetFont throws when harfbuzz cannot create an input or subset the face", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const stub = (overrides) => ({
    memory,
    hb_subset_input_create_or_fail: () => 1,
    hb_subset_input_unicode_set: () => 2,
    hb_set_add: () => {},
    malloc: () => 0,
    hb_blob_create: () => 3,
    hb_face_create: () => 4,
    hb_blob_destroy: () => {},
    hb_subset_or_fail: () => 5,
    hb_face_destroy: () => {},
    hb_subset_input_destroy: () => {},
    free: () => {},
    ...overrides
  });
  assert.throws(
    () => subsetFont(stub({ hb_subset_input_create_or_fail: () => 0 }), new Uint8Array(4), [65]),
    /could not create a subset input/
  );
  assert.throws(
    () => subsetFont(stub({ hb_subset_or_fail: () => 0 }), new Uint8Array(8), [65]),
    /could not parse or subset the font/
  );
});
