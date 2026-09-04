// The accessibility attribute whitelist shared by `::: ` containers and `:button`.
//
// Darkmown deliberately has no attribute syntax: styling is `.class` tokens and
// behaviour is `->` actions, which is what keeps a page's output predictable and
// its static pages script-free. That left one thing genuinely unreachable — the
// ARIA/role vocabulary a screen reader needs — with no workaround short of raw
// HTML (which needs `html: true` and re-opens the injection surface the compiler
// exists to close).
//
// So exactly three attribute names compile, on exactly two directives:
// `role="…"`, any `aria-…="…"`, and `title="…"`, always a double-quoted STATIC
// value. The names are matched against a closed pattern and the values are
// HTML-escaped on emit, so nothing an author writes can close the attribute or
// open a new one. Everything else — `onclick`, `style`, `href`, `class`,
// `data-…` — is a compile error naming the whitelist. Compile-time only: zero
// runtime bytes, and a static page stays static.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory and return its `<main>` HTML. */
function main(body, files = {}) {
  const page = compileFromMemory(
    { "site/pages/index.wd": `${body}\n`, ...files },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  return page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1].trim();
}

/** Run `fn`, and return the error it threw (asserting that it threw one). */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a compile error, got none");
}

/** The opening tag of the first `<div>`/`<section>`/`<button>` in `html`. */
const openTag = (html) =>
  html.match(/<(?:div|section|nav|main|aside|header|footer|button)[^>]*>/)[0];

// ---------------------------------------------------------------------------
// 1. Containers
// ---------------------------------------------------------------------------

test("::: accepts role, aria-*, and title, in the header after the tag and classes", () => {
  const tag = openTag(main('::: card .note role="region" aria-label="Notes"\nhi\n:::'));
  assert.equal(tag, '<div class="card note" role="region" aria-label="Notes">');
});

test("::: attributes interleave with .class and #id tokens", () => {
  const tag = openTag(main('::: card role="region" .note #n1 title="Shelf"\nhi\n:::'));
  assert.equal(tag, '<div id="n1" class="card note" role="region" title="Shelf">');
});

test("::: attributes coexist with a reactive `.class when` predicate", () => {
  // The `when` operand scan has to stop at an attribute token, or the predicate
  // swallows `role="status"` and fails to compile.
  const html = main(':state open = true\n\n::: card .live when open role="status"\nhi\n:::');
  const tag = openTag(html);
  assert.match(tag, /role="status"/);
  assert.match(tag, /data-wd-class=/);
});

test("::: aria values are HTML-escaped on emit", () => {
  const tag = openTag(main('::: card aria-label="Tom & Jerry <b>"\nhi\n:::'));
  assert.equal(tag, '<div class="card" aria-label="Tom &amp; Jerry &lt;b&gt;">');
});

test("an attribute in FIRST position is an attribute, not a class", () => {
  // The lead-token match (`^([^\\s.#]\\S*)`) ran before the attribute scan, so it
  // swallowed the whole `role="region"` token and emitted it as a class name:
  // `class="role=&quot;region&quot; card"`.
  assert.equal(
    openTag(main('::: role="region" .card\nhi\n:::')),
    '<section class="card" role="region">'
  );
  assert.equal(openTag(main('::: aria-label="x"\nhi\n:::')), '<section aria-label="x">');
  assert.equal(
    openTag(main('::: title="T" .a .b #i\nhi\n:::')),
    '<section id="i" class="a b" title="T">'
  );
});

test("a leading attribute leaves the tag at the same default a leading .class does", () => {
  // `::: .card` has always been a <section>; an attribute in first position is
  // the same "no name token" case and must not diverge.
  assert.match(openTag(main("::: .card\nhi\n:::")), /^<section /);
  assert.match(openTag(main('::: role="region"\nhi\n:::')), /^<section /);
});

test("a NAME still wins when it comes first", () => {
  // The other order must be untouched: the semantic tag still applies.
  assert.equal(
    openTag(main('::: nav role="navigation"\nhi\n:::')),
    '<nav class="nav" role="navigation">'
  );
  assert.equal(
    openTag(main('::: card role="region"\nhi\n:::')),
    '<div class="card" role="region">'
  );
});

test("a rejected attribute in first position still reports the whitelist", () => {
  // The skip must not turn a bad attribute into a silent class either.
  assert.equal(thrown(() => main('::: onclick="x()" .card\nhi\n:::')).wd.code, "WD650");
  assert.equal(thrown(() => main("::: role=region .card\nhi\n:::")).wd.code, "WD651");
});

test("a semantic container keeps its tag and takes attributes", () => {
  const tag = openTag(main('::: nav .menu role="navigation" aria-label="Main"\nhi\n:::'));
  assert.equal(tag, '<nav class="nav menu" role="navigation" aria-label="Main">');
});

// ---------------------------------------------------------------------------
// 2. Buttons
// ---------------------------------------------------------------------------

