import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// The em-dash + `e.g.` marker every placeholder-bearing corrective hint ends with.
const EG = / — e\.g\. (.+)$/;

function project(source, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-eg-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), source);
  return root;
}

function compile(source, files) {
  const root = project(source, files);
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Capture the Error thrown by compiling `source` (asserts it throws). */
function thrownBy(source, files) {
  let err;
  try {
    compile(source, files);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `expected "${source}" to throw`);
  return err;
}

const PRODUCTS = {
  "site/_/products.json": JSON.stringify([
    { name: "A", price: 10 },
    { name: "B", price: 90 }
  ])
};
const XJSON = { "site/_/x.json": JSON.stringify([{ name: "A", price: 10 }]) };
const HEADER = { "site/_/header.wd": "# Header\n" };

// One row per placeholder-bearing corrective hint. `trigger` fires the error;
// `example` is the exact `e.g.` snippet we expect in the message; `build` turns
// that (runtime-extracted) snippet into a self-contained compilable page.
const HINTS = [
  {
    name: "@loop",
    trigger: "@loop bad\n@endloop",
    example: "@loop /products.json into p where p.price < 50 sort by p.price asc",
    files: PRODUCTS,
    build: (ex) => `${ex}\n- { p.name }\n@endloop\n`
  },
  {
    name: "@loop where",
    trigger: "@loop /x.json into p where p.price\n@endloop",
    example: "p.price < 50",
    files: XJSON,
    build: (ex) => `@loop /x.json into p where ${ex}\n- { p.name }\n@endloop\n`
  },
  {
    name: ":fetch",
    trigger: ":fetch bad",
    example: ':fetch todos from "/api/todos.json" when=visible',
    build: (ex) => `${ex}\n`
  },
  {
    name: ":effect",
    trigger: ":effect bad",
    example: ":effect query -> searches++",
    build: (ex) => `:state query = ""\n:state searches = 0\n${ex}\n`
  },
  {
    name: ":every",
    trigger: ":every bad",
    example: ":every 5s -> seconds++",
    build: (ex) => `:state seconds = 0\n${ex}\n`
  },
  {
    name: ":button malformed",
    trigger: ":button nope",
    example: ':button "Add one" -> count++',
    build: (ex) => `:state count = 0\n${ex}\n`
  },
  {
    name: "action vocabulary",
    trigger: ':state x = 0\n:button "Go" -> x.push(1)',
    example: "count++",
    build: (ex) => `:state count = 0\n:button "Do" -> ${ex}\n`
  },
  {
    name: "merge operand",
    trigger: ':state settings = {"a": 1}\n:button "M" -> settings merge 5',
    example: "settings merge patch",
    build: (ex) => `:state settings = {"a": 1}\n:state patch = {"b": 2}\n:button "Apply" -> ${ex}\n`
  },
  { name: ":state", trigger: ":state x", example: ":state count = 0", build: (ex) => `${ex}\n` },
  { name: ":store", trigger: ":store x", example: ":store cart = []", build: (ex) => `${ex}\n` },
  { name: ":theme", trigger: ":theme 9bad", example: ":theme", build: (ex) => `${ex}\n` },
  {
    name: "@include",
    trigger: "@include a b",
    example: "@include /header.wd",
    files: HEADER,
    build: (ex) => `${ex}\n`
  },
  {
    name: ":if",
    trigger: ":if \nx\n:endif",
    example: ":if count > 0",
    build: (ex) => `:state count = 0\n${ex}\nyes\n:endif\n`
  },
  {
    name: ":carousel",
    trigger: ":carousel bad\n:endcarousel",
    example: ":carousel autoplay=3000",
    build: (ex) => `${ex}\n::: slide\nhi\n:::\n:endcarousel\n`
  },
  {
    name: ":video",
    trigger: ":video ",
    example: ":video /demo.mp4 controls",
    build: (ex) => `${ex}\n`
  },
  {
    name: ":audio",
    trigger: ":audio ",
    example: ":audio /theme.mp3 controls",
    build: (ex) => `${ex}\n`
  },
  {
    name: ":embed",
    trigger: ":embed ",
    example: ':embed https://youtu.be/dQw4w9WgXcQ title="Demo"',
    build: (ex) => `${ex}\n`
  },
  {
    name: ":form",
    trigger: ":form bad\n:endform",
    example: ":form into contact",
    build: (ex) => `${ex}\n:input name\n:endform\n`
  },
  {
    name: ":input",
    trigger: ":input ",
    example: ":input email type=email required",
    build: (ex) => `${ex}\n`
  },
  {
    name: ":textarea",
    trigger: ":textarea ",
    example: ':textarea message placeholder="Your message" rows=4',
    build: (ex) => `${ex}\n`
  },
  // The three field directives are form fields inside a `:form` and controls
  // bound to `:state` outside one, so each example is built inside the form it
  // describes — the same host construct the VS Code snippets use.
  {
    name: ":select",
    trigger: ":select ",
    example: ":select topic",
    build: (ex) => `:form into c action="/api/echo"\n${ex}\n- One\n- Two\n:endform\n`
  },
  {
    name: ":checkbox",
    trigger: ":checkbox ",
    example: ":checkbox toppings",
    build: (ex) => `:form into c action="/api/echo"\n${ex}\n- A\n- B\n:endform\n`
  },
  {
    name: ":radio",
    trigger: ":radio ",
    example: ":radio size",
    build: (ex) => `:form into c action="/api/echo"\n${ex}\n- S\n- M\n:endform\n`
  },
  { name: ":submit", trigger: ":submit bad", example: ':submit "Send"', build: (ex) => `${ex}\n` }
];

// ---------------------------------------------------------------------------
// Deliverable 1: every corrective hint ends with a concrete `e.g.` example, and
// that example — extracted from the REAL runtime error string — compiles.
// ---------------------------------------------------------------------------

test("every placeholder hint ends with an e.g. example that compiles", () => {
  for (const h of HINTS) {
    const err = thrownBy(h.trigger, h.files);
    const m = err.message.match(EG);
    assert.ok(m, `${h.name}: message has no "— e.g." example:\n${err.message}`);
    const example = m[1];
    assert.equal(example, h.example, `${h.name}: unexpected e.g. example`);
    assert.doesNotThrow(
      () => compile(h.build(example), h.files),
      `${h.name}: the hint's e.g. example did not compile:\n${example}`
    );
  }
});

// ---------------------------------------------------------------------------
// Deliverable 4: structured `err.wd = { file, line, hint, example }`.
// ---------------------------------------------------------------------------

test("compile errors carry a structured .wd mirror (file/line/hint/example)", () => {
  const root = project(":state x");
  const file = path.join(root, "site/pages/index.wd");
  let err;
  try {
    compilePage(file, createPaths(root));
  } catch (e) {
    err = e;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.ok(err.wd, "error is missing .wd");
  assert.equal(err.wd.file, file);
  assert.equal(err.wd.line, 1);
  assert.equal(err.wd.example, ":state count = 0");
  assert.ok(err.wd.hint.startsWith(":state name = value"));
  // The string message stays the contract; .wd only mirrors it.
  assert.match(err.message, /Malformed :state/);
  assert.ok(err.message.includes(err.wd.example));
});

test(".wd line is the true file line after a frontmatter block", () => {
  // Frontmatter occupies file lines 1-3; the bad :fetch on body line 2 is line 5.
  const err = thrownBy(["---", "title: T", "---", "", ":fetch bad"].join("\n"));
  assert.equal(err.wd.line, 5);
  assert.equal(err.wd.example, ':fetch todos from "/api/todos.json" when=visible');
});

test("a file-scoped error (bad where operand) omits .wd.line but keeps file + example", () => {
  const err = thrownBy("@loop /x.json into p where p.price\n@endloop", XJSON);
  assert.equal(err.wd.line, undefined);
  assert.match(err.wd.file, /index\.wd$/);
  assert.equal(err.wd.example, "p.price < 50");
});

test("the loop, include, form, and effect errors all expose .wd.example", () => {
  const cases = [
    {
      src: "@loop bad\n@endloop",
      ex: "@loop /products.json into p where p.price < 50 sort by p.price asc",
      files: PRODUCTS
    },
    { src: "@include a b", ex: "@include /header.wd", files: HEADER },
    { src: ":form bad\n:endform", ex: ":form into contact" },
    { src: ":effect bad", ex: ":effect query -> searches++" }
  ];
  for (const c of cases) {
    const err = thrownBy(c.src, c.files);
    assert.equal(err.wd.example, c.ex, `wrong .wd.example for ${c.src}`);
    assert.equal(err.wd.line, 1);
  }
});
