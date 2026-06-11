import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRoutes } from "../src/router.js";

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

  assert.throws(
    () => discoverRoutes(path.join(root, "site/pages")),
    /Duplicate route "\/"/
  );
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-router-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
