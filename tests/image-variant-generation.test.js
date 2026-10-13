// Build-time responsive image variant generation (2.9.0).
//
// The 2.8.0 `@<width>` convention (tests/image-srcset.test.js) wires srcset
// entries for variants the AUTHOR made. This file covers the pre-pass that
// makes them itself (src/image-variants.js + the src/image-variant-resize.js
// worker): one photo dropped into site/pages yields resized `@640`/`@1280`
// siblings in dist and a srcset in the compiled page, with zero author steps.
//
// sharp is an optional dependency, so the failure modes are the point of half
// these tests: sharp absent (via the WD_SHARP_MODULE seam) → one hint and
// 2.8.0-identical output; a corrupt image → a hint naming the file; a sharp
// failure on one file → that file ships without variants and the rest still
// generate. Fixture images are generated at test time with sharp itself (a
// devDependency) — no binary fixtures are committed.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { buildSite } from "../src/builder.js";
import { imageSize } from "../src/compiler/image-size.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { runJobsFile } from "../src/image-variant-resize.js";
import { generateImageVariants, runResizeJobs } from "../src/image-variants.js";

/** A minimal but valid extended WebP (VP8X) header carrying a canvas size — parseable
 *  by imageSize but carrying no image data, so sharp fails to decode it. */
function fakeWebpHeader(w, h) {
  const b = new Uint8Array(30);
  const view = new DataView(b.buffer);
  const put = (at, text) =>
    b.set(
      [...text].map((c) => c.charCodeAt(0)),
      at
    );
  put(0, "RIFF");
  view.setUint32(4, 22, true);
  put(8, "WEBP");
  put(12, "VP8X");
  view.setUint32(16, 10, true);
  const put24 = (at, v) => {
    b[at] = v & 0xff;
    b[at + 1] = (v >> 8) & 0xff;
    b[at + 2] = (v >> 16) & 0xff;
  };
  put24(24, w - 1);
  put24(27, h - 1);
  return b;
}

/** A fresh temp project root with `site/pages` created. */
function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-img-gen-"));
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

/** A one-page project whose body references the given image, built on disk. */
function pageProject(root, src) {
  write(root, "site/pages/index.wd", `---\ntitle: T\n---\n\n![a](${src})\n`);
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

/** A real raster fixture of the given size/format, made by sharp at test time. */
async function makeImage(file, width, height, format) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } }
  });
  if (format === "jpeg") await pipeline.jpeg().toFile(file);
  else if (format === "webp") await pipeline.webp().toFile(file);
  else await pipeline.png().toFile(file);
}

/** The width of an image file, via the repo's own header reader. */
function widthOf(file) {
  return imageSize(fs.readFileSync(file))?.width;
}

test("a build generates @640/@1280 variants into dist and wires the srcset", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  pageProject(root, "/img/photo.jpg");
  const { result } = withWarns(() => buildSite(root));

  for (const w of [640, 1280]) {
    const variant = path.join(root, "dist/img", `photo@${w}.jpg`);
    assert.ok(fs.existsSync(variant), `${variant} published`);
    assert.equal(widthOf(variant), w, "the variant really is that wide");
  }
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(
    html,
    /srcset="\/img\/photo@640\.jpg 640w, \/img\/photo@1280\.jpg 1280w, \/img\/photo\.jpg 2400w"/
  );
  assert.deepEqual(result.images, { generated: 2, cached: 0, unavailable: false });
});

test("the second build does zero sharp work: every variant comes from the cache", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  pageProject(root, "/img/photo.jpg");
  withWarns(() => buildSite(root));
  const cacheDir = path.join(root, "node_modules/.cache/darkmown-images");
  const mtimes = fs
    .readdirSync(cacheDir)
    .map((name) => fs.statSync(path.join(cacheDir, name)).mtimeMs);

  const second = withWarns(() => buildSite(root));
  assert.deepEqual(second.result.images, { generated: 0, cached: 2, unavailable: false });
  assert.deepEqual(
    fs.readdirSync(cacheDir).map((name) => fs.statSync(path.join(cacheDir, name)).mtimeMs),
    mtimes,
    "cache files untouched — the resize worker never ran"
  );
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(html, /srcset="\/img\/photo@640\.jpg 640w/, "the rebuilt page keeps the srcset");
});

