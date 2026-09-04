import assert from "node:assert/strict";
import test from "node:test";
import { llmsFullText, llmsText } from "../src/catalog.js";
import { compileFromMemory } from "../src/compiler.js";
import { compileSkin } from "../src/skin.js";

// ---------------------------------------------------------------------------
// `darkmown catalog --llms` is a runtime asset, not documentation: it is the
// artifact an app stuffs into a small model's system prompt, and a measured
// 22-point swing for a 1.5B model. So the sections added for the audit are
// tested the way the directive examples already are — by COMPILING what they
// tell an author to write, not by asserting the words are present.
//
// The audit found the sheet silently missing: `@empty`, block closers,
// `:else`/`:else if`, `{.class #id}` inline attributes, collections +
// `_schema.wd`, and the entire `.skin` language.
// ---------------------------------------------------------------------------

const sheet = llmsText();
const corpus = llmsFullText();

/** Compile a `.wd` page from an in-memory file map and return its body HTML. */
function body(source, files = {}) {
  const { html } = compileFromMemory(
    { ...files, "site/pages/index.wd": source },
    "site/pages/index.wd"
  );
  return (html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
}

// --- index and corpus agree -----------------------------------------------

test("every added section appears in BOTH llms.txt and llms-full.txt", () => {
  for (const section of [
    "## Block structure",
    "## Inline attributes",
    "## Collections",
    "## Styling: the `.skin` language"
  ]) {
    assert.ok(sheet.includes(section), `llms.txt is missing ${section}`);
    assert.ok(corpus.includes(section), `llms-full.txt is missing ${section}`);
  }
});

// --- block structure -------------------------------------------------------

test("the block-structure section names @empty, :else and :else if, and they work", () => {
  for (const token of ["@endloop", "@empty", ":endif", ":else if", ":endform", ":endcarousel"]) {
    assert.ok(sheet.includes(token), `cheatsheet omits the block token ${token}`);
  }

  // @empty renders when the list is empty, and does NOT when it is not.
  const empty = body("@loop /rows.json into p\n- { p.name }\n@empty\nNothing yet.\n@endloop\n", {
    "site/_/rows.json": "[]"
  });
  assert.match(empty, /Nothing yet\./);
  const filled = body("@loop /rows.json into p\n- { p.name }\n@empty\nNothing yet.\n@endloop\n", {
    "site/_/rows.json": JSON.stringify([{ name: "A" }])
  });
  assert.doesNotMatch(filled, /Nothing yet\./);
  assert.match(filled, /A/);

  // :else if picks the middle branch.
  const branched = body(
    ":state n = 2\n\n:if n == 1\none\n:else if n == 2\ntwo\n:else\nother\n:endif\n"
  );
  assert.match(branched, /two/, ":else if did not compile into a branch");
});

// --- inline attributes -----------------------------------------------------

test("the inline-attribute section is exactly right, including the inline-code caveat", () => {
  assert.match(body("[Get started](/start/){.btn}\n"), /<a href="\/start\/" class="btn">/);
  assert.match(body("![logo](/l.png){.brand}\n"), /<img [^>]*class="brand"/);
  assert.match(body("*text*{.hl}\n"), /<em class="hl">text<\/em>/);
  assert.match(body("[Go](/u/){.btn .lg #cta}\n"), /class="btn lg" id="cta"/);

  // The two caveats the sheet states. Both are real, and both are the kind of
  // thing an author otherwise discovers by shipping a broken page.
  assert.ok(sheet.includes("A space before the block breaks it"));
  assert.doesNotMatch(body("[Go](/u/) {.btn}\n"), /class="btn"/);
  assert.ok(sheet.includes("does NOT work on inline `code`"));
  assert.match(body("`code`{.hl}\n"), /<code>code<\/code>\{\.hl\}/);
});

// --- collections -----------------------------------------------------------

test("the collections section's loop-by-bare-name example compiles", () => {
  // `@loop posts into post sort by post.date desc` — exactly the sheet's line.
  const files = {
    "site/pages/posts/first.md": "---\ntitle: First\ndate: 2026-01-01\n---\n\nHello.\n",
    "site/pages/posts/second.md": "---\ntitle: Second\ndate: 2026-02-01\n---\n\nWorld.\n"
  };
  const collections = new Map([
    [
      "posts",
      [
        {
          title: "First",
          date: "2026-01-01",
          url: "/posts/first/",
          slug: "first",
          excerpt: "Hello."
        },
        {
          title: "Second",
          date: "2026-02-01",
          url: "/posts/second/",
          slug: "second",
          excerpt: "World."
        }
      ]
    ]
  ]);
  const { html } = compileFromMemory(
    {
      ...files,
      "site/pages/index.wd":
        "@loop posts into post sort by post.date desc\n- [{ post.title }]({ post.url })\n@endloop\n"
    },
    "site/pages/index.wd",
    { collections }
  );
  const main = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
  assert.match(main, /Second/);
  assert.match(main, /\/posts\/second\//, "the derived `url` field is not what the sheet claims");
  assert.ok(
    main.indexOf("Second") < main.indexOf("First"),
    "`sort by post.date desc` did not order the collection"
  );
  // The sheet claims each row carries frontmatter plus derived url/slug/excerpt.
  for (const field of ["`url`", "`slug`", "`excerpt`"]) {
    assert.ok(sheet.includes(field), `collections section omits the derived ${field}`);
  }
});

test("the _schema.wd types the sheet lists are the ones the compiler accepts", async () => {
  const { parseSchema } = await import("../src/compiler/collections.js");
  // Every type named in the sheet must parse; the `?` modifier must too.
  const fields = parseSchema(
    "title: string\nviews: number\nfeatured: boolean?\ndate: date\ntags: string[]\n",
    "/site/pages/posts/_schema.wd"
  );
  assert.deepEqual(
    fields.map((f) => `${f.name}:${f.type}${f.optional ? "?" : ""}`),
    ["title:string", "views:number", "featured:boolean?", "date:date", "tags:string[]"]
  );
  for (const type of ["`string`", "`number`", "`boolean`", "`date`", "`string[]`"]) {
    assert.ok(sheet.includes(type), `_schema.wd type ${type} missing from the sheet`);
  }
  // Negative control: a type the sheet does NOT list must be rejected, or the
  // sheet's "closed vocabulary" claim would be empty.
  assert.throws(
    () => parseSchema("x: json\n", "/site/pages/posts/_schema.wd"),
    /Unknown schema type/
  );
});

// --- the .skin language ----------------------------------------------------

test("every .skin construct the sheet teaches really compiles", () => {
  const css = compileSkin(
    [
      "tokens",
      "  accent #16645a",
      "  radius 8px",
      "tokens dark",
      "  accent #7fd1c1",
      ".card",
      "  bg white",
      "  radius $radius",
      "  color $accent",
      "  &:hover",
      "    color $accent",
      "  h2",
      "    font ui-sans-serif, system-ui",
      "page",
      "  margin 0",
      "@media (min-width: 40rem)",
      "  .card",
      "    padding 2rem"
    ].join("\n")
  );

  // The shorthands the sheet names, resolved.
  assert.match(css, /--accent: #16645a;/, "`tokens` did not emit a CSS variable");
  assert.match(css, /prefers-color-scheme: dark/, "`tokens dark` did not emit a dark block");
  assert.match(css, /\.card \{ background: white; \}/, "`bg` alias");
  assert.match(
    css,
    /\.card \{ border-radius: var\(--radius\); \}/,
    "`radius` alias + `$token` read"
  );
  assert.match(css, /\.card:hover \{ color: var\(--accent\); \}/, "`&:hover` nesting");
  assert.match(css, /\.card h2 \{ font-family: /, "descendant nesting + `font` alias");
  assert.match(css, /body \{ margin: 0; \}/, "`page` targets <body>");
  assert.match(css, /@media \(min-width: 40rem\) \{ \.card \{ padding: 2rem; \} \}/, "@media wrap");

  // …and the `scoped` opt-in the sheet describes.
  const scoped = compileSkin("scoped\n.card\n  bg white\n", { scope: "wd-1234" });
  assert.match(scoped, /\.card\[data-wd-scope="wd-1234"\]/);
  const global = compileSkin("scoped\n:global(.toast)\n  bg white\n", { scope: "wd-1234" });
  assert.match(global, /^\.toast \{/m, ":global(.x) did not opt out of scoping");
  // Tokens stay global even in a scoped skin — the sheet says so.
  assert.match(compileSkin("scoped\ntokens\n  a #fff\n", { scope: "wd-1234" }), /:root \{/);

  for (const claim of ["`bg`→background", "`radius`→border-radius", "`page` targets `<body>`"]) {
    assert.ok(sheet.includes(claim), `skin section omits: ${claim}`);
  }
});
