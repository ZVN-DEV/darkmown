import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRoutes, isDraft } from "../src/router.js";

test("discovers md and wd routes while hiding dot/minus/underscore names and skipping mdx", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/docs/index.md", "# Docs");
  write(root, "site/pages/lab.mdx", "# Not a page format");
  write(root, "site/pages/-draft.wd", "# Draft");
  write(root, "site/pages/docs/-note.wd", "# Hidden include");
  write(root, "site/pages/.secret.wd", "# Secret");
  write(root, "site/pages/_support/page.wd", "# Support");

  const routes = discoverRoutes(path.join(root, "site/pages")).map((route) => route.route);
  assert.deepEqual(routes, ["/", "/docs/"]);
});

test("duplicate route candidates fail clearly", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/index.md", "# Duplicate");

  assert.throws(() => discoverRoutes(path.join(root, "site/pages")), /Duplicate route "\/"/);
});

test("discoverRoutes attaches parsed frontmatter as route.meta", () => {
  const root = fixture();
  write(root, "site/pages/post.md", "---\ntitle: Post\ndate: 2026-06-01\n---\n\nBody");
  const [route] = discoverRoutes(path.join(root, "site/pages"));
  assert.equal(route.meta.title, "Post");
  assert.equal(route.meta.date, "2026-06-01");
});

test("draft: true pages are excluded by default but kept with includeDrafts", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/live.md", "---\ntitle: Live\n---\n\nShipped");
  write(root, "site/pages/wip.md", "---\ntitle: WIP\ndraft: true\n---\n\nDraft");

  const production = discoverRoutes(path.join(root, "site/pages")).map((r) => r.route);
  assert.deepEqual(production, ["/", "/live/"]);

  const staging = discoverRoutes(path.join(root, "site/pages"), { includeDrafts: true }).map(
    (r) => r.route
  );
  assert.deepEqual(staging, ["/", "/live/", "/wip/"]);
});

test('isDraft recognizes boolean true and the string "true" only', () => {
  assert.equal(isDraft({ draft: true }), true);
  assert.equal(isDraft({ draft: "true" }), true);
  assert.equal(isDraft({ draft: false }), false);
  assert.equal(isDraft({ draft: "false" }), false);
  assert.equal(isDraft({}), false);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-router-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
