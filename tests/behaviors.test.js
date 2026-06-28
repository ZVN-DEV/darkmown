import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-behaviors-"));
}
function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
/** Compile a single index.wd body and return the compiled page. */
function compile(root, body) {
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: T", "---", "", "<main>", body, "</main>"].join("\n")
  );
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

// --- :slider (compile-time, no behavior module) ----------------------------

test(":slider = value declares numeric state and emits a bound range input", () => {
  const page = compile(fixture(), ":slider volume = 40 min=0 max=100 step=5\n\nLevel: { volume }");
  assert.match(
    page.html,
    /<input type="range" data-wd-bind-input="volume" min="0" max="100" step="5" value="40"/
  );
  assert.match(page.html, /aria-label="Volume"/);
  // state is seeded as a number (no quotes around 40)
  assert.match(page.html, /data-wd-state[^>]*>\s*{\s*"volume":\s*40\s*}/);
  assert.equal(page.assets.runtime, true);
  assert.equal(page.assets.behaviors.has("slider"), false, ":slider ships no behavior module");
  assert.equal(page.assets.behaviors.size, 0);
});

test(":slider with no '=' binds to existing state; custom aria-label wins", () => {
  const page = compile(
    fixture(),
    ':state level = 3\n\n:slider level min=1 max=5 aria-label="Spice"'
  );
  assert.match(
    page.html,
    /<input type="range" data-wd-bind-input="level" min="1" max="5" step="1" value="3" aria-label="Spice">/
  );
});

test(":slider errors: unknown attr, non-numeric min, persist w/o declaration, missing state", () => {
  assert.throws(() => compile(fixture(), ":slider v = 1 foo=2"), /Unknown :slider attribute "foo"/);
  assert.throws(() => compile(fixture(), ":slider v = 1 min=lots"), /:slider min must be a number/);
  assert.throws(
    () => compile(fixture(), ":slider v min=0 persist"),
    /persist only applies when declaring/
  );
  assert.throws(() => compile(fixture(), ":slider ghost min=0"), /has no matching state/);
  assert.throws(() => compile(fixture(), ":slider 123"), /Malformed :slider/);
  assert.throws(() => compile(fixture(), ":slider v ="), /Malformed :slider initial value/);
  assert.throws(() => compile(fixture(), ':slider v = "x"'), /initial value must be a number/);
});

// --- :sortable (loop clause + behavior module) -----------------------------

test(":sortable tags the loop region and registers the sortable behavior", () => {
  const page = compile(
    fixture(),
    ':store tasks = ["a","b","c"]\n\n@loop tasks into t sortable\n- { t }\n@endloop'
  );
  assert.match(page.html, /data-wd-loop="tasks"[^>]*data-wd-sortable="tasks"/);
  assert.equal(page.assets.behaviors.has("sortable"), true);
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /<script type="module" src="\/__wd\/behaviors\/sortable\.js"><\/script>/);
});

test(":sortable rejects clause combos and non-state sources", () => {
  assert.throws(
    () =>
      compile(fixture(), ":store xs = [1]\n\n@loop xs into x sortable reverse\n- { x }\n@endloop"),
    /sortable cannot combine with where\/sort\/reverse/
  );
  write(fixture(), "x", ""); // unused; the json source below points elsewhere
  const root = fixture();
  write(root, "site/_/items.json", "[1,2,3]");
  assert.throws(
    () => compile(root, "@loop /items.json into i sortable\n- { i }\n@endloop"),
    /sortable requires a :state or :store list/
  );
});

test(":sortable is rejected on a nested (item-relative) loop", () => {
  assert.throws(
    () =>
      compile(
        fixture(),
        [
          ':store teams = [{"id":1,"members":["a","b"]}]',
          "@loop teams into team",
          "@loop team.members into m sortable",
          "- { m }",
          "@endloop",
          "@endloop"
        ].join("\n")
      ),
    /sortable is not supported on a nested/
  );
});

// --- :carousel (behavior module, no runtime required) ----------------------

test(":carousel emits the track + registers the carousel behavior without the runtime", () => {
  const page = compile(fixture(), ":carousel\n\n## One\n\n## Two\n\n:endcarousel");
  assert.match(page.html, /<div class="wd-carousel" data-wd-carousel>/);
  assert.match(page.html, /<div class="wd-carousel-track" data-wd-carousel-track>/);
  assert.equal(page.assets.behaviors.has("carousel"), true);
  assert.equal(page.assets.runtime, false, "a static carousel ships no reactive runtime");
  assert.match(page.html, /<script type="module" src="\/__wd\/behaviors\/carousel\.js"><\/script>/);
  // ...and NOT the runtime, since nothing on the page is reactive
  assert.doesNotMatch(page.html, /\/__wd\/runtime\.js/);
});

test(":carousel autoplay=N sets the autoplay attribute", () => {
  const page = compile(fixture(), ":carousel autoplay=3000\n\n## A\n\n:endcarousel");
  assert.match(page.html, /data-wd-carousel-autoplay="3000"/);
});

test(":carousel rejects a malformed option", () => {
  assert.throws(
    () => compile(fixture(), ":carousel speed=fast\n\n## A\n\n:endcarousel"),
    /Malformed :carousel/
  );
});

// --- emission --------------------------------------------------------------

test("build emits only the behavior modules a page uses, into dist/__wd/behaviors", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: T",
      "---",
      "",
      "<main>",
      ":carousel",
      "",
      "## A",
      "",
      ":endcarousel",
      "</main>"
    ].join("\n")
  );
  write(
    root,
    "site/pages/board.wd",
    [
      "---",
      "title: B",
      "---",
      "",
      "<main>",
      ':store items = ["x","y"]',
      "",
      "@loop items into i sortable",
      "- { i }",
      "@endloop",
      "</main>"
    ].join("\n")
  );
  const { distRoot } = buildSite(root);
  assert.ok(fs.existsSync(path.join(distRoot, "__wd/behaviors/carousel.js")));
  assert.ok(fs.existsSync(path.join(distRoot, "__wd/behaviors/sortable.js")));

  const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "routes.json"), "utf8"));
  const board = manifest.find((r) => r.route === "/board/");
  assert.ok(board.assets.scripts.includes("/__wd/behaviors/sortable.js"));
  // runtime loads before the behavior that depends on it
  assert.ok(
    board.assets.scripts.indexOf("/__wd/runtime.js") <
      board.assets.scripts.indexOf("/__wd/behaviors/sortable.js")
  );
});