test("an author-provided variant wins: its width is never generated", async () => {
  const root = freshRoot();
  const source = path.join(root, "site/pages/img/photo.jpg");
  await makeImage(source, 2400, 1600, "jpeg");
  // The author's own @640 file really holds 500px — the srcset says 500w for
  // that href only when the AUTHOR file was probed, never when generated.
  await sharp(source)
    .resize({ width: 500 })
    .jpeg()
    .toFile(path.join(root, "site/pages/img/photo@640.jpg"));
  pageProject(root, "/img/photo.jpg");
  const { result } = withWarns(() => buildSite(root));

  assert.deepEqual(
    result.images,
    { generated: 1, cached: 0, unavailable: false },
    "only 1280 generated"
  );
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(
    html,
    /srcset="\/img\/photo@640\.jpg 500w, \/img\/photo@1280\.jpg 1280w, \/img\/photo\.jpg 2400w"/
  );
  assert.equal(
    widthOf(path.join(root, "dist/img/photo@640.jpg")),
    500,
    "the author file was copied, not overwritten by a generated one"
  );
});

test("an image at or under 700px is skipped silently (no variants, no hint)", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/small.jpg"), 700, 400, "jpeg");
  pageProject(root, "/img/small.jpg");
  const { result, warns } = withWarns(() => buildSite(root));
  assert.deepEqual(result.images, { generated: 0, cached: 0, unavailable: false });
  assert.ok(!warns.some((w) => w.includes("small.jpg")), "no hint for a deliberately small image");
  assert.ok(!fs.existsSync(path.join(root, "dist/img/small@640.jpg")));
  assert.doesNotMatch(fs.readFileSync(path.join(root, "dist/index.html"), "utf8"), /srcset/);
});

test("a @<width> file is output, never a source: no variants of a variant", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo@1280.jpg"), 2000, 1200, "jpeg");
  pageProject(root, "/img/photo@1280.jpg");
  const { result } = withWarns(() => buildSite(root));
  assert.deepEqual(result.images, { generated: 0, cached: 0, unavailable: false });
  assert.ok(!fs.existsSync(path.join(root, "dist/img/photo@1280@640.jpg")));
});

test("sharp absent: one hint naming the images, and output identical to 2.8.0", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  pageProject(root, "/img/photo.jpg");
  const previous = process.env.WD_SHARP_MODULE;
  process.env.WD_SHARP_MODULE = "/nonexistent/sharp";
  let captured;
  try {
    captured = withWarns(() => buildSite(root));
  } finally {
    if (previous === undefined) delete process.env.WD_SHARP_MODULE;
    else process.env.WD_SHARP_MODULE = previous;
  }
  const { result, warns } = captured;
  assert.equal(result.images.unavailable, true);
  assert.equal(result.images.generated + result.images.cached, 0);
  const hints = warns.filter((w) => w.includes("npm i -D sharp"));
  assert.equal(hints.length, 1, "exactly one sharp hint per build");
  assert.match(hints[0], /1 image could gain responsive variants \(site\/pages\/img\/photo\.jpg\)/);
  assert.ok(!fs.existsSync(path.join(root, "dist/img/photo@640.jpg")), "no variants in dist");
  assert.doesNotMatch(fs.readFileSync(path.join(root, "dist/index.html"), "utf8"), /srcset/);
});

