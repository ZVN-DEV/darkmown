// Browser entry for the darkmown.com playground. Bundled by
// `scripts/build-playground.mjs` (esbuild) into the colocated page script
// `site/pages/playground/index.js`, which the site ships verbatim. It wires the
// editor textarea to a live iframe preview, compiling `.wd`/`.md` source IN THE
// BROWSER via the framework's own fs-free `compileFromMemory`.
//
// Example switching is dogfooded through the framework runtime: the on-page
// `:button`s set a `:state activeExample`, and this script bridges to that state
// with `window.wd.subscribe` — the documented escape hatch for colocated `.js`.

import { compileFromMemory } from "../../src/compiler/page.js";

/**
 * @typedef {object} Example
 * @property {string} label Human label (matches the picker button text).
 * @property {"wd" | "md"} ext Source extension — decides the compile mode.
 * @property {string} source Starter source loaded into the editor.
 */

/** @type {Record<string, Example>} */
const EXAMPLES = {
  store: {
    label: "Store + cart",
    ext: "wd",
    source: `---
title: Sticker shop
html: true
---
<main>

# Sticker shop

A durable cart, written as Markdown. \`:store\` persists to localStorage and
survives a reload — no backend, no wiring.

:store cart = []

Cart: **{ cart.length }** item(s)

:button "Add sticker" -> cart append {"name": "Sticker", "price": 4}
:button "Add mug" -> cart append {"name": "Mug", "price": 12}
:button "Reset" -> cart reset

@loop cart into line
- { line.name } — \${ line.price }
@empty
Your cart is empty — add something above.
@endloop

</main>
`
  },
  counter: {
    label: "Counter",
    ext: "wd",
    source: `---
title: Counter
html: true
---
<main>

# Counter

The smallest reactive island: one \`:state\`, three \`:button\`s.

:state count = 0

## Count: { count }

:button "− 1" -> count--
:button "+ 1" -> count++
:button "Reset" -> count = 0

</main>
`
  },
  markdown: {
    label: "Plain Markdown",
    ext: "md",
    source: `# Just Markdown

This is a plain \`.md\` file. It ships **zero** JavaScript — no runtime, no
framework, nothing to hydrate.

- Strict CommonMark
- No directives in here
- Rename it to \`.wd\` to make it run

> Static pages stay static. That is the whole point.
`
  }
};

// Injected into every preview document's <head> so the compiled output reads
// legibly inside the iframe. Kept self-contained (no external URLs) so it works
// under the same strict CSP the rest of the site ships.
const PREVIEW_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 1.5rem;
  background: #12190f; color: #eef2e6;
  font: 16px/1.6 system-ui, -apple-system, Segoe UI, sans-serif;
}
main { max-width: 42rem; margin: 0 auto; }
h1, h2, h3 { line-height: 1.2; color: #f7f9f0; }
a { color: #8fd694; }
code { background: #223018; padding: .12em .35em; border-radius: 4px; font-size: .9em; }
button {
  font: inherit; margin: .2rem .3rem .2rem 0; padding: .45rem .9rem;
  background: #2b3a20; color: #eef2e6; border: 1px solid #3d5130;
  border-radius: 7px; cursor: pointer;
}
button:hover { background: #35492680; border-color: #5a7444; }
ul { padding-left: 1.2rem; }
li { margin: .2rem 0; }
blockquote {
  margin: 1rem 0; padding: .2rem 0 .2rem 1rem;
  border-left: 3px solid #3d5130; color: #c4d0b6;
}
strong { color: #f7f9f0; }
`;

/**
 * @param {string} ext
 * @returns {string} The virtual project-relative entry path for this source.
 */
function entryKey(ext) {
  return `site/pages/preview.${ext}`;
}

/**
 * Compile the given source in-browser and paint the preview iframe, or render
 * the compiler's real `file:line` error text into the error pane.
 * @param {string} source
 * @param {"wd" | "md"} ext
 */
function renderPreview(source, ext) {
  const iframe = /** @type {HTMLIFrameElement | null} */ (document.getElementById("pg-preview"));
  const errorBox = document.getElementById("pg-error");
  if (!iframe || !errorBox) return;
  const key = entryKey(ext);
  try {
    const { html } = compileFromMemory({ [key]: source }, key, { cwd: "/" });
    // Inject the preview stylesheet just before </head>; assets (runtime.js,
    // highlight.css) referenced by the compiled shell resolve same-origin.
    iframe.srcdoc = html.replace("</head>", `<style>${PREVIEW_CSS}</style></head>`);
    errorBox.hidden = true;
    errorBox.textContent = "";
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = err instanceof Error ? err.message : String(err);
  }
}

let debounce = 0;
/**
 * Debounced recompile from the editor's current contents (~200ms).
 * @param {string} ext
 */
function scheduleRender(ext) {
  clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    const editor = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("pg-editor"));
    if (editor) renderPreview(editor.value, ext);
  }, 200);
}

let currentExt = /** @type {"wd" | "md"} */ ("wd");

/**
 * Load a seeded example into the editor and paint it immediately.
 * @param {string} name
 */
function loadExample(name) {
  const example = EXAMPLES[name] || EXAMPLES.store;
  currentExt = example.ext;
  const editor = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("pg-editor"));
  if (!editor) return;
  editor.value = example.source;
  renderPreview(example.source, example.ext);
}

function init() {
  const editor = document.getElementById("pg-editor");
  if (!editor) return;
  editor.addEventListener("input", () => scheduleRender(currentExt));

  const wd = /** @type {any} */ (window).wd;
  if (wd && typeof wd.subscribe === "function") {
    // The framework's example picker (`:button -> activeExample = …`) drives this;
    // subscribe primes immediately with the declared default, loading example one.
    wd.subscribe("activeExample", (/** @type {string} */ name) => loadExample(name));
  } else {
    // Runtime absent (should not happen on the reactive playground route) — still
    // give the visitor a working editor seeded with the default example.
    loadExample("store");
  }
}

init();
