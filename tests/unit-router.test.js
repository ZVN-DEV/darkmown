import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverRoutes, outputPathForRoute, routeFromFile } from "../src/router.js";

// ---------------------------------------------------------------------------
// Router pure functions: routeFromFile, outputPathForRoute, and discoverRoutes
// edge cases (nested dirs, sort order, empty root, hidden-dir pruning).
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-router2-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// --- routeFromFile ----------------------------------------------------------

test("routeFromFile maps index files to their directory route", () => {
  const root = "/site/pages";
  assert.equal(routeFromFile(root, "/site/pages/index.wd"), "/");
  assert.equal(routeFromFile(root, "/site/pages/docs/index.md"), "/docs/");
  assert.equal(routeFromFile(root, "/site/pages/a/b/index.wd"), "/a/b/");
});

test("routeFromFile maps non-index files to a named trailing-slash route", () => {
  const root = "/site/pages";
  assert.equal(routeFromFile(root, "/site/pages/about.wd"), "/about/");
  assert.equal(routeFromFile(root, "/site/pages/blog/post.md"), "/blog/post/");
});

test("routeFromFile strips the extension regardless of .md/.wd", () => {
  const root = "/site/pages";
  assert.equal(routeFromFile(root, "/site/pages/x.md"), "/x/");
  assert.equal(routeFromFile(root, "/site/pages/x/index.wd"), "/x/");
});

// --- outputPathForRoute -----------------------------------------------------

test("outputPathForRoute maps the home route to dist/index.html", () => {
  assert.equal(outputPathForRoute("/dist", "/"), path.join("/dist", "index.html"));
});

test("outputPathForRoute maps named routes to nested index.html files", () => {
  assert.equal(outputPathForRoute("/dist", "/about/"), path.join("/dist", "about", "index.html"));
  assert.equal(
    outputPathForRoute("/dist", "/blog/post/"),
    path.join("/dist", "blog", "post", "index.html")
  );
});

test("outputPathForRoute rejects a route that resolves outside distRoot", () => {
  assert.throws(() => outputPathForRoute("/dist", "/../escape/"), /outside the build output/);
  assert.throws(
    () => outputPathForRoute("/dist", "/blog/../../escape/"),
    /outside the build output/
  );
  // A dot-dot that stays inside the root is contained, not rejected.
  assert.equal(
    outputPathForRoute("/dist", "/blog/../about/"),
    path.join("/dist", "about", "index.html")
  );
});

// --- discoverRoutes ---------------------------------------------------------

test("discoverRoutes returns an empty list for a missing root", () => {
  assert.deepEqual(discoverRoutes("/does/not/exist/at/all"), []);
});

test("discoverRoutes recurses nested dirs and returns routes sorted by path", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/zeta.wd", "# Z");
  write(root, "site/pages/alpha/index.md", "# A");
  write(root, "site/pages/beta/deep/index.wd", "# B");

  const routes = discoverRoutes(path.join(root, "site/pages"));
  assert.deepEqual(
    routes.map((r) => r.route),
    ["/", "/alpha/", "/beta/deep/", "/zeta/"]
  );
  // every entry carries an absolute file path that exists
  for (const r of routes) assert.equal(fs.existsSync(r.file), true);
});

test("discoverRoutes prunes whole hidden directories (dot/dash/underscore)", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Home");
  write(root, "site/pages/_partials/x.wd", "# hidden by dir");
  write(root, "site/pages/-drafts/y.wd", "# hidden by dir");
  write(root, "site/pages/.git/z.wd", "# hidden by dir");

  const routes = discoverRoutes(path.join(root, "site/pages")).map((r) => r.route);
  assert.deepEqual(routes, ["/"]);
});

test("discoverRoutes throws on a duplicate route across extensions", () => {
  const root = fixture();
  write(root, "site/pages/about.wd", "# A");
  write(root, "site/pages/about.md", "# B");
  assert.throws(() => discoverRoutes(path.join(root, "site/pages")), /Duplicate route "\/about\/"/);
});