test("a corrupt image (unreadable dimensions) is a hint naming the file, never a failure", () => {
  const root = freshRoot();
  write(root, "site/pages/img/broken.jpg", "this is not a jpeg");
  pageProject(root, "/img/broken.jpg");
  const { result, warns } = withWarns(() => buildSite(root));
  assert.deepEqual(result.images, { generated: 0, cached: 0, unavailable: false });
  assert.ok(
    warns.some(
      (w) => w.includes("site/pages/img/broken.jpg") && w.includes("dimensions could not be read")
    ),
    "the hint names the file"
  );
  assert.ok(fs.existsSync(path.join(root, "dist/index.html")), "the build still succeeded");
});

test("a sharp-level failure on one image skips just that image", async () => {
  const root = freshRoot();
  // A VP8X header with real dimensions but no image data: imageSize reads the
  // width (so the pre-pass queues it), sharp cannot decode it (so the job fails).
  write(root, "site/pages/img/header-only.webp", fakeWebpHeader(2400, 1600));
  await makeImage(path.join(root, "site/pages/img/good.jpg"), 2400, 1600, "jpeg");
  write(
    root,
    "site/pages/index.wd",
    "---\ntitle: T\n---\n\n![a](/img/header-only.webp)\n\n![b](/img/good.jpg)\n"
  );
  const { result, warns } = withWarns(() => buildSite(root));

  assert.ok(
    warns.some((w) => w.includes("site/pages/img/header-only.webp") && w.includes("sharp failed")),
    "the failure hint names the file"
  );
  assert.ok(!fs.existsSync(path.join(root, "dist/img/header-only@640.webp")), "no variant for it");
  assert.ok(
    fs.existsSync(path.join(root, "dist/img/good@640.jpg")),
    "the good image still generated"
  );
  assert.equal(result.images.generated, 2, "the good image's two widths");
});

test("an unreadable image file is a hint, not a throw", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/locked.jpg"), 2400, 1600, "jpeg");
  const file = path.join(root, "site/pages/img/locked.jpg");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  fs.chmodSync(file, 0o000);
  let captured;
  try {
    captured = withWarns(() => generateImageVariants(paths));
  } finally {
    fs.chmodSync(file, 0o644);
  }
  assert.ok(
    captured.warns.some((w) => w.includes("locked.jpg") && w.includes("could not be read")),
    "the hint names the unreadable file"
  );
  assert.equal(captured.result.variants.size, 0, "no variants for it");
});

test("hidden-path and symlinked images are never scanned (emitPageAssets would not publish them)", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/real.jpg"), 2400, 1600, "jpeg");
  await makeImage(path.join(root, "site/pages/_drafts/hidden.jpg"), 2400, 1600, "jpeg");
  fs.symlinkSync(
    path.join(root, "site/pages/img/real.jpg"),
    path.join(root, "site/pages/img/linked.jpg")
  );
  const { result } = withWarns(() => buildSite(root));
  assert.equal(result.images.generated, 2, "only the real image's two widths");
  assert.ok(!fs.existsSync(path.join(root, "dist/_drafts/hidden@640.jpg")));
  assert.ok(!fs.existsSync(path.join(root, "dist/img/linked@640.jpg")));
});

test("an incremental rebuild keeps generated variants byte-identical to a full rebuild", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  pageProject(root, "/img/photo.jpg");
  withWarns(() => buildSite(root, { depMap: true }));
  const before = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");

  write(root, "site/pages/index.wd", "---\ntitle: T\n---\n\n![a](/img/photo.jpg)\n\nMore prose.\n");
  const { result } = withWarns(() => buildSite(root, { changed: ["site/pages/index.wd"] }));
  assert.ok(result.incremental, "the rebuild really was incremental");
  assert.deepEqual(
    result.images,
    { generated: 0, cached: 2, unavailable: false },
    "all cache hits"
  );
  const tagOf = (html) => html.match(/<img\b[^>]*>/)?.[0];
  const after = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.match(after, /More prose\./, "sanity: the edit really rebuilt");
  assert.equal(tagOf(after), tagOf(before), "the image markup is untouched by the partial rebuild");
  assert.match(
    tagOf(after) ?? "",
    /srcset="\/img\/photo@640\.jpg 640w, \/img\/photo@1280\.jpg 1280w/
  );
});

