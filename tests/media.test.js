// Media directives — :video / :audio / :embed. Compile-time only, zero runtime.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-media-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  return compileDocument(pageFile, createPaths(root));
}

test(":video emits a hardened <video> and ships zero JS", () => {
  const doc = compile(`:video /clip.mp4`);
  assert.equal(doc.assets.runtime, false, "media is compile-time only");
  assert.match(doc.html, /<video src="\/clip\.mp4" preload="metadata" controls><\/video>/);
});

test(":video honors poster, dimensions, preload, and flags", () => {
  const doc = compile(`:video /clip.mp4 poster=/p.jpg width=640 height=360 preload=auto loop`);
  assert.match(doc.html, /poster="\/p\.jpg"/);
  assert.match(doc.html, /width="640" height="360"/);
  assert.match(doc.html, /preload="auto"/);
  assert.match(doc.html, /controls/);
  assert.match(doc.html, /loop/);
});

test(":video autoplay implies muted and drops default controls (background clip)", () => {
  const doc = compile(`:video /bg.mp4 autoplay loop`);
  assert.match(doc.html, /muted/);
  assert.doesNotMatch(doc.html, /controls/);
});

test(":audio defaults to a controlled player", () => {
  const doc = compile(`:audio /song.mp3`);
  assert.match(doc.html, /<audio src="\/song\.mp3" preload="metadata" controls><\/audio>/);
});

test(":video rejects unsafe URLs and unknown flags/attrs", () => {
  assert.throws(() => compile(`:video javascript:alert(1)`), /Unsafe/);
  assert.throws(() => compile(`:video /clip.mp4 spin`), /Unknown :video flag "spin"/);
  assert.throws(() => compile(`:video /clip.mp4 bogus=1`), /Unknown :video attribute "bogus"/);
});

test(":embed rejects unknown attributes", () => {
  // `title` is the only attribute :embed accepts; anything else is a compile
  // error rather than an attribute quietly dropped from the iframe.
  assert.throws(
    () => compile(`:embed https://youtu.be/dQw4w9WgXcQ caption="hi"`),
    /Unknown :embed attribute "caption"/
  );
});

test(":embed rewrites YouTube to the privacy-friendly no-cookie embed, lazily", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ"
  ]) {
    const doc = compile(`:embed ${url}`);
    assert.equal(doc.assets.runtime, false);
    assert.match(doc.html, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(doc.html, /loading="lazy"/);
    assert.match(doc.html, /aspect-ratio:16\/9/);
  }
});

test(":embed rewrites Vimeo to its player and accepts a title", () => {
  const doc = compile(`:embed https://vimeo.com/76979871 title="Demo reel"`);
  assert.match(doc.html, /player\.vimeo\.com\/video\/76979871/);
  assert.match(doc.html, /title="Demo reel"/);
});

test(":embed passes a generic http(s) URL through but rejects bad schemes", () => {
  const doc = compile(`:embed https://example.com/widget`);
  assert.match(doc.html, /src="https:\/\/example\.com\/widget"/);
  assert.throws(() => compile(`:embed data:text/html,<b>x`), /Unsafe/);
});

test("media and embed directives report a malformed (empty) argument", () => {
  assert.throws(() => compile(`:video   `), /Malformed :video/);
  assert.throws(() => compile(`:audio   `), /Malformed :audio/);
  assert.throws(() => compile(`:embed   `), /Malformed :embed/);
});

// ---------------------------------------------------------------------------
// CSP frame-src collection: every :embed records the ORIGIN its emitted iframe
// actually loads (after the YouTube/Vimeo rewrite) on `assets.embedHosts`, so
// the build can union exactly those hosts into the route's CSP frame-src.
// ---------------------------------------------------------------------------

test(":embed records the generic embed's origin for the per-route CSP", () => {
  const doc = compile(`:embed https://app.nexhealth.com/booking/practice?ref=1`);
  assert.deepEqual([...doc.assets.embedHosts], ["https://app.nexhealth.com"]);
});

test(":embed records the rewritten YouTube/Vimeo origins (deduped against the base CSP)", () => {
  const youtube = compile(`:embed https://youtu.be/dQw4w9WgXcQ`);
  assert.deepEqual([...youtube.assets.embedHosts], ["https://www.youtube-nocookie.com"]);
  const vimeo = compile(`:embed https://vimeo.com/76979871`);
  assert.deepEqual([...vimeo.assets.embedHosts], ["https://player.vimeo.com"]);
});

test(":embed records 'self' for a same-origin (relative) embed", () => {
  const doc = compile(`:embed /booking/widget.html`);
  assert.deepEqual([...doc.assets.embedHosts], ["'self'"]);
});

test("repeated embeds of one origin record it once; a page with no embed records nothing", () => {
  const doc = compile(`:embed https://app.nexhealth.com/a\n\n:embed https://app.nexhealth.com/b`);
  assert.deepEqual([...doc.assets.embedHosts], ["https://app.nexhealth.com"]);
  const plain = compile("# Hi\n\nNo embeds here.");
  assert.equal(plain.assets.embedHosts.size, 0);
});

test(":embed with a state-driven or unparseable URL records no host", () => {
  // A `{ state }` URL is unknowable at compile time (widening that policy is the
  // app's deploy-config decision); a bare scheme paints as-is and has no origin.
  const stateDriven = compile(`:embed { widget }`);
  assert.equal(stateDriven.assets.embedHosts.size, 0);
  const bare = compile(`:embed https://`);
  assert.equal(bare.assets.embedHosts.size, 0);
});
