// Markdown-source publishing (src/builder.js, src/compiler/page.js, src/statics.js).
//
// `md_source: true` in the HOME page frontmatter opts the whole site into
// serving every page's source BYTE-EXACT at `<route>.md` (`/` → `/index.md`,
// `/docs/` → `/docs.md`), advertised with a
// `<link rel="alternate" type="text/markdown">` in the head so agents can
// autodiscover it. A page opts out with `md_source: false`. Off by default,
// drafts never emit, and sitemap.xml/rss.xml never list the alternates.
//
// The incremental tests are differential where it matters: a changed build's
// dist must equal a from-scratch build of the same source, whatever it contains.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite, DEP_MAP_FILE } from "../src/builder.js";
import { compileFromMemory } from "../src/compiler.js";
import { contentType, isCompressibleType, serve } from "../src/statics.js";

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(root, file) {
  return fs.existsSync(path.join(root, file));
}

/** Byte-level equality: the emitted copy must BE the source file. */
function assertByteExact(root, source, emitted) {
  assert.deepEqual(
    fs.readFileSync(path.join(root, emitted)),
    fs.readFileSync(path.join(root, source)),
    `${emitted} is not a byte-exact copy of ${source}`
  );
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

const build = (root, options) => withWarns(() => buildSite(root, options)).result;
const devBuild = (root) => build(root, { depMap: true });
const changedBuild = (root, changed) => withWarns(() => buildSite(root, { changed }));

const HOME_ON = "---\ntitle: Home\nsite_url: https://example.com\nmd_source: true\n---\n\n# Home\n";
// CRLF on purpose: a byte-exact copy survives line endings no compile touches.
const DOCS_WD = "---\r\ntitle: Docs\r\n---\r\n\r\n:state n = 1\r\n\r\nDocs { n }.\r\n";
const POST_MD = "---\ntitle: Post\ndate: 2026-01-01\n---\n\nPost body.\n";

/** A small opted-in site: .md and .wd pages, a dated post, an opt-out, a draft. */
function optedInSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-"));
  write(root, "site/pages/index.md", HOME_ON);
  write(root, "site/pages/docs.wd", DOCS_WD);
  write(root, "site/pages/blog/post.md", POST_MD);
  write(
    root,
    "site/pages/secret.md",
    "---\ntitle: Secret\nmd_source: false\n---\n\nNot for agents.\n"
  );
  write(root, "site/pages/draft.md", "---\ntitle: Draft\ndraft: true\n---\n\nUnpublished.\n");
  write(root, "site/pages/404.wd", "---\ntitle: Missing\n---\n\n# Lost\n");
  return root;
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

test("off by default: no .md files and no alternate link without the home opt-in", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-off-"));
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n\n# Home\n");
  write(root, "site/pages/docs.wd", DOCS_WD);
  build(root);

  assert.equal(exists(root, "dist/index.md"), false);
  assert.equal(exists(root, "dist/docs.md"), false);
  assert.doesNotMatch(read(root, "dist/index.html"), /text\/markdown/);
  assert.doesNotMatch(read(root, "dist/docs/index.html"), /text\/markdown/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a page-level md_source: true does nothing without the home opt-in", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-pageonly-"));
  write(root, "site/pages/index.md", "---\ntitle: Home\n---\n\n# Home\n");
  write(root, "site/pages/eager.md", "---\ntitle: Eager\nmd_source: true\n---\n\nPublish me?\n");
  build(root);

  assert.equal(exists(root, "dist/eager.md"), false);
  assert.doesNotMatch(read(root, "dist/eager/index.html"), /text\/markdown/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

test("opt-in emits byte-exact sources at <route>.md for .md and .wd pages", () => {
  const root = optedInSite();
  build(root);

  assertByteExact(root, "site/pages/index.md", "dist/index.md");
  assertByteExact(root, "site/pages/docs.wd", "dist/docs.md");
  assertByteExact(root, "site/pages/blog/post.md", "dist/blog/post.md");
  // The 404 route is a route like any other; its source publishes too.
  assertByteExact(root, "site/pages/404.wd", "dist/404.md");
  fs.rmSync(root, { recursive: true, force: true });
});

test("opted-in pages advertise the markdown alternate in the head", () => {
  const root = optedInSite();
  build(root);

  const link = (href) =>
    `<link rel="alternate" type="text/markdown" href="${href}" title="Markdown source">`;
  assert.match(read(root, "dist/index.html"), new RegExp(escapeRe(link("/index.md"))));
  assert.match(read(root, "dist/docs/index.html"), new RegExp(escapeRe(link("/docs.md"))));
  assert.match(
    read(root, "dist/blog/post/index.html"),
    new RegExp(escapeRe(link("/blog/post.md")))
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("md_source: false opts one page out; the rest of the site still publishes", () => {
  const root = optedInSite();
  build(root);

  assert.equal(exists(root, "dist/secret.md"), false, "the opted-out page emits no source");
  assert.equal(exists(root, "dist/secret/index.html"), true, "the page itself still builds");
  assert.doesNotMatch(read(root, "dist/secret/index.html"), /text\/markdown/);
  assert.match(read(root, "dist/index.html"), /text\/markdown/);
  assertByteExact(root, "site/pages/docs.wd", "dist/docs.md");
  fs.rmSync(root, { recursive: true, force: true });
});

test("drafts never emit a markdown source", () => {
  const root = optedInSite();
  build(root);

  assert.equal(exists(root, "dist/draft/index.html"), false, "drafts are excluded upstream");
  assert.equal(exists(root, "dist/draft.md"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a paginated listing publishes its source under every generated page route", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-paged-"));
  write(root, "site/pages/index.md", HOME_ON);
  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\n---\n@loop news into n sort by n.title paginate 1\n- { n.title }\n@endloop\n"
  );
  write(root, "site/pages/news/a.md", "---\ntitle: Alpha\n---\n\nA.\n");
  write(root, "site/pages/news/b.md", "---\ntitle: Beta\n---\n\nB.\n");
  build(root);

  assertByteExact(root, "site/pages/news/index.wd", "dist/news.md");
  assertByteExact(root, "site/pages/news/index.wd", "dist/news/page/2.md");
  assert.match(read(root, "dist/news/index.html"), /href="\/news\.md"/);
  assert.match(read(root, "dist/news/page/2/index.html"), /href="\/news\/page\/2\.md"/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Discovery surfaces stay clean
// ---------------------------------------------------------------------------

test("sitemap.xml, rss.xml, and robots.txt never mention the .md alternates", () => {
  const root = optedInSite();
  build(root);

  const sitemap = read(root, "dist/sitemap.xml");
  const rss = read(root, "dist/rss.xml");
  const robots = read(root, "dist/robots.txt");
  assert.doesNotMatch(sitemap, /\.md</, "sitemap lists a markdown alternate");
  assert.doesNotMatch(rss, /\.md</, "rss lists a markdown alternate");
  assert.doesNotMatch(robots, /\.md/, "robots mentions a markdown alternate");
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Head link at the compile layer
// ---------------------------------------------------------------------------

test("compileFromMemory advertises the alternate only when mdSource is passed", () => {
  const files = { "site/pages/index.wd": "# Hi\n" };
  const withLink = compileFromMemory(files, "site/pages/index.wd", {
    mdSource: { href: "/index.md" }
  }).html;
  assert.match(
    withLink,
    /<link rel="alternate" type="text\/markdown" href="\/index\.md" title="Markdown source">/
  );
  const without = compileFromMemory(files, "site/pages/index.wd").html;
  assert.doesNotMatch(without, /text\/markdown/);
});

test("the alternate link's href is HTML-escaped", () => {
  const html = compileFromMemory({ "site/pages/index.wd": "# Hi\n" }, "site/pages/index.wd", {
    mdSource: { href: '/we"ird.md' }
  }).html;
  assert.match(html, /href="\/we&quot;ird\.md"/);
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

test(".md serves as text/markdown and the body is the byte-exact source", async () => {
  const root = optedInSite();
  const { distRoot } = build(root);

  assert.equal(contentType(path.join(distRoot, "docs.md")), "text/markdown; charset=utf-8");
  assert.equal(isCompressibleType(contentType(path.join(distRoot, "docs.md"))), true);

  const res = await request(distRoot, "/docs.md");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/markdown; charset=utf-8");
  assert.equal(res.body, fs.readFileSync(path.join(root, "site/pages/docs.wd"), "utf8"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("the markdown alternate negotiates compression like any text type", async () => {
  const root = optedInSite();
  const { distRoot } = build(root);

  const res = await request(distRoot, "/docs.md", { "accept-encoding": "gzip" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-encoding"], "gzip");
  assert.match(String(res.headers.vary), /Accept-Encoding/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Incremental builds
// ---------------------------------------------------------------------------

test("an incremental rebuild refreshes the copy and stays identical to a full rebuild", () => {
  const root = optedInSite();
  devBuild(root);

  // The edit keeps `:state` so the page stays reactive: an incremental dev
  // build never prunes a no-longer-referenced /__wd/runtime.js, so flipping
  // reactiveness here would fail the differential on a pre-existing dev quirk
  // that has nothing to do with md_source.
  write(
    root,
    "site/pages/docs.wd",
    "---\ntitle: Docs v2\n---\n\n:state n = 2\n\nRewritten { n }.\n"
  );
  const { result } = changedBuild(root, ["site/pages/docs.wd"]);
  assert.deepEqual(result.incremental.rebuilt, ["/docs/"]);

  assertByteExact(root, "site/pages/docs.wd", "dist/docs.md");
  assert.match(read(root, "dist/docs/index.html"), /href="\/docs\.md"/);
  assertDistEqual(snapshotDist(root), fullRebuildOfSameSource(root));
  fs.rmSync(root, { recursive: true, force: true });
});

test("opting a page out incrementally withdraws its published source", () => {
  const root = optedInSite();
  devBuild(root);
  assertByteExact(root, "site/pages/docs.wd", "dist/docs.md");

  write(
    root,
    "site/pages/docs.wd",
    "---\ntitle: Docs\nmd_source: false\n---\n\n:state n = 1\n\nNow private { n }.\n"
  );
  const { result } = changedBuild(root, ["site/pages/docs.wd"]);
  assert.deepEqual(result.incremental.rebuilt, ["/docs/"]);

  assert.equal(exists(root, "dist/docs.md"), false, "the stale copy was removed");
  assert.doesNotMatch(read(root, "dist/docs/index.html"), /text\/markdown/);
  assertDistEqual(snapshotDist(root), fullRebuildOfSameSource(root));
  fs.rmSync(root, { recursive: true, force: true });
});

test("flipping the home md_source flag forces a full rebuild (and withdraws on off)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-flip-"));
  // `site_url` is present from the start so the ONLY whole-site value that
  // changes below is `md_source` (site_url's own check fires first otherwise).
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  write(root, "site/pages/docs.wd", DOCS_WD);
  devBuild(root);
  assert.equal(exists(root, "dist/docs.md"), false);

  // Flip ON: every page's head gains the link, so a partial rebuild is impossible.
  write(root, "site/pages/index.md", HOME_ON);
  const on = changedBuild(root, ["site/pages/index.md"]);
  assert.equal(on.result.incremental, undefined, "a site-flag flip must rebuild fully");
  assert.ok(on.warns.some((warn) => /full rebuild — md_source changed/.test(warn)));
  assertByteExact(root, "site/pages/docs.wd", "dist/docs.md");

  // Flip OFF: the full rebuild wipes the now-unwanted copies from dist.
  write(
    root,
    "site/pages/index.md",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n\n# Home\n"
  );
  const off = changedBuild(root, ["site/pages/index.md"]);
  assert.equal(off.result.incremental, undefined);
  assert.equal(exists(root, "dist/docs.md"), false);
  assert.equal(exists(root, "dist/index.md"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a shrunk pagination removes the stale page's markdown copy too", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-shrink-"));
  write(root, "site/pages/index.md", HOME_ON);
  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\n---\n@loop news into n sort by n.title paginate 1\n- { n.title }\n@endloop\n"
  );
  write(root, "site/pages/news/a.md", "---\ntitle: Alpha\n---\n\nA.\n");
  write(root, "site/pages/news/b.md", "---\ntitle: Beta\n---\n\nB.\n");
  devBuild(root);
  assert.equal(exists(root, "dist/news/page/2.md"), true);

  // Widen the page size: one page now holds both entries, so /news/page/2/ dies.
  write(
    root,
    "site/pages/news/index.wd",
    "---\ntitle: News\n---\n@loop news into n sort by n.title paginate 2\n- { n.title }\n@endloop\n"
  );
  changedBuild(root, ["site/pages/news/index.wd"]);

  assert.equal(exists(root, "dist/news/page/2/index.html"), false);
  assert.equal(exists(root, "dist/news/page/2.md"), false, "the stale markdown copy is gone");
  assertByteExact(root, "site/pages/news/index.wd", "dist/news.md");
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every file under `dist/`, path → contents. The dependency map itself is
 * excluded: it is build bookkeeping, not published output (mirrors
 * tests/builder-whole-site.test.js).
 */
function snapshotDist(root) {
  const distRoot = path.join(root, "dist");
  /** @type {Record<string, Buffer>} */
  const files = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name !== DEP_MAP_FILE) {
        files[path.relative(distRoot, abs).replaceAll(path.sep, "/")] = fs.readFileSync(abs);
      }
    }
  };
  walk(distRoot);
  return files;
}

/** Build the SAME source tree from scratch in a pristine copy; the reference snapshot. */
function fullRebuildOfSameSource(root) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "wd-mdsource-ref-"));
  fs.cpSync(path.join(root, "site"), path.join(copy, "site"), { recursive: true });
  build(copy);
  const snapshot = snapshotDist(copy);
  fs.rmSync(copy, { recursive: true, force: true });
  return snapshot;
}

/**
 * Differential assertion, incremental dist vs full-rebuild dist. Compared
 * per file with a small message instead of one deepEqual over the whole map:
 * a failing deepEqual would serialize megabytes of Buffers (the runtime
 * sourcemap alone is ~90 KB) into the TAP stream, which stalls the runner.
 */
function assertDistEqual(actual, expected) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    "the incremental and full-rebuild dist file lists differ"
  );
  for (const name of Object.keys(actual)) {
    assert.ok(
      actual[name].equals(expected[name]),
      `${name} differs between the incremental and full rebuild`
    );
  }
}

/** Spin up the real static server and make an actual HTTP request. */
function request(distRoot, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) =>
      serve(distRoot, req.url || "/", res, { acceptEncoding: req.headers["accept-encoding"] })
    );
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      http
        .get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString()
            });
          });
        })
        .on("error", (error) => {
          server.close();
          reject(error);
        });
    });
  });
}