// --- compiler-level: the imageVariants map on its own ------------------------

test("compilePage wires generated variants from the imageVariants option alone", async () => {
  const root = freshRoot();
  const source = path.join(root, "site/pages/img/photo.jpg");
  await makeImage(source, 2400, 1600, "jpeg");
  pageProject(root, "/img/photo.jpg");
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), {
    imageVariants: new Map([[source, [640, 1280]]])
  }).html;
  assert.match(
    html,
    /srcset="\/img\/photo@640\.jpg 640w, \/img\/photo@1280\.jpg 1280w, \/img\/photo\.jpg 2400w"/,
    "the map wires srcset without any variant files on disk"
  );
});

test("an author sibling at the same width beats a stale generated-map entry", async () => {
  const root = freshRoot();
  const source = path.join(root, "site/pages/img/photo.jpg");
  await makeImage(source, 2400, 1600, "jpeg");
  await sharp(source)
    .resize({ width: 500 })
    .jpeg()
    .toFile(path.join(root, "site/pages/img/photo@640.jpg"));
  pageProject(root, "/img/photo.jpg");
  const html = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root), {
    imageVariants: new Map([[source, [640, 1280]]])
  }).html;
  assert.match(
    html,
    /srcset="\/img\/photo@640\.jpg 500w, \/img\/photo@1280\.jpg 1280w, \/img\/photo\.jpg 2400w"/,
    "one 640 entry, measured off the author file"
  );
});

// --- the pre-pass module's own seams ------------------------------------------

test("generateImageVariants honors a widths override", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2000, 1200, "jpeg");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  const plan = generateImageVariants(paths, { widths: [480] });
  assert.equal(plan.generated, 1);
  const source = path.join(root, "site/pages/img/photo.jpg");
  assert.deepEqual(plan.variants.get(source), [480]);
  assert.ok(fs.existsSync(path.join(root, "dist/img/photo@480.jpg")));
});

test("a widths override at or above the intrinsic size generates nothing (never upscale)", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 800, 600, "jpeg");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  const plan = generateImageVariants(paths, { widths: [800, 1280] });
  assert.equal(plan.generated, 0);
  assert.equal(plan.variants.size, 0);
});

test("quiet mode suppresses every hint (dev-server rebuilds)", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  write(root, "site/pages/img/broken.jpg", "not an image");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  const { warns, result: plan } = withWarns(() =>
    generateImageVariants(paths, {
      quiet: true,
      runJobs: () => ({ unavailable: true, failed: [] })
    })
  );
  assert.equal(plan.unavailable, true, "the unavailable result is still recorded");
  assert.deepEqual(warns, [], "neither the corrupt-file hint nor the sharp hint prints");
});

test("the sharp-absent hint lists every image with uncached work, pluralized", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/a.jpg"), 2400, 1600, "jpeg");
  await makeImage(path.join(root, "site/pages/img/b.png"), 2000, 1200, "png");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  const { warns, result: plan } = withWarns(() =>
    generateImageVariants(paths, { runJobs: () => ({ unavailable: true, failed: [] }) })
  );
  assert.equal(plan.unavailable, true);
  assert.equal(plan.variants.size, 0, "nothing materialized");
  assert.equal(warns.length, 1);
  assert.match(
    warns[0],
    /2 images could gain responsive variants \(site\/pages\/img\/a\.jpg, site\/pages\/img\/b\.png\)/
  );
});