test(":button takes the attributes between the label and the `->`", () => {
  const tag = openTag(
    main(':state open = false\n\n:button "Menu" role="menuitem" aria-controls="m" -> open toggle')
  );
  assert.equal(
    tag,
    '<button type="button" role="menuitem" aria-controls="m" data-wd-action="toggle" data-wd-target="open">'
  );
});

test(":button attributes survive a CHAINED action list", () => {
  const tag = openTag(
    main(':state open = false\n:state n = 0\n\n:button "Go" title="Tip" -> open = true; n++')
  );
  assert.match(tag, /^<button type="button" title="Tip" data-wd-actions=/);
});

test(":button values are HTML-escaped on emit", () => {
  const tag = openTag(main(':state n = 0\n\n:button "Go" aria-label="a & b <c>" -> n++'));
  assert.equal(
    tag,
    '<button type="button" aria-label="a &amp; b &lt;c&gt;" data-wd-action="inc" data-wd-target="n">'
  );
});

test("an attribute value may contain the arrow without splitting the line", () => {
  // Attributes are peeled BEFORE `->` is looked for, so the arrow inside a
  // quoted value cannot be mistaken for the action arrow.
  const html = main(':state n = 0\n\n:button "Go" aria-label="in -> out" -> n++');
  assert.match(openTag(html), /aria-label="in -&gt; out"/);
  assert.match(html, /data-wd-action="inc"/);
});

test("a :button with no attributes is byte-identical to before", () => {
  const tag = openTag(main(':state n = 0\n\n:button "Go" -> n++'));
  assert.equal(tag, '<button type="button" data-wd-action="inc" data-wd-target="n">');
});

// ---------------------------------------------------------------------------
// 3. Everything outside the whitelist is a compile error
// ---------------------------------------------------------------------------

const REJECTED = [
  ['onclick="alert(1)"', "an inline event handler"],
  ['style="color:red"', "inline styling"],
  ['href="/x"', "a link target"],
  ['class="danger"', "a class attribute (use `.class`)"],
  ['id="x"', "an id attribute (use `#id`)"],
  ['data-wd-action="set"', "a framework data attribute"],
  ['data-x="1"', "any data attribute"],
  ['ARIA-LABEL="x"', "a mis-cased aria name"],
  ['aria="x"', "`aria` with no suffix"],
  ['roles="x"', "a near-miss on role"]
];

for (const [attr, what] of REJECTED) {
  test(`::: rejects ${what}`, () => {
    const error = thrown(() => main(`::: card ${attr}\nhi\n:::`));
    assert.equal(error.wd.code, "WD650");
    assert.match(error.message, /is not allowed in container/);
    assert.match(error.message, /role="…", aria-…="…", or title="…"/);
    assert.match(error.message, /index\.wd:1/);
  });

  test(`:button rejects ${what}`, () => {
    const error = thrown(() => main(`:state n = 0\n\n:button "Go" ${attr} -> n++`));
    assert.equal(error.wd.code, "WD650");
    assert.match(error.message, /is not allowed in :button/);
    assert.match(error.message, /role="…", aria-…="…", or title="…"/);
    assert.match(error.message, /index\.wd:3/);
  });
}

test("an UNQUOTED value is its own error, not a whitelist error", () => {
  // `role=region` is the right attribute written the wrong way; saying "role is
  // not allowed" would send the author down a blind alley.
  for (const [body, where] of [
    ["::: card role=region\nhi\n:::", "container"],
    [':state n = 0\n\n:button "Go" role=region -> n++', ":button"]
  ]) {
    const error = thrown(() => main(body));
    assert.equal(error.wd.code, "WD651");
    assert.match(error.message, /needs a double-quoted value/);
    assert.ok(error.message.includes(where), `${where} missing from: ${error.message}`);
  }
});

test("a single-quoted value is rejected too", () => {
  assert.equal(thrown(() => main("::: card role='region'\nhi\n:::")).wd.code, "WD651");
});

test("a non-whitelisted attribute reports the WHITELIST even when unquoted", () => {
  // The name is judged before the quoting: telling the author to quote
  // `onclick=x` would send them to an attribute that is rejected anyway.
  const error = thrown(() => main("::: card onclick=x\nhi\n:::"));
  assert.equal(error.wd.code, "WD650");
  assert.match(error.message, /"onclick" is not allowed/);
});

// ---------------------------------------------------------------------------
// 4. The feature costs nothing at runtime
// ---------------------------------------------------------------------------

test("attributes do not make a static page reactive", () => {
  const page = compileFromMemory(
    { "site/pages/index.wd": '::: card .note role="region" aria-label="Notes"\nhi\n:::\n' },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  assert.equal(page.assets.runtime, false, "an a11y attribute pulled in the runtime");
  assert.ok(!page.html.includes("data-wd-"), "an a11y attribute emitted a runtime marker");
});

test("no value is interpolated from state — the attribute is static text", () => {
  // Stated limitation, pinned so it cannot change silently: `{ … }` inside an
  // attribute value is emitted VERBATIM, it is not a binding.
  const tag = openTag(main(':state who = "Ash"\n\n::: card aria-label="{ who }"\nhi\n:::'));
  assert.equal(tag, '<div class="card" aria-label="{ who }">');
});
