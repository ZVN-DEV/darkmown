// Unit coverage for src/dev.js — pure string builders, no server needed.

import assert from "node:assert/strict";
import test from "node:test";
import {
  devClientPath,
  devClientScript,
  devEventsPath,
  draftBannerScript,
  injectDevClient
} from "../src/dev.js";

test("devClientScript wires the EventSource live-reload + error overlay", () => {
  const script = devClientScript();
  // Opens the SSE channel at the events path.
  assert.match(script, /new EventSource\("\/__wd\/dev-events"\)/);
  assert.equal(devEventsPath, "/__wd/dev-events");
  // Reloads the page on a `reload` event.
  assert.match(script, /addEventListener\("reload", \(\) => location\.reload\(\)\)/);
  // Builds the error overlay on a `builderror` event.
  assert.match(script, /addEventListener\("builderror"/);
  assert.match(script, /__wd-error-overlay/);
  assert.match(script, /Darkmown build failed/);
  // Swallows transport errors so a disconnect does not spam the console.
  assert.match(script, /addEventListener\("error", \(\) => \{\}\)/);
});

test("injectDevClient inserts the module script before </body>", () => {
  const html = "<html><body><h1>Hi</h1></body></html>";
  const out = injectDevClient(html);
  assert.match(out, /<script type="module" src="\/__wd\/dev-client\.js"><\/script>\n<\/body>/);
  assert.equal(devClientPath, "/__wd/dev-client.js");
});

test("injectDevClient appends the script when there is no </body>", () => {
  const out = injectDevClient("<h1>No body tag</h1>");
  assert.match(
    out,
    /<h1>No body tag<\/h1>\n<script type="module" src="\/__wd\/dev-client\.js"><\/script>/
  );
});

test("injectDevClient adds the draft banner only when draft: true", () => {
  const html = "<html><body><h1>Hi</h1></body></html>";
  // No banner for a normal page.
  assert.doesNotMatch(injectDevClient(html), /__wd-draft-banner/);
  // Banner injected (before </body>) for a draft page.
  const draft = injectDevClient(html, { draft: true });
  assert.match(draft, /__wd-draft-banner/);
  assert.match(
    draft,
    /<script type="module" src="\/__wd\/dev-client\.js"><\/script>\n<script>[\s\S]*<\/script>\n<\/body>/
  );
});

test("draftBannerScript builds an inert, marked DRAFT banner element", () => {
  const script = draftBannerScript();
  assert.match(script, /__wd-draft-banner/);
  assert.match(script, /DRAFT — excluded from production build/);
  // inert so it never blocks page interaction
  assert.match(script, /pointer-events:none/);
  // prepended on DOMContentLoaded
  assert.match(script, /DOMContentLoaded/);
  assert.match(script, /body\.prepend/);
});
