// F5 — favicon convention + `icon:` frontmatter.
// F8 — `noindex: true` frontmatter: robots meta in the head, and exclusion
// from sitemap.xml / rss.xml / llms.txt.
//
// F5 existence checks run through the injected reader, so most tests compile
// from memory — that is exactly the reader-compile parity the feature needs.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compileFromMemory } from "../src/compiler.js";

const ENTRY = "site/pages/index.wd";
const compile = (files) => compileFromMemory(files, ENTRY).html;

// ---------------------------------------------------------------------------
// F5 — favicon resolution
// ---------------------------------------------------------------------------

test("no icon anywhere keeps the built-in data-URI favicon", () => {
  const html = compile({ [ENTRY]: "# Hi\n" });
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.doesNotMatch(html, /rel="icon" href="[^"]*" type=/);
});

test("icon: frontmatter wins and gets the svg type", () => {
  const html = compile({ [ENTRY]: "---\nicon: /brand/mark.svg\n---\n# Hi\n" });
  assert.match(html, /<link rel="icon" href="\/brand\/mark\.svg" type="image\/svg\+xml">/);
});

test("icon: maps png and ico extensions to their MIME types", () => {
  for (const [href, type] of [
    ["/favicon.png", "image/png"],
    ["/favicon.ico", "image/x-icon"],
    ["https://cdn.example.com/f.png", "image/png"]
  ]) {
    const html = compile({ [ENTRY]: `---\nicon: ${href}\n---\n# Hi\n` });
    assert.match(
      html,
      new RegExp(`<link rel="icon" href="${href.replace(/[/.]/g, "\\$&")}" type="${type}">`)
    );
  }
});

test("icon: with an unknown extension emits no type attribute", () => {
  const html = compile({ [ENTRY]: "---\nicon: /favicon.webp\n---\n# Hi\n" });
  assert.match(html, /<link rel="icon" href="\/favicon\.webp">/);
});

test("icon: frontmatter beats a convention file", () => {
  const html = compile({
    [ENTRY]: "---\nicon: /custom.svg\n---\n# Hi\n",
    "site/pages/icon.svg": "<svg></svg>"
  });
  assert.match(html, /<link rel="icon" href="\/custom\.svg"/);
  assert.doesNotMatch(html, /href="\/icon\.svg"/);
});

test("site/pages/icon.svg is picked up by convention", () => {
  const html = compile({
    [ENTRY]: "# Hi\n",
    "site/pages/icon.svg": "<svg></svg>"
  });
  assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/);
});

test("the convention prefers icon.svg over icon.png over favicon.ico", () => {
  const all = {
    [ENTRY]: "# Hi\n",
    "site/pages/icon.svg": "<svg></svg>",
    "site/pages/icon.png": "png",
    "site/pages/favicon.ico": "ico"
  };
  assert.match(compile(all), /href="\/icon\.svg"/);
  const { "site/pages/icon.svg": _, ...noSvg } = all;
  assert.match(compile(noSvg), /href="\/icon\.png" type="image\/png"/);
  assert.match(
    compile({ [ENTRY]: "# Hi\n", "site/pages/favicon.ico": "ico" }),
    /href="\/favicon\.ico" type="image\/x-icon"/
  );
});

test("an icon href with a quote is HTML-escaped", () => {
  const html = compile({ [ENTRY]: '---\nicon: /we"ird.svg\n---\n# Hi\n' });
  assert.match(html, /href="\/we&quot;ird\.svg"/);
});

// ---------------------------------------------------------------------------
// F8 — noindex head meta
// ---------------------------------------------------------------------------

test("noindex: true emits a noindex,nofollow robots meta", () => {
  const html = compile({ [ENTRY]: "---\nnoindex: true\n---\n# Hi\n" });
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});

test("noindex: false (or absent) emits no robots meta", () => {
  assert.doesNotMatch(compile({ [ENTRY]: "---\nnoindex: false\n---\n# Hi\n" }), /name="robots"/);
  assert.doesNotMatch(compile({ [ENTRY]: "# Hi\n" }), /name="robots"/);
});

// ---------------------------------------------------------------------------
// F8 — feed + llms.txt exclusion (whole-site build)
// ---------------------------------------------------------------------------

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("noindex routes are excluded from sitemap.xml, rss.xml, and llms.txt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-noindex-"));
  write(
    root,
    "site/pages/index.wd",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n# Home\n"
  );
  write(
    root,
    "site/pages/blog/public-post.md",
    "---\ntitle: Public\ndate: 2026-10-01\n---\nShown.\n"
  );
  write(
    root,
    "site/pages/blog/hidden-post.md",
    "---\ntitle: Hidden\ndate: 2026-10-02\nnoindex: true\n---\nSecret.\n"
  );
  write(root, "site/pages/internal.md", "---\ntitle: Internal\nnoindex: true\n---\nStaff only.\n");
  buildSite(root);

  const sitemap = read(root, "dist/sitemap.xml");
  assert.match(sitemap, /\/blog\/public-post\//);
  assert.doesNotMatch(sitemap, /hidden-post/);
  assert.doesNotMatch(sitemap, /\/internal\//);

  const rss = read(root, "dist/rss.xml");
  assert.match(rss, /Public/);
  assert.doesNotMatch(rss, /Hidden/);

  const llms = read(root, "dist/llms.txt");
  const llmsFull = read(root, "dist/llms-full.txt");
  for (const corpus of [llms, llmsFull]) {
    assert.match(corpus, /public-post/);
    assert.doesNotMatch(corpus, /hidden-post/);
    assert.doesNotMatch(corpus, /Internal/);
  }

  // The built page itself still ships, carrying its robots meta.
  const page = read(root, "dist/blog/hidden-post/index.html");
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
});

test("a draft + noindex page stays fully excluded, as drafts already are", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-draft-noindex-"));
  write(
    root,
    "site/pages/index.wd",
    "---\ntitle: Home\nsite_url: https://example.com\n---\n# Home\n"
  );
  write(root, "site/pages/blog/post.md", "---\ntitle: Post\ndate: 2026-10-01\n---\nShown.\n");
  write(
    root,
    "site/pages/blog/wip.md",
    "---\ntitle: Wip\ndate: 2026-10-03\ndraft: true\nnoindex: true\n---\nUnfinished.\n"
  );
  buildSite(root);

  assert.equal(fs.existsSync(path.join(root, "dist/blog/wip/index.html")), false);
  const sitemap = read(root, "dist/sitemap.xml");
  assert.doesNotMatch(sitemap, /wip/);
  assert.doesNotMatch(read(root, "dist/rss.xml"), /Wip/);
});