test("cached variants still ship when sharp later goes missing", async () => {
  const root = freshRoot();
  await makeImage(path.join(root, "site/pages/img/photo.jpg"), 2400, 1600, "jpeg");
  const paths = createPaths(root);
  fs.mkdirSync(paths.distRoot, { recursive: true });
  generateImageVariants(paths); // fills the cache with real sharp
  const { result: plan, warns } = withWarns(() =>
    generateImageVariants(paths, { runJobs: () => ({ unavailable: true, failed: [] }) })
  );
  assert.equal(plan.cached, 2, "served from cache without sharp");
  assert.equal(plan.unavailable, false, "no pending work means the unavailable flag never set");
  assert.deepEqual(
    warns.filter((w) => w.includes("npm i -D sharp")),
    [],
    "no hint when nothing needs sharp"
  );
  assert.ok(fs.existsSync(path.join(root, "dist/img/photo@640.jpg")));
});

test("runResizeJobs reports unavailable when the worker leaves no results file", () => {
  const result = runResizeJobs([], () => {});
  assert.deepEqual(result, { unavailable: true, failed: [] });
});

test("runResizeJobs reports unavailable when the worker writes garbage", () => {
  const result = runResizeJobs([], (_cmd, args) => {
    fs.writeFileSync(args[2], "not json");
  });
  assert.deepEqual(result, { unavailable: true, failed: [] });
});

// --- the worker, in process (the child-process path is covered by the builds) --

test("the worker resizes all three formats and reports per-job failures", async () => {
  const root = freshRoot();
  const jobsDir = path.join(root, "jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  const jpeg = path.join(root, "a.jpg");
  const webp = path.join(root, "b.webp");
  const png = path.join(root, "c.png");
  await makeImage(jpeg, 2000, 1200, "jpeg");
  await makeImage(webp, 2000, 1200, "webp");
  await makeImage(png, 2000, 1200, "png");
  const corrupt = path.join(root, "corrupt.webp");
  fs.writeFileSync(corrupt, fakeWebpHeader(2400, 1600));
  const jobs = [
    { source: jpeg, out: path.join(jobsDir, "a@1280.jpg"), width: 1280, format: "jpeg" },
    { source: webp, out: path.join(jobsDir, "b@1280.webp"), width: 1280, format: "webp" },
    { source: png, out: path.join(jobsDir, "c@1280.png"), width: 1280, format: "png" },
    { source: corrupt, out: path.join(jobsDir, "d@1280.webp"), width: 1280, format: "webp" }
  ];
  const jobsFile = path.join(root, "jobs.json");
  const resultsFile = path.join(root, "results.json");
  fs.writeFileSync(jobsFile, JSON.stringify(jobs));
  await runJobsFile(jobsFile, resultsFile);

  const result = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  assert.equal(result.unavailable, false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].file, corrupt);
  assert.equal(result.failed[0].width, 1280);
  assert.ok(result.failed[0].error.length > 0, "the sharp error message travels back");
  assert.equal(widthOf(path.join(jobsDir, "a@1280.jpg")), 1280);
  assert.equal(widthOf(path.join(jobsDir, "b@1280.webp")), 1280);
  assert.equal(widthOf(path.join(jobsDir, "c@1280.png")), 1280);
  assert.ok(!fs.existsSync(path.join(jobsDir, "d@1280.webp")), "the failed job wrote nothing");
});

test("the worker reports unavailable when sharp cannot load", async () => {
  const root = freshRoot();
  const jobsFile = path.join(root, "jobs.json");
  const resultsFile = path.join(root, "results.json");
  fs.writeFileSync(
    jobsFile,
    JSON.stringify([{ source: "x", out: "y", width: 640, format: "jpeg" }])
  );
  const previous = process.env.WD_SHARP_MODULE;
  process.env.WD_SHARP_MODULE = "/nonexistent/sharp";
  try {
    await runJobsFile(jobsFile, resultsFile);
  } finally {
    if (previous === undefined) delete process.env.WD_SHARP_MODULE;
    else process.env.WD_SHARP_MODULE = previous;
  }
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
