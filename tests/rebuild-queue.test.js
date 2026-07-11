// Serialized dev rebuild queue (src/dev.js createRebuildQueue) — at most one
// child build runs at a time. Every dev build read-modify-writes the dependency
// map (dist/.wd-dev-deps.json), so overlapping children could persist a stale
// map missing deps a concurrent build just recorded — after which the affected
// routes silently stop rebuilding. These tests pin the queue's contract:
// debounced batching, duplicate coalescing, the null full-rebuild swallow,
// strict serialization, and never wedging on a rejected build.

import assert from "node:assert/strict";
import test from "node:test";
import { createRebuildQueue } from "../src/dev.js";

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("changes within the debounce window coalesce into one deduplicated batch", async () => {
  const batches = [];
  const queue = createRebuildQueue((changed) => {
    batches.push(changed);
  }, 1);
  queue.change("site/pages/a.wd");
  queue.change("site/pages/b.wd");
  queue.change("site/pages/a.wd");
  await tick();
  assert.deepEqual(batches, [["site/pages/a.wd", "site/pages/b.wd"]]);
  queue.close();
});

test("a null (full-rebuild) change swallows the whole batch into one full build", async () => {
  const batches = [];
  const queue = createRebuildQueue((changed) => {
    batches.push(changed);
  }, 1);
  queue.change("site/pages/a.wd");
  queue.change(null);
  queue.change("site/pages/b.wd");
  await tick();
  assert.deepEqual(batches, [[]], "null forces a single full rebuild (empty changed list)");
  queue.close();
});

test("builds are serialized: a change mid-build waits for the running build (dep-map race)", async () => {
  // The regression scenario: edit a.wd (its build records a new @include dep in
  // the map); edit plain.md while that build is still running. Overlapping
  // children would let the second build read the pre-first-build map and
  // persist it — clobbering the new dep, so nav.wd edits never rebuild /a/.
  // The queue must hold the second build until the first has fully finished.
  const events = [];
  /** @type {(() => void) | null} */
  let releaseFirst = null;
  const queue = createRebuildQueue((changed) => {
    events.push(["start", changed]);
    const gate = deferred();
    if (releaseFirst) gate.resolve();
    else releaseFirst = gate.resolve;
    return gate.promise.then(() => {
      events.push(["end", changed]);
    });
  }, 1);

  queue.change("site/pages/a.wd");
  await tick(); // the first build starts and hangs on its gate
  queue.change("site/pages/plain.md"); // arrives mid-build
  await tick(); // its debounce fires while the first build is still running
  assert.deepEqual(
    events,
    [["start", ["site/pages/a.wd"]]],
    "the second build must not start while the first is running"
  );

  releaseFirst?.();
  await tick();
  assert.deepEqual(events, [
    ["start", ["site/pages/a.wd"]],
    ["end", ["site/pages/a.wd"]],
    ["start", ["site/pages/plain.md"]],
    ["end", ["site/pages/plain.md"]]
  ]);
  queue.close();
});

test("changes accumulating during a build coalesce into ONE next batch", async () => {
  const batches = [];
  const gate = deferred();
  let first = true;
  const queue = createRebuildQueue((changed) => {
    batches.push(changed);
    if (first) {
      first = false;
      return gate.promise;
    }
  }, 1);

  queue.change("site/pages/a.wd");
  await tick(); // first build starts and hangs
  queue.change("site/pages/b.wd");
  await tick();
  queue.change("site/pages/c.wd");
  queue.change("site/pages/b.wd");
  await tick();
  gate.resolve();
  await tick();
  assert.deepEqual(batches, [["site/pages/a.wd"], ["site/pages/b.wd", "site/pages/c.wd"]]);
  queue.close();
});

test("a rejected build frees the queue for the next change", async () => {
  const batches = [];
  let first = true;
  const queue = createRebuildQueue((changed) => {
    if (first) {
      first = false;
      return Promise.reject(new Error("child spawn failed"));
    }
    batches.push(changed);
  }, 1);
  queue.change("site/pages/a.wd");
  await tick();
  queue.change("site/pages/b.wd");
  await tick();
  assert.deepEqual(batches, [["site/pages/b.wd"]], "the queue is not wedged after a rejection");
  queue.close();
});

test("close() cancels a pending debounced flush", async () => {
  const batches = [];
  const queue = createRebuildQueue((changed) => {
    batches.push(changed);
  }, 1);
  queue.change("site/pages/a.wd");
  queue.close();
  await tick();
  assert.deepEqual(batches, [], "no build runs after close()");
});
