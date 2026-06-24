import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { imageSize } from "image-size";

/**
 * @typedef {import("./config.js").Paths} Paths
 */

/**
 * Frontmatter values are scalars or inline arrays of scalars.
 * @typedef {string | number | boolean | null | Array<string | number | boolean | null>} FrontmatterValue
 */

/**
 * Parsed page frontmatter, keyed by field name.
 * @typedef {Record<string, FrontmatterValue>} Meta
 */

/**
 * Collected output assets for a compiled document.
 * @typedef {object} Assets
 * @property {Set<string>} skins Public hrefs of compiled skin stylesheets.
 * @property {Set<string>} scripts Public hrefs of colocated page scripts.
 * @property {Map<string, string>} files Source path → public href for emitted assets.
 * @property {boolean} runtime Whether the reactive runtime is required.
 */

/**
 * Per-document compilation accumulator shared across includes/sections.
 * @typedef {object} Compilation
 * @property {Assets} assets
 * @property {Map<string, unknown>} state Declared state keys → initial values.
 * @property {Set<string>} stores Page-global store names (a subset of state keys).
 * @property {string[]} warnings Non-fatal authoring hints.
 * @property {number} sectionCounter Counter for auto-generated section ids.
 */

/**
 * A lexical scope chain for static interpolation values (include args, loop vars).
 * @typedef {object} Scope
 * @property {Scope | null} parent
 * @property {Record<string, unknown>} vars
 */

/**
 * Per-file compile context threaded through the directive handlers.
 * @typedef {object} Ctx
 * @property {string} file Absolute path to the file being compiled.
 * @property {Paths} context Resolved project paths.
 * @property {string[]} stack Include stack (real paths) for cycle detection.
 * @property {Scope} scope Static value scope chain.
 * @property {Compilation} comp Shared compilation accumulator.
 * @property {string[]} sections Active section-id scope chain.
 * @property {string | null} loopItem Name of the current reactive loop item, if any.
 * @property {string} [loopKey] State key of the list being looped, if any.
 * @property {boolean} [loopMeta] Inside a loop body, so `$index`/`$first`/… are valid.
 * @property {MarkdownIt} [md] Markdown-it instance selected for this file.
 */

/**
 * A compiled page document.
 * @typedef {object} CompiledDocument
 * @property {Meta} meta
 * @property {string} html
 * @property {Assets} assets
 * @property {string[]} warnings
 */

/**
 * A compiled page: the document plus its full HTML shell.
 * @typedef {object} CompiledPage
 * @property {Meta} meta
 * @property {string} html
 * @property {Assets} assets
 * @property {string[]} warnings
 */

const md = new MarkdownIt({ html: true });
md.use(bindingPlugin);
md.use(attrsPlugin);

// Raw HTML in markdown passes through by default (a documented design choice).
// Pages can opt out with frontmatter `html: false` for untrusted content; the
// stricter instance is built lazily so the default path stays a single instance.
/** @type {MarkdownIt | null} */
let mdNoHtml = null;
/**
 * Pick the markdown-it instance for a page (raw HTML on by default, off with `html: false`).
 * @param {Meta} [meta]
 * @returns {MarkdownIt}
 */
function selectMd(meta) {
  // Frontmatter scalars stay strings (no coercion), so accept both forms.
  if (meta?.html !== false && meta?.html !== "false") return md;
  if (!mdNoHtml) {
    mdNoHtml = new MarkdownIt({ html: false });
    mdNoHtml.use(bindingPlugin);
    mdNoHtml.use(attrsPlugin);
  }
  return mdNoHtml;
}

const pageIncludeExtensions = [".md", ".wd"];

/**
 * Compile a page source file into a full HTML document plus its assets.
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {Paths} context Resolved project paths.
 * @returns {CompiledPage}
 */
export function compilePage(file, context) {
  const compiled = compileDocument(file, context);
  const title = compiled.meta.title || "Darkmown";
  const description = compiled.meta.description || "";
  // Optional `image:` frontmatter sets the social-share preview (absolute URL).
  const image = typeof compiled.meta.image === "string" ? compiled.meta.image : "";
  /** @type {string[]} */
  const social = [];
  if (description) social.push(`<meta name="description" content="${escapeHtml(description)}">`);
  if (description || image) {
    social.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
    if (description) social.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    social.push(`<meta property="og:type" content="website">`);
  }
  if (image) {
    social.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
    social.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`);
  }
  if (description || image) {
    social.push(`<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`);
  }
  const descriptionTag = social.length ? `\n  ${social.join("\n  ")}` : "";
  const favicon = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2318221d'/%3E%3Ctext%20x='16'%20y='23'%20text-anchor='middle'%20font-family='Georgia,serif'%20font-size='19'%20font-weight='bold'%20fill='%23f7f3ea'%3ED%3C/text%3E%3C/svg%3E";
  const cssLinks = [...compiled.assets.skins].map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
  const scriptSrcs = compiled.assets.runtime ? ["/__wd/runtime.js", ...compiled.assets.scripts] : [...compiled.assets.scripts];
  const scripts = scriptSrcs.map((src) => `<script type="module" src="${src}"></script>`).join("\n");
  // Cross-document view transitions: opt in per page with `transitions: true` in
  // frontmatter to emit a CSS-only stylesheet — a smooth same-origin transition
  // on navigation, with zero JavaScript. Ignored by browsers without support
  // (graceful, transition-free fallback) and only applies to same-origin
  // navigations where both the outgoing and incoming page opt in.
  //
  // The default UA animation cross-fades the root: outgoing opacity 1→0 while
  // incoming 0→1, both at once. Mid-navigation that leaves the two pages
  // superimposed at ~50% opacity — headings ghost over headings. We override it
  // with a directional fade+slide (old lifts up and out, new rises up and in) so
  // the pages move past each other instead of stacking. Short + eased = peppy.
  const wantTransitions = compiled.meta.transitions === true || compiled.meta.transitions === "true";
  const transitions = wantTransitions
    ? `\n  <style>
    @view-transition { navigation: auto; }
    ::view-transition-old(root) { animation: wd-nav-out 200ms cubic-bezier(0.4, 0, 1, 1) both; }
    ::view-transition-new(root) { animation: wd-nav-in 200ms cubic-bezier(0, 0, 0.2, 1) both; }
    @keyframes wd-nav-out { to { opacity: 0; transform: translateY(-1rem); } }
    @keyframes wd-nav-in { from { opacity: 0; transform: translateY(1rem); } }
    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 1ms; }
      @keyframes wd-nav-out { to { opacity: 0; } }
      @keyframes wd-nav-in { from { opacity: 0; } }
    }
  </style>`
    : "";

  // The latency half of smooth navigation — and what kills the white flash. A
  // declarative speculationrules script (the browser interprets it — not
  // framework runtime JS, so the zero-JS invariant holds) *prerenders* the next
  // same-origin page on hover/pointerdown. Prefetch only warms the cache, so the
  // page still has to render on click — that render gap is the white flash. A
  // prerender renders the whole page in a hidden tab ahead of the click, so
  // activation is instant: no render gap, and the view transition fires on the
  // already-painted page. Safe now that pages are light. Eagerness `moderate` =
  // ~200ms hover / pointerdown, capped at two. Mark a link `{.no-prefetch}` to
  // opt it out; `rel=nofollow` links are never speculated. Browsers without
  // support (or with preloading disabled) ignore the tag and navigate normally.
  const speculation = wantTransitions
    ? `\n  <script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"selector_matches":".no-prefetch"}},{"not":{"selector_matches":"[rel~=nofollow]"}}]},"eagerness":"moderate"}]}</script>`
    : "";

  const body = enhanceImages(compiled.html, context);

  return {
    meta: compiled.meta,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${descriptionTag}
  <link rel="icon" href="${favicon}">
  ${cssLinks}${transitions}${speculation}
</head>
<body>
${body}
${scripts}
</body>
</html>`,
    assets: compiled.assets,
    warnings: compiled.warnings
  };
}

/**
 * Harden every `<img>` in the assembled page body — compile-time only, zero
 * runtime JS. Bare markdown images reflow the page as they decode (cumulative
 * layout shift — the literal "jump" on navigation) and load eagerly. This
 * stamps intrinsic `width`/`height` (read from the file on disk so the browser
 * reserves space), `decoding="async"` on all, and a load-priority split: the
 * first image is the LCP candidate (eager + `fetchpriority="high"`), the rest
 * lazy-load. Author-set attributes are never overwritten.
 * @param {string} html Assembled page body HTML.
 * @param {Paths} paths Resolved project paths.
 * @returns {string}
 */
export function enhanceImages(html, paths) {
  let index = 0;
  return html.replace(/<img\b[^>]*?\/?>/g, (tag) => {
    const i = index++;
    const has = (/** @type {string} */ attr) => new RegExp(`\\b${attr}\\s*=`, "i").test(tag);
    /** @type {string[]} */
    const add = [];
    // Dimensions only when the author hasn't sized it — adding one axis to a
    // manually-sized image would distort its aspect ratio.
    if (!has("width") && !has("height")) {
      const dim = measureImage(srcOf(tag), paths);
      if (dim) add.push(`width="${dim.width}"`, `height="${dim.height}"`);
    }
    if (!has("decoding")) add.push(`decoding="async"`);
    if (i === 0) {
      // First image is the LCP candidate: stays eager, gets a priority hint.
      if (!has("fetchpriority")) add.push(`fetchpriority="high"`);
    } else if (!has("loading")) {
      add.push(`loading="lazy"`);
    }
    if (!add.length) return tag;
    return `${tag.replace(/\s*\/?>\s*$/, "")} ${add.join(" ")}>`;
  });
}

/**
 * Extract the `src` attribute value from an `<img>` tag, or "" if absent.
 * @param {string} tag
 * @returns {string}
 */
function srcOf(tag) {
  const m = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
  return m ? m[1] : "";
}

/**
 * Read an image's intrinsic dimensions from disk, or null when the src is
 * remote/relative/unreadable. Resolution mirrors the asset emit: `/__wd/media/x`
 * comes from the shelf (`site/_`), other absolute paths from `site/pages`.
 * @param {string} src
 * @param {Paths} paths
 * @returns {{ width: number, height: number } | null}
 */
function measureImage(src, paths) {
  if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return null;
  let filePath;
  if (src.startsWith("/__wd/media/")) {
    filePath = path.join(paths.shelfRoot, src.slice("/__wd/media/".length));
  } else if (src.startsWith("/")) {
    filePath = path.join(paths.routesRoot, src.slice(1));
  } else {
    return null; // page-relative: the source directory is lost after assembly
  }
  try {
    const { width, height } = imageSize(fs.readFileSync(filePath));
    if (typeof width === "number" && typeof height === "number") return { width, height };
  } catch {
    /* missing or unreadable — degrade to no dimensions */
  }
  return null;
}

/**
 * Compile a source file into its body HTML, frontmatter, and assets (no page shell).
 * @param {string} file Absolute path to the source file.
 * @param {Paths} context Resolved project paths.
 * @param {string[]} [stack] Include stack for cycle detection.
 * @param {Record<string, unknown>} [vars] Initial static scope variables.
 * @returns {CompiledDocument}
 */
export function compileDocument(file, context, stack = [], vars = {}) {
  const comp = createCompilation();
  const result = compileFile(file, context, stack, createScope(null, vars), comp, [], null);
  return { meta: result.meta, html: result.html, assets: comp.assets, warnings: comp.warnings };
}

/** @returns {Compilation} */
function createCompilation() {
  return {
    assets: { skins: new Set(), scripts: new Set(), files: new Map(), runtime: false },
    state: new Map(),
    stores: new Set(),
    warnings: [],
    sectionCounter: 0
  };
}

/**
 * @param {Scope | null} parent
 * @param {Record<string, unknown>} [vars]
 * @returns {Scope}
 */
function createScope(parent, vars = {}) {
  return { parent, vars: { ...vars } };
}

/**
 * Compile a single file: parse frontmatter, collect assets, render body.
 * @param {string} file
 * @param {Paths} context
 * @param {string[]} stack
 * @param {Scope} scope
 * @param {Compilation} comp
 * @param {string[]} sections
 * @param {string | null} loopItem
 * @returns {{ meta: Meta, html: string }}
 */
function compileFile(file, context, stack, scope, comp, sections, loopItem) {
  const real = fs.realpathSync(file);
  if (stack.includes(real)) {
    throw new Error(`Include cycle detected: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`);
  }

  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw, file);
  collectColocatedAssets(file, context, comp.assets);

  if (path.extname(file) === ".md") {
    scanMarkdownHints(body, file, comp);
    return { meta, html: selectMd(meta).render(body, {}) };
  }

  // Expose this file's frontmatter to the body under `meta` so `{ meta.title }`,
  // `{ meta.tags }`, and `@loop meta.tags into tag` resolve as static values.
  /** @type {Ctx} */
  const ctx = { file, context, stack: [...stack, real], scope: createScope(scope, { meta }), comp, sections, loopItem, md: selectMd(meta) };
  return { meta, html: compileBody(body.replace(/\r\n?/g, "\n").split("\n"), ctx) };
}

/**
 * Split a raw file into its frontmatter `meta` and `body`.
 * @param {string} raw Full file contents.
 * @param {string} [file] Source path, used only for error messages.
 * @returns {{ meta: Meta, body: string }}
 */
export function parseFrontmatter(raw, file) {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    const where = file ? ` in ${file}` : "";
    throw new Error(`Unterminated frontmatter${where}: opening "---" has no closing "---". Use: --- on its own line to open and another --- to close, then the page body.`);
  }
  const front = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  /** @type {Meta} */
  const meta = {};
  for (const line of front.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = parseFrontmatterValue(match[2]);
  }
  return { meta, body };
}

// Frontmatter values are scalars, except an inline flow array `[a, b, c]`.
// Block sequences (`- item` on following lines) are intentionally out of scope —
// the parser stays single-pass and line-based.
/**
 * @param {string} raw
 * @returns {FrontmatterValue}
 */
function parseFrontmatterValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) return parseInlineArray(value);
  return stripQuotes(value);
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseInlineArray(raw) {
  const inner = raw.slice(1, -1);
  if (inner.trim() === "") return [];
  /** @type {string[]} */
  const items = [];
  let buf = "";
  let quote = null;
  let quoted = false;
  const push = () => {
    items.push(quoted ? buf : buf.trim());
    buf = "";
    quoted = false;
  };
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      else buf += char;
    } else if ((char === '"' || char === "'") && buf.trim() === "") {
      quote = char;
      quoted = true;
      buf = ""; // drop any whitespace between the comma and the opening quote
    } else if (char === ",") {
      push();
    } else {
      buf += char;
    }
  }
  push();
  return items;
}

// ---------------------------------------------------------------------------
// Block parser: directives + prose segments
// ---------------------------------------------------------------------------

/**
 * Parse a `.wd` body line-by-line into HTML, mixing directives and prose.
 * @param {string[]} lines
 * @param {Ctx} ctx
 * @returns {string}
 */
function compileBody(lines, ctx) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let prose = [];
  let fence = null;

  const flush = () => {
    if (!prose.length) return;
    const text = prose.join("\n");
    prose = [];
    if (text.trim()) out.push(renderProse(text, ctx));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      prose.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      prose.push(line);
      continue;
    }

    if (/^@include\s/.test(line)) {
      flush();
      out.push(handleInclude(line, ctx));
      continue;
    }
    if (/^@loop\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^@loop\s/, "@endloop", ctx.file);
      const split = splitEmptyBranch(block.body);
      out.push(handleLoop(line, split.body, split.empty, ctx));
      i = block.end;
      continue;
    }
    const container = line.match(/^:::\s*(.*)$/);
    if (container) {
      flush();
      if (!container[1].trim()) throw new Error(`Stray ::: close with no open container in ${ctx.file}`);
      const block = scanContainer(lines, i, ctx.file);
      out.push(handleContainer(container[1].trim(), block.body, ctx));
      i = block.end;
      continue;
    }
    if (/^:state\s/.test(line)) {
      flush();
      out.push(handleState(line, ctx));
      continue;
    }
    if (/^:store\s/.test(line)) {
      flush();
      out.push(handleStore(line, ctx));
      continue;
    }
    if (/^:fetch\s/.test(line)) {
      flush();
      out.push(handleFetch(line, ctx));
      continue;
    }
    if (/^:computed\s/.test(line)) {
      flush();
      out.push(handleComputed(line, ctx));
      continue;
    }
    if (/^:effect\s/.test(line)) {
      flush();
      out.push(handleEffect(line, ctx));
      continue;
    }
    if (/^:form\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^:form\s/, ":endform", ctx.file);
      out.push(handleForm(line, block.body, ctx));
      i = block.end;
      continue;
    }
    if (/^:input\s/.test(line)) {
      flush();
      out.push(handleInput(line, ctx));
      continue;
    }
    if (/^:textarea\s/.test(line)) {
      flush();
      out.push(handleTextarea(line, ctx));
      continue;
    }
    if (/^:select\s/.test(line)) {
      flush();
      const opts = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) { opts.push(lines[j]); j++; }
      out.push(handleSelect(line, opts, ctx));
      i = j - 1;
      continue;
    }
    const choiceMatch = line.match(/^:(checkbox|radio)\s/);
    if (choiceMatch) {
      flush();
      const opts = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) { opts.push(lines[j]); j++; }
      out.push(handleChoiceGroup(line, opts, ctx, /** @type {"checkbox" | "radio"} */ (choiceMatch[1])));
      i = j - 1;
      continue;
    }
    if (/^:bind\s/.test(line)) {
      flush();
      out.push(handleBind(line, ctx));
      continue;
    }
    if (/^:submit\s/.test(line)) {
      flush();
      out.push(handleSubmit(line, ctx));
      continue;
    }
    if (/^:button\s/.test(line)) {
      flush();
      out.push(handleButton(line, ctx));
      continue;
    }
    if (/^:if\s/.test(line)) {
      flush();
      const block = scanConditional(lines, i, ctx.file);
      out.push(handleIf(line, block.truthy, block.falsy, ctx));
      i = block.end;
      continue;
    }
    const demo = renderDemoDirective(line, ctx);
    if (demo) {
      flush();
      out.push(demo);
      continue;
    }
    if (/^@repeat\b/.test(line)) {
      throw new Error(`@repeat was replaced by @loop in ${ctx.file}. Use: @loop /data.json into item ... @endloop`);
    }
    if (/^:for\b/.test(line)) {
      throw new Error(`:for was replaced by @loop in ${ctx.file}. Use: @loop items into item ... @endloop`);
    }
    if (/^(@endloop|:endif|:endfor|:endform|:else)\s*$/.test(line)) {
      throw new Error(`Stray "${line.trim()}" with no matching opener in ${ctx.file}`);
    }
    prose.push(line);
  }

  flush();
  return out.join("\n");
}

/**
 * Capture lines from an opener until a matching close token, honoring nesting and fences.
 * @param {string[]} lines
 * @param {number} start Index of the opening line.
 * @param {RegExp} openRe Pattern that re-opens a nested block.
 * @param {string} endToken Literal closing token (e.g. `@endloop`).
 * @param {string} file Source path for errors.
 * @returns {{ body: string[], end: number }}
 */
function scanBlock(lines, start, openRe, endToken, file) {
  /** @type {string[]} */
  const body = [];
  let depth = 0;
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      body.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      body.push(line);
      continue;
    }
    if (openRe.test(line)) depth++;
    if (line.trim() === endToken) {
      if (depth === 0) return { body, end: i };
      depth--;
    }
    body.push(line);
  }
  throw new Error(`Missing ${endToken} for "${lines[start]}" in ${file}`);
}

/**
 * Split a `@loop` body at a top-level `@empty` into the rows body and the empty
 * branch. Honors nested `@loop … @endloop` (so an inner loop's `@empty` is not
 * mistaken for the outer one) and fenced code.
 * @param {string[]} body
 * @returns {{ body: string[], empty: string[] | null }}
 */
function splitEmptyBranch(body) {
  /** @type {string[]} */
  const rows = [];
  /** @type {string[] | null} */
  let empty = null;
  let target = rows;
  let depth = 0;
  let fence = null;
  for (const line of body) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      target.push(line);
      continue;
    }
    if (fenceMatch) { fence = fenceMatch[1]; target.push(line); continue; }
    if (/^@loop\s/.test(line)) depth++;
    if (line.trim() === "@endloop") depth--;
    if (depth === 0 && line.trim() === "@empty") { empty = []; target = empty; continue; }
    target.push(line);
  }
  return { body: rows, empty };
}

/**
 * Capture the body of a `:::` container up to its matching close, honoring nesting.
 * @param {string[]} lines
 * @param {number} start Index of the opening line.
 * @param {string} file Source path for errors.
 * @returns {{ body: string[], end: number }}
 */
function scanContainer(lines, start, file) {
  /** @type {string[]} */
  const body = [];
  let depth = 0;
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      body.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      body.push(line);
      continue;
    }
    const marker = line.match(/^:::\s*(.*)$/);
    if (marker) {
      if (marker[1].trim()) {
        depth++;
      } else if (depth === 0) {
        return { body, end: i };
      } else {
        depth--;
      }
    }
    body.push(line);
  }
  throw new Error(`Missing closing ::: for "${lines[start]}" in ${file}`);
}

/**
 * Split an `:if … :else if … :else … :endif` chain into the first condition's
 * truthy body and a falsy body. A bare `:else` works as before. The first
 * `:else if B` is **desugared** into a nested `:if` that lives in the falsy
 * branch: the falsy body becomes `[":if B", …rest…, ":endif"]`, which re-enters
 * `compileBody`/`handleIf` recursively. A whole `:if/:else if/:else` chain
 * therefore compiles to nested `data-wd-if` regions the runtime already drives —
 * identical behavior for static, reactive, and loop-row conditionals.
 * @param {string[]} lines
 * @param {number} start Index of the `:if` line.
 * @param {string} file Source path for errors.
 * @returns {{ truthy: string[], falsy: string[], end: number }}
 */
function scanConditional(lines, start, file) {
  /** @type {string[]} */
  const truthy = [];
  /** @type {string[]} */
  const falsy = [];
  let current = truthy;
  // "truthy": collecting the :if body. "else": a bare :else closed the chain —
  // no further branches allowed. "elseif": the first :else if was desugared into
  // a nested :if inside `falsy`; subsequent depth-0 :else if/:else lines belong to
  // that nested chain and are emitted verbatim for the recursive compile to split.
  let mode = "truthy";
  let depth = 0;
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      current.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (/^:if\s/.test(line)) depth++;
    if (line.trim() === ":endif") {
      if (depth === 0) {
        if (mode === "elseif") falsy.push(":endif"); // close the synthesized nested :if
        return { truthy, falsy, end: i };
      }
      depth--;
    }
    if (depth === 0 && mode !== "elseif") {
      const t = line.trim();
      const elseIf = t.match(/^:else if\s+(.+?)\s*$/);
      if (elseIf) {
        if (mode === "else") throw new Error(`":else if" after ":else" in ${file}. ":else" must be the last branch — order the "else if" conditions before the bare ":else".`);
        falsy.push(`:if ${elseIf[1]}`); // desugar the chain tail into a nested :if
        current = falsy;
        mode = "elseif";
        continue;
      }
      if (t === ":else") {
        if (mode === "else") throw new Error(`Duplicate ":else" in ${file}. A conditional may have only one bare ":else".`);
        current = falsy;
        mode = "else";
        continue;
      }
    }
    current.push(line);
  }
  throw new Error(`Missing :endif for "${lines[start]}" in ${file}`);
}

// ---------------------------------------------------------------------------
// Directive handlers
// ---------------------------------------------------------------------------

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleInclude(line, ctx) {
  const match = line.match(/^@include\s+(\S+)(?:\s+with\s+(.+))?$/);
  if (!match) throw new Error(`Malformed @include in ${ctx.file}: ${line}`);
  const target = resolveInclude(match[1], ctx.file, ctx.context);
  const args = parseIncludeArgs(match[2] || "", ctx);
  const scope = createScope(ctx.scope, args);
  const child = compileFile(target, ctx.context, ctx.stack, scope, ctx.comp, ctx.sections, ctx.loopItem);
  return child.html;
}

/**
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {Record<string, unknown>}
 */
function parseIncludeArgs(raw, ctx) {
  /** @type {Record<string, unknown>} */
  const args = {};
  const re = /([A-Za-z0-9_-]+)=("[^"]*"|'[^']*'|\{[^}]*\}|\S+)/g;
  for (const match of raw.matchAll(re)) {
    const value = match[2];
    if (value.startsWith("{")) {
      const expr = value.slice(1, -1).trim();
      const resolved = lookupPath(expr, ctx);
      if (!resolved.found) {
        throw new Error(`@include argument ${match[1]}={ ${expr} } in ${ctx.file} does not match any value in scope`);
      }
      args[match[1]] = resolved.value;
    } else {
      args[match[1]] = parseScalar(value);
    }
  }
  return args;
}

/**
 * @param {string} header
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleContainer(header, bodyLines, ctx) {
  let rest = header.trim();
  let tag = "section";
  /** @type {string[]} Static classes baked into class="". */
  const extraClass = [];
  /** @type {[string, string][]} Reactive loop-item class bindings (data-wd-each-class). */
  const eachClasses = [];
  /** @type {[string, string][]} Global state-driven class bindings (data-wd-class). */
  const stateClasses = [];
  let id = "";
  // Leading tag/name token (anything not starting with . or #). "section" keeps
  // the <section> tag; any other name becomes a <div> and also a class.
  const lead = rest.match(/^([^\s.#]\S*)/);
  let nameToken = "section";
  if (lead) { nameToken = lead[1]; rest = rest.slice(lead[0].length).trim(); }
  if (nameToken !== "section") { tag = "div"; extraClass.push(nameToken); }
  while (rest.length) {
    if (rest.startsWith("#")) {
      const m = rest.match(/^#(\S+)/);
      id = (m ? m[1] : "");
      rest = rest.slice((m ? m[0] : rest).length).trim();
      continue;
    }
    const cm = rest.match(/^\.([A-Za-z_][\w-]*)/);
    if (!cm) throw new Error(`Unexpected token "${rest.split(/\s+/)[0]}" in container "::: ${header}" in ${ctx.file}`);
    const cls = cm[1];
    rest = rest.slice(cm[0].length).trim();
    // Optional `when <predicate>` makes the class reactive. The predicate runs to
    // the next ` .`/` #` token or the end of the header.
    const whenMatch = rest.match(/^when\s+(.+?)(?=\s+[.#]|$)/);
    if (whenMatch) {
      rest = rest.slice(whenMatch[0].length).trim();
      const compiled = compileWhen(whenMatch[1].trim(), ctx);
      if (compiled.static) { if (compiled.value) extraClass.push(cls); }
      else if (compiled.item) eachClasses.push([cls, compiled.body]);
      else stateClasses.push([cls, compiled.body]);
    } else {
      extraClass.push(cls);
    }
  }
  const explicitId = Boolean(id);
  if (!id) id = `wd-s${++ctx.comp.sectionCounter}`;

  ctx.sections.push(id);
  let inner;
  try {
    inner = compileBody(bodyLines, ctx);
  } finally {
    ctx.sections.pop();
  }
  const idAttr = explicitId ? ` id="${escapeHtml(id)}"` : "";
  const classAttr = extraClass.length ? ` class="${escapeHtml(extraClass.join(" "))}"` : "";
  let classBind = "";
  if (eachClasses.length) { ctx.comp.assets.runtime = true; classBind += ` data-wd-each-class="${escapeHtml(JSON.stringify(eachClasses))}"`; }
  if (stateClasses.length) { ctx.comp.assets.runtime = true; classBind += ` data-wd-class="${escapeHtml(JSON.stringify(stateClasses))}"`; }
  return `<${tag}${idAttr}${classAttr}${classBind}>\n${inner}\n</${tag}>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleState(line, ctx) {
  const match = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+persist)?$/);
  if (!match) throw new Error(`Malformed :state in ${ctx.file}: ${line}`);
  const value = parseStateValue(match[2]);
  const key = declareState(match[1], value, ctx);
  const persistAttr = match[3] ? ` data-wd-persist="${key}"` : "";
  return `<script type="application/json" data-wd-state${persistAttr}>${safeScriptJson({ [key]: value })}</script>`;
}

/**
 * Register a state key in the current section scope, enabling the runtime.
 * @param {string} name
 * @param {unknown} value
 * @param {Ctx} ctx
 * @returns {string} The fully-qualified state key.
 */
function declareState(name, value, ctx) {
  if (ctx.loopItem) throw new Error(`State cannot be declared inside a reactive @loop body (${ctx.file})`);
  if (ctx.comp.stores.has(name)) throw new Error(`State "${name}" collides with a :store of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one.`);
  const key = ctx.sections.length ? `${ctx.sections.at(-1)}:${name}` : name;
  if (ctx.comp.state.has(key)) throw new Error(`State "${name}" is declared twice in the same scope (${ctx.file})`);
  ctx.comp.state.set(key, value);
  ctx.comp.assets.runtime = true;
  return key;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleStore(line, ctx) {
  const match = line.match(/^:store\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+ephemeral)?$/);
  if (!match) throw new Error(`Malformed :store in ${ctx.file}: ${line}. Use: :store name = value [ephemeral]`);
  const value = parseStateValue(match[2]);
  const name = declareStore(match[1], value, ctx);
  const ephemeral = match[3] ? " data-wd-store-ephemeral" : "";
  return `<script type="application/json" data-wd-store="${name}"${ephemeral}>${safeScriptJson(value)}</script>`;
}

/**
 * Register a page-global store. The bare name is added to `comp.state` so every
 * resolver (interpolation, :if, @loop, :computed, actions) sees it, and tracked
 * in `comp.stores` for collision checks. Never section-scoped.
 * @param {string} name
 * @param {unknown} value
 * @param {Ctx} ctx
 * @returns {string} The store name (also its bare state key).
 */
function declareStore(name, value, ctx) {
  if (ctx.comp.stores.has(name)) throw new Error(`Store "${name}" is declared twice in ${ctx.file}. Use: :store name = value`);
  if (ctx.comp.state.has(name)) throw new Error(`Store "${name}" collides with a :state of the same name in ${ctx.file}. Use: :store name = value for the global, or rename one.`);
  ctx.comp.stores.add(name);
  ctx.comp.state.set(name, value);
  ctx.comp.assets.runtime = true;
  return name;
}

/**
 * Seed a `<name>_error` state key (null) if absent. Shared by :fetch and the
 * round-trip :form so error fallbacks have a key to bind.
 * @param {string} key
 * @param {Ctx} ctx
 * @returns {void}
 */
function declareErrorState(key, ctx) {
  const errorKey = `${key}_error`;
  if (!ctx.comp.state.has(errorKey)) ctx.comp.state.set(errorKey, null);
}

const FETCH_USE =
  'Use: :fetch name from "url" [method=…] [timeout=ms] [retry=N] [when=visible] [headers=key] [body=key] [refresh=url]';

/**
 * Parse a keyword-arg `:fetch` directive into a lifecycle-aware marker.
 * Auto-declares four state keys (value/error/loading/empty), seeds them, and
 * emits `data-wd-fetch-*` attributes (url/method/when/timeout/retry/headers/
 * body/deps) consumed by the runtime's `startFetch`.
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleFetch(line, ctx) {
  const head = line.match(/^:fetch\s+([A-Za-z_$][\w$]*)\s+from\s+("[^"]+"|\S+)\s*(.*)$/);
  if (!head) throw new Error(`Malformed :fetch in ${ctx.file}: ${line}. ${FETCH_USE}`);
  const name = head[1];
  const url = validateFetchUrl(stripQuotes(head[2]), ctx);
  /** @type {Record<string, string>} */
  const opts = {};
  for (const part of head[3].trim().split(/\s+/).filter(Boolean)) {
    const kv = part.match(/^([A-Za-z]+)=(.+)$/);
    if (!kv) throw new Error(`Unknown :fetch option "${part}" in ${ctx.file}. ${FETCH_USE}`);
    const optName = kv[1];
    if (!["method", "when", "timeout", "retry", "headers", "body", "refresh"].includes(optName)) {
      throw new Error(`Unknown :fetch option "${optName}" in ${ctx.file}. ${FETCH_USE}`);
    }
    opts[optName] = stripQuotes(kv[2]);
  }

  if (opts.method && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(opts.method.toUpperCase())) {
    throw new Error(`:fetch method "${opts.method}" is not allowed in ${ctx.file}. ${FETCH_USE}`);
  }
  if (opts.when && !["load", "visible"].includes(opts.when)) {
    throw new Error(`:fetch when "${opts.when}" is not allowed in ${ctx.file}. ${FETCH_USE}`);
  }
  for (const n of ["timeout", "retry"]) {
    if (opts[n] !== undefined && !/^\d+$/.test(opts[n])) {
      throw new Error(`:fetch ${n} must be a non-negative integer in ${ctx.file}. ${FETCH_USE}`);
    }
  }
  if (opts.refresh !== undefined) {
    // Layer 2: a 401 triggers a token-refresh POST to this URL, then one retry.
    // The new token is written back into the `headers=` state, so it is required.
    if (!opts.headers) {
      throw new Error(`:fetch refresh= needs headers= (the state key holding the token to renew) in ${ctx.file}. ${FETCH_USE}`);
    }
    opts.refresh = validateFetchUrl(opts.refresh, ctx, ":fetch refresh");
  }

  // Extract `{ path }` dependency keys from the URL (validated against poison
  // segments). The runtime fills them from state on each (re)fetch.
  /** @type {string[]} */
  const deps = [];
  for (const dep of url.matchAll(/\{\s*([A-Za-z_$][\w$.]*)\s*\}/g)) {
    validatePath(dep[1], ctx, FETCH_USE);
    const headKey = dep[1].split(".")[0];
    if (!deps.includes(headKey)) deps.push(headKey);
  }

  // Auto-declare the four lifecycle keys. `name` is declared via declareState
  // (collision-checked); the derived keys are seeded directly.
  const key = declareState(name, null, ctx);
  /** @type {Record<string, unknown>} */
  const seeds = { [key]: null };
  for (const [suffix, seed] of [["_error", null], ["_loading", false], ["_empty", false]]) {
    const k = `${key}${suffix}`;
    if (!ctx.comp.state.has(k)) ctx.comp.state.set(k, seed);
    seeds[k] = seed;
  }

  /** @param {string} n @param {string | null | false | undefined} v */
  const attr = (n, v) => (v != null && v !== false && v !== "" ? ` data-wd-fetch-${n}="${escapeHtml(v)}"` : "");
  const marker =
    `<span data-wd-fetch data-wd-fetch-key="${key}" data-wd-fetch-url="${escapeHtml(url)}"` +
    attr("method", opts.method && opts.method.toUpperCase()) +
    attr("when", opts.when === "visible" ? "visible" : "") +
    attr("timeout", opts.timeout) +
    attr("retry", opts.retry) +
    attr("headers", opts.headers && resolveStateKey(opts.headers, ctx)) +
    attr("body", opts.body && resolveStateKey(opts.body, ctx)) +
    attr("refresh", opts.refresh) +
    attr("deps", deps.join(",")) +
    `></span>`;
  return `<script type="application/json" data-wd-state>${safeScriptJson(seeds)}</script>${marker}`;
}

/**
 * Validate a `:fetch` (or `refresh=`) URL's scheme at compile time. Mirrors the
 * `:try` href guard: relative paths (`/`, `./`, `../`, bare), an `http(s)://`
 * URL, or a leading `{ state }` interpolation are allowed; a protocol-relative
 * `//host` or any non-http(s) scheme (`file:`, `data:`, `javascript:`, …) is
 * rejected. Interpolated values are percent-encoded by the runtime, so a scheme
 * cannot be injected through state at request time.
 * @param {string} url
 * @param {Ctx} ctx
 * @param {string} [what] Option name for the error message.
 * @returns {string}
 */
function validateFetchUrl(url, ctx, what = ":fetch") {
  const value = url.trim();
  if (value !== url || value === "" || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Use a relative path (/, ./, ../), an http(s):// URL, or a { state } interpolation.`);
  }
  if (value.startsWith("//")) {
    throw new Error(`Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http:// or https:// explicitly.`);
  }
  if (value.startsWith("{")) return value; // interpolation-first; the runtime percent-encodes state values
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && !["http", "https"].includes(scheme[1].toLowerCase())) {
    throw new Error(`Unsafe ${what} URL "${escapeHtml(url)}" in ${ctx.file}. The "${scheme[1]}:" scheme is not allowed; use http://, https://, or a relative path.`);
  }
  return value;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleComputed(line, ctx) {
  const match = line.match(/^:computed\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (!match) throw new Error(`Malformed :computed in ${ctx.file}: ${line}. Use: :computed total = items.length * 4`);
  const expr = compileComputedExpr(match[2].trim(), ctx);
  /** @type {unknown} */
  let initial;
  try {
    /** @param {string} key @param {string} [path] */
    const read = (key, path) => getPath(ctx.comp.state.get(key), path ? path.split(".") : []);
    initial = new Function("S", `return (${expr});`)(read);
  } catch {
    console.warn(`:computed "${match[2].trim()}" in ${ctx.file} could not be evaluated at build time; falling back to null. Check the expression.`);
    initial = null;
  }
  const key = declareState(match[1], initial ?? null, ctx);
  return `<span data-wd-computed data-wd-computed-key="${key}" data-wd-computed-expr="${escapeHtml(expr)}"></span><script type="application/json" data-wd-state>${safeScriptJson({ [key]: initial ?? null })}</script>`;
}

/**
 * Compile a `:computed` expression into safe JS over the `S(key, path)` reader.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {string}
 */
function compileComputedExpr(raw, ctx) {
  /** @type {string[]} */
  const strings = [];
  let expr = raw.replace(/"[^"\\]*"|'[^'\\]*'/g, (literal) => {
    // JSON.stringify fully escapes embedded ", \, etc. so the re-inserted literal
    // (line below) is an inert JS string and cannot terminate early to smuggle in
    // live code. Mirrors the SAFE @loop where path (compileOperand).
    strings.push(JSON.stringify(literal.slice(1, -1)));
    return `__WDSTR${strings.length - 1}__`;
  });
  if (/["'\\`]/.test(expr)) {
    throw new Error(`Unsupported string syntax in :computed expression "${raw}" (${ctx.file})`);
  }
  if (!/^[\w$.\s+\-*/%()<>=!&|]*$/.test(expr)) {
    throw new Error(
      `Unsupported syntax in :computed expression "${raw}" (${ctx.file}). Allowed: state names, numbers, strings, + - * / % ( ), comparisons, && || !.`
    );
  }
  if (/(^|[^=!<>])=(?!=)/.test(expr)) {
    throw new Error(`Assignment is not allowed in :computed expressions ("${raw}" in ${ctx.file})`);
  }
  expr = expr.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, (ref) => {
    if (/^__WDSTR\d+__$/.test(ref)) return ref;
    if (["true", "false", "null"].includes(ref)) return ref;
    const segs = ref.split(".");
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(`Path segment "${ref}" is not allowed in :computed expressions (${ctx.file})`);
    }
    const key = resolveStateKey(segs[0], ctx);
    if (!key) {
      throw new Error(`:computed references unknown state "${segs[0]}" in ${ctx.file}. Declare it with :state or :fetch first.`);
    }
    const rest = segs.slice(1).join(".");
    return `S(${JSON.stringify(key)}${rest ? `,${JSON.stringify(rest)}` : ""})`;
  });
  return expr.replace(/__WDSTR(\d+)__/g, (_, index) => strings[Number(index)]);
}

/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleForm(line, bodyLines, ctx) {
  let rest = line.slice(":form".length).trim();
  const rawAction = rest.match(/action="([^"]+)"/)?.[1];
  const method = rest.match(/method="([^"]+)"/)?.[1] || "post";
  const into = rest.match(/(?:^|\s)into\s+([A-Za-z_$][\w$]*)/)?.[1];
  const leftover = rest
    .replace(/action="[^"]+"/, "")
    .replace(/method="[^"]+"/, "")
    .replace(/(?:^|\s)into\s+[A-Za-z_$][\w$]*/, "")
    .trim();
  if ((!rawAction && !into) || leftover) {
    throw new Error(
      `Malformed :form in ${ctx.file}: ${line}. Use ':form into name' (client state), ':form action="/url"' (native post), or both (fetch round-trip into state).`
    );
  }
  const action = rawAction ? validateFetchUrl(rawAction, ctx, ":form action") : undefined;
  const inner = compileBody(bodyLines, ctx).trim();
  if (!into) {
    return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}">${inner}</form>`;
  }
  const key = declareState(into, null, ctx);
  declareErrorState(key, ctx);
  const actionAttrs = action ? ` action="${escapeHtml(action)}" method="${escapeHtml(method)}"` : "";
  return `<script type="application/json" data-wd-state>${safeScriptJson({ [key]: null })}</script><form data-wd-form="${key}"${actionAttrs}>${inner}</form>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleInput(line, ctx) {
  const match = line.match(/^:input\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :input in ${ctx.file}: ${line}`);
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let type = "text";
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw new Error(`Unknown :input flag "${token[3]}" in ${ctx.file}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") {
      type = value;
      continue;
    }
    if (!["placeholder", "value", "min", "max", "step", "pattern", "autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :input attribute "${token[1]}" in ${ctx.file}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name: if the author supplied neither aria-label nor aria-describedby,
  // derive a non-visual aria-label from the placeholder, else from the field name.
  // Never overrides an author-supplied aria attribute (zero layout impact).
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<input type="${escapeHtml(type)}" ${attrs.join(" ")}>`;
}

// :bind <state> [placeholder="…"] [type=…] — a live two-way input bound to a
// declared :state. Updates state on every keystroke; reflects state back when
// not focused. The state must be declared first (with :state).
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleBind(line, ctx) {
  const match = line.match(/^:bind\s+([A-Za-z_$][\w$]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :bind in ${ctx.file}: ${line}. Use: :bind query placeholder="Search"`);
  const key = resolveStateKey(match[1], ctx);
  if (!key) {
    throw new Error(`:bind ${match[1]} in ${ctx.file} has no matching state. Declare it first: :state ${match[1]} = ""`);
  }
  ctx.comp.assets.runtime = true;
  let type = "text";
  let placeholder;
  let hasAria = false;
  const attrs = [];
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus"].includes(token[3])) throw new Error(`Unknown :bind flag "${token[3]}" in ${ctx.file}`);
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "type") { type = value; continue; }
    if (!["placeholder", "autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :bind attribute "${token[1]}" in ${ctx.file}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  // Accessible name (see handleInput): default a non-visual aria-label from the
  // placeholder, else a humanized version of the bound state key. The author's own
  // aria-label/aria-describedby always wins.
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  const initial = ctx.comp.state.get(key);
  const valueAttr = initial === undefined || initial === null ? "" : ` value="${escapeHtml(String(initial))}"`;
  return `<input type="${escapeHtml(type)}" data-wd-bind-input="${key}"${valueAttr} ${attrs.join(" ")}>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleSubmit(line, ctx) {
  const match = line.match(/^:submit\s+"([^"]+)"\s*$/);
  if (!match) throw new Error(`Malformed :submit in ${ctx.file}: ${line}. Use: :submit "Label"`);
  return `<button type="submit">${escapeHtml(match[1])}</button>`;
}

/**
 * `:textarea name [placeholder="…"] [rows=N] [required]` → a `<textarea>`. Like
 * `:input`, it derives a non-visual aria-label from the placeholder (else the
 * humanized name) when the author supplies none. Captured by the runtime's
 * FormData exactly like `:input` — no runtime change needed.
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleTextarea(line, ctx) {
  const match = line.match(/^:textarea\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :textarea in ${ctx.file}: ${line}. Use: :textarea name [placeholder="…"] [rows=N] [required]`);
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let placeholder;
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "autofocus", "disabled", "readonly"].includes(token[3])) {
        throw new Error(`Unknown :textarea flag "${token[3]}" in ${ctx.file}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (!["placeholder", "rows", "cols", "minlength", "maxlength", "autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :textarea attribute "${token[1]}" in ${ctx.file}`);
    }
    if (token[1] === "placeholder") placeholder = value;
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(placeholder || humanizeName(match[1]))}"`);
  }
  return `<textarea ${attrs.join(" ")}></textarea>`;
}

/**
 * `:select name [required]` followed by `- Label` list lines → a `<select>` with
 * one `<option>` per label (value === label). Derives an aria-label from the
 * humanized name when none is given. Captured by FormData like the other fields.
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleSelect(line, optionLines, ctx) {
  const match = line.match(/^:select\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :select in ${ctx.file}: ${line}. Use: :select name [required] then "- Label" lines`);
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let hasAria = false;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw new Error(`Unknown :select flag "${token[3]}" in ${ctx.file}`);
      }
      attrs.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (!["autocomplete", "aria-label", "aria-describedby"].includes(token[1])) {
      throw new Error(`Unknown :select attribute "${token[1]}" in ${ctx.file}`);
    }
    if (token[1] === "aria-label" || token[1] === "aria-describedby") hasAria = true;
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  if (!hasAria) {
    attrs.push(`aria-label="${escapeHtml(humanizeName(match[1]))}"`);
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw new Error(`:select "${match[1]}" in ${ctx.file} has no options. Add "- Label" lines beneath it.`);
  }
  const opts = options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  return `<select ${attrs.join(" ")}>${opts}</select>`;
}

/**
 * `:checkbox name [required]` / `:radio name [required]` followed by `- Label`
 * lines → a labelled group of `<input type=checkbox|radio>`, each sharing `name`
 * with value === label and wrapped in its own `<label>`. The group is a
 * `role="group"` / `role="radiogroup"` container with an aria-label (explicit or
 * humanized from the name). Checkbox groups are marked `data-wd-multi="name"` so
 * the runtime captures every checked value as an array (`FormData.getAll`); radio
 * groups capture a single value like `:input`. Flags: `required` (radio → the
 * group; not emitted on checkboxes, where "at least one" has no native HTML form),
 * `disabled` (whole group), `autofocus` (first control).
 * @param {string} line
 * @param {string[]} optionLines The following `- Label` lines consumed by dispatch.
 * @param {Ctx} ctx
 * @param {"checkbox" | "radio"} kind
 * @returns {string}
 */
function handleChoiceGroup(line, optionLines, ctx, kind) {
  const directive = `:${kind}`;
  const match = line.match(kind === "checkbox" ? /^:checkbox\s+([A-Za-z_][\w-]*)\s*(.*)$/ : /^:radio\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed ${directive} in ${ctx.file}: ${line}. Use: ${directive} name [required] then "- Label" lines`);
  const name = match[1];
  const flags = [];
  let ariaLabel = null;
  let ariaDescribedby = null;
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!["required", "disabled", "autofocus"].includes(token[3])) {
        throw new Error(`Unknown ${directive} flag "${token[3]}" in ${ctx.file}`);
      }
      flags.push(token[3]);
      continue;
    }
    const value = stripQuotes(token[2]);
    if (token[1] === "aria-label") ariaLabel = value;
    else if (token[1] === "aria-describedby") ariaDescribedby = value;
    else throw new Error(`Unknown ${directive} attribute "${token[1]}" in ${ctx.file}`);
  }
  const options = optionLines.map((l) => l.replace(/^\s*-\s+/, "").trim()).filter(Boolean);
  if (!options.length) {
    throw new Error(`${directive} "${name}" in ${ctx.file} has no options. Add "- Label" lines beneath it.`);
  }
  const isCheckbox = kind === "checkbox";
  const groupAttrs = [`class="wd-${isCheckbox ? "checkboxes" : "radios"}"`, `role="${isCheckbox ? "group" : "radiogroup"}"`];
  if (isCheckbox) groupAttrs.push(`data-wd-multi="${escapeHtml(name)}"`);
  groupAttrs.push(`aria-label="${escapeHtml(ariaLabel || humanizeName(name))}"`);
  if (ariaDescribedby) groupAttrs.push(`aria-describedby="${escapeHtml(ariaDescribedby)}"`);
  const disabled = flags.includes("disabled");
  const required = flags.includes("required");
  const autofocus = flags.includes("autofocus");
  const controls = options.map((opt, idx) => {
    const a = [`type="${kind}"`, `name="${escapeHtml(name)}"`, `value="${escapeHtml(opt)}"`];
    if (disabled) a.push("disabled");
    if (required && !isCheckbox) a.push("required");
    if (autofocus && idx === 0) a.push("autofocus");
    return `<label><input ${a.join(" ")}> ${escapeHtml(opt)}</label>`;
  }).join("");
  return `<div ${groupAttrs.join(" ")}>${controls}</div>`;
}

/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleButton(line, ctx) {
  const match = line.match(/^:button\s+"([^"]+)"\s*->\s*(.+)$/);
  if (!match) throw new Error(`Malformed :button in ${ctx.file}: ${line}`);
  ctx.comp.assets.runtime = true;
  const action = parseAction(match[2], ctx);
  if (Array.isArray(action)) {
    return `<button type="button" data-wd-actions="${escapeHtml(JSON.stringify(action))}">${escapeHtml(match[1])}</button>`;
  }
  const valueAttr = action.value === undefined ? "" : ` data-wd-value="${escapeHtml(JSON.stringify(action.value))}"`;
  return `<button type="button" data-wd-action="${action.op}" data-wd-target="${action.target}"${valueAttr}>${escapeHtml(match[1])}</button>`;
}

const EFFECT_USE = "Use: :effect watchedState -> action[; action…] (actions use the :button vocabulary).";

/**
 * Parse `:effect <watched> -> <actions>` into a zero-output marker the runtime
 * watches: when `<watched>` state changes, it runs `<actions>` (the same `:button`
 * action vocabulary, `;`-chained). For arbitrary side effects beyond `:computed`
 * (derive state) and fetch deps (auto-refetch).
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleEffect(line, ctx) {
  const match = line.match(/^:effect\s+([A-Za-z_$][\w$.]*)\s*->\s*(.+)$/);
  if (!match) throw new Error(`Malformed :effect in ${ctx.file}: ${line}. ${EFFECT_USE}`);
  const segs = validatePath(match[1], ctx, EFFECT_USE);
  const key = resolveStateKey(segs[0], ctx);
  if (!key) throw new Error(`:effect watches unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`);
  ctx.comp.assets.runtime = true;
  const watch = [key, ...segs.slice(1)].join(".");
  const action = parseAction(match[2], ctx);
  const actions = Array.isArray(action) ? action : [action];
  return `<script type="application/json" data-wd-effect>${safeScriptJson({ watch, actions })}</script>`;
}

/**
 * @param {string} line
 * @param {string[]} truthyLines
 * @param {string[]} falsyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleIf(line, truthyLines, falsyLines, ctx) {
  const condition = line.replace(/^:if\s+/, "").trim();
  // Fast path: a bare truthy dotted path (`:if open`, `:if item.done`). Keeps the
  // existing markup/behavior identical. Anything with operators (`>`, `==`, `and`,
  // `not`, …) falls through to the predicate path below.
  const match = condition.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
  if (match) {
    const segs = match[1].split(".");
    const head = segs[0];

    // Per-row meta vars in :if — only valid inside a loop.
    if (LOOP_META[head]) {
      if (!ctx.loopMeta) throw new Error(`":if ${match[1]}" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Use it inside a loop body.`);
      if (ctx.loopItem) {
        const truthy = compileBody(truthyLines, ctx).trim();
        const falsy = compileBody(falsyLines, ctx).trim();
        return `<span data-wd-each-if data-wd-meta="${LOOP_META[head]}"><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
      }
      // static: the meta boolean is in scope — fall through to the static branch below.
    }

    const staticValue = lookupVar(ctx.scope, head);
    if (staticValue.found) {
      const active = Boolean(getPath(staticValue.value, segs.slice(1)));
      return compileBody(active ? truthyLines : falsyLines, ctx);
    }

    if (ctx.loopItem && head === ctx.loopItem) {
      const truthy = compileBody(truthyLines, ctx).trim();
      const falsy = compileBody(falsyLines, ctx).trim();
      const rest = segs.slice(1).join(".");
      const pathAttr = ` data-wd-path="${escapeHtml(rest)}"`;
      return `<span data-wd-each-if${pathAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
    }

    const key = resolveStateKey(head, ctx);
    if (!key) {
      throw new Error(`:if ${match[1]} in ${ctx.file} does not match a :state or in-scope value. Declare it first.`);
    }
    ctx.comp.assets.runtime = true;
    const truthy = compileBody(truthyLines, ctx).trim();
    const falsy = compileBody(falsyLines, ctx).trim();
    const restPath = segs.slice(1).join(".");
    const pathAttr = restPath ? ` data-wd-path="${escapeHtml(restPath)}"` : "";
    const initialTruthy = Boolean(getPath(ctx.comp.state.get(key), segs.slice(1)));
    const active = initialTruthy ? truthy : falsy;
    return `<div data-wd-if="${key}"${pathAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
  }

  // Predicate path: a comparison / logical condition. Compiles through the same
  // whitelist as `@loop … where` / `.class when` (with `not`), so it folds at
  // build when static, drives a per-row each-if when it reads the loop item, and
  // a global if-region (evaluated each render) when it reads state. No raw eval.
  if (!condition) throw new Error(`Malformed :if in ${ctx.file}: ${line}. Use ":if name" or ":if a <op> b [and|or|not …]".`);
  const compiled = compileWhen(condition, ctx, '":if"');
  if (compiled.static) return compileBody(compiled.value ? truthyLines : falsyLines, ctx);
  ctx.comp.assets.runtime = true;
  const truthy = compileBody(truthyLines, ctx).trim();
  const falsy = compileBody(falsyLines, ctx).trim();
  const exprAttr = ` data-wd-if-expr="${escapeHtml(compiled.body)}"`;
  if (compiled.item) {
    return `<span data-wd-each-if${exprAttr}><template data-wd-if-true>${truthy}</template><template data-wd-if-false>${falsy}</template><span data-wd-each-if-out></span></span>`;
  }
  const initialTruthy = evalPredicate(compiled.body, undefined, ctx);
  const active = initialTruthy ? truthy : falsy;
  return `<div data-wd-if=""${exprAttr} data-wd-if-active="${initialTruthy}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><div data-wd-if-out>${active}</div></div>`;
}

// The fixed corrective suggestion shown for any malformed @loop header.
const LOOP_USAGE = "Use: @loop src into item [where …] [sort by …] [reverse] [offset N] [limit N]";

// Reserved per-row meta variables, mapped to their runtime marker token.
/** @type {Record<string, string>} */
const LOOP_META = { $index: "index", $number: "number", $first: "first", $last: "last", $count: "count" };

/**
 * Parse the optional clause tail of a `@loop` header in FIXED order:
 * `[where P] [sort by key [asc|desc]] [reverse] [offset N] [limit N]`.
 * @param {string} tail Everything after `@loop src into item`.
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ where: string|null, sort: {key:string,dir:string}|null, reverse: boolean, offset: NumArg|null, limit: NumArg|null, refsState: boolean }}
 */
function parseLoopClauses(tail, itemName, ctx) {
  // Peel clauses off the END in reverse fixed-order (limit, offset, reverse,
  // sort by). Parsing from the tail avoids mistaking a state operand named
  // `limit`/`offset` inside the `where` predicate for a clause keyword. Whatever
  // remains must be `where …` (or empty); a clause keyword surviving in the
  // remainder means the author wrote the clauses out of order.
  let s = tail.trim();
  /** @type {{key:string,dir:string}|null} */ let sort = null;
  let reverse = false;
  /** @type {NumArg|null} */ let offset = null;
  /** @type {NumArg|null} */ let limit = null;
  let refsState = false;
  /** @returns {never} */
  const bad = () => { throw new Error(`Malformed @loop clause in ${ctx.file}: "${tail.trim()}". ${LOOP_USAGE}`); };

  let m = s.match(/(^|\s)limit\s+(\d+|[A-Za-z_$][\w$]*)$/);
  if (m) { limit = parseNumArg(m[2], ctx); refsState = refsState || limit.kind === "key"; s = s.slice(0, s.length - m[0].length + m[1].length).trim(); }

  m = s.match(/(^|\s)offset\s+(\d+|[A-Za-z_$][\w$]*)$/);
  if (m) { offset = parseNumArg(m[2], ctx); refsState = refsState || offset.kind === "key"; s = s.slice(0, s.length - m[0].length + m[1].length).trim(); }

  m = s.match(/(^|\s)reverse$/);
  if (m) { reverse = true; s = s.slice(0, s.length - m[0].length + m[1].length).trim(); }

  m = s.match(/(^|\s)sort\s+by\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\s+(asc|desc))?$/);
  if (m) {
    const segs = m[2].split(".");
    if (segs[0] !== itemName) throw new Error(`@loop sort key "${m[2]}" must start with the loop item "${itemName}" in ${ctx.file}. ${LOOP_USAGE}`);
    const rest = segs.slice(1);
    if (rest.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(`Sort key "${m[2]}" is not allowed in @loop (${ctx.file})`);
    }
    sort = { key: rest.join("."), dir: m[3] || "asc" };
    s = s.slice(0, s.length - m[0].length + m[1].length).trim();
  }

  /** @type {string|null} */ let where = null;
  if (s.length) {
    m = s.match(/^where\s+(.+)$/);
    if (!m) return bad(); // leftover non-where text → clauses written out of order
    where = m[1].trim();
    // `sort by`/`reverse` are never valid where operands; their presence in the
    // predicate means a clause was written before `where` finished (wrong order).
    if (/(^|\s)(sort\s+by\s|reverse(\s|$))/.test(where)) bad();
  }
  return { where, sort, reverse, offset, limit, refsState };
}

/**
 * A loop offset/limit argument: a non-negative integer literal or a state key.
 * @typedef {{ kind: "literal", value: number } | { kind: "key", value: string }} NumArg
 */

/**
 * @param {string} tok
 * @param {Ctx} ctx
 * @returns {NumArg}
 */
function parseNumArg(tok, ctx) {
  if (/^\d+$/.test(tok)) return { kind: "literal", value: Number(tok) };
  if (/^[A-Za-z_$][\w$]*$/.test(tok)) {
    const key = resolveStateKey(tok, ctx);
    if (!key) throw new Error(`@loop offset/limit "${tok}" in ${ctx.file} is neither a non-negative integer nor a declared :state. ${LOOP_USAGE}`);
    return { kind: "key", value: key };
  }
  throw new Error(`@loop offset/limit "${tok}" in ${ctx.file} is invalid. ${LOOP_USAGE}`);
}

/** @param {NumArg} arg @returns {string} */
function numArgAttr(arg) {
  return arg.kind === "literal" ? String(arg.value) : `key:${arg.value}`;
}

/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {string[] | null} emptyLines
 * @param {Ctx} ctx
 * @returns {string}
 */
function handleLoop(line, bodyLines, emptyLines, ctx) {
  const match = line.match(/^@loop\s+(.+?)\s+into\s+([A-Za-z_$][\w$]*)(\s+.+?)?\s*$/);
  if (!match) throw new Error(`Malformed @loop in ${ctx.file}: ${line}. ${LOOP_USAGE}`);
  const source = stripQuotes(match[1].trim());
  const itemName = match[2];
  const clauses = match[3] ? parseLoopClauses(match[3], itemName, ctx) : { where: null, sort: null, reverse: false, offset: null, limit: null, refsState: false };
  const where = clauses.where ? compilePredicate(clauses.where, itemName, ctx) : null;
  /** @type {LoopOpts} */
  const opts = { where, sort: clauses.sort, reverse: clauses.reverse, offset: clauses.offset, limit: clauses.limit, empty: emptyLines, clauseRefsState: clauses.refsState };

  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source.endsWith(".json")) {
    const dataFile = resolveInclude(source, ctx.file, ctx.context, true);
    const rows = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(rows)) throw new Error(`@loop data must be a JSON array: ${dataFile}`);
    return loopOverData(rows, itemName, bodyLines, ctx, opts);
  }

  const resolved = lookupPath(source, ctx);
  if (resolved.found) {
    if (!Array.isArray(resolved.value)) {
      throw new Error(`@loop ${source} in ${ctx.file} found an in-scope value, but it is not a list`);
    }
    return loopOverData(resolved.value, itemName, bodyLines, ctx, opts);
  }

  // A bare name OR a dotted path resolving to declared :state (e.g. team.members).
  const segs = source.split(".");
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(source)) {
    if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
      throw new Error(`@loop source "${source}" is not allowed in ${ctx.file}`);
    }
    const key = resolveStateKey(segs[0], ctx);
    if (key) {
      const fullKey = segs.length > 1 ? `${key}.${segs.slice(1).join(".")}` : key;
      return reactiveLoop(fullKey, itemName, bodyLines, ctx, opts);
    }
  }

  throw new Error(
    `@loop source "${source}" in ${ctx.file} was not found. Loop over a JSON file (@loop /data.json into row), an in-scope value, or a :state list.`
  );
}

// A static source (JSON file / in-scope value). No `where`, or a `where` that
// only reads the loop item → filter at build time and stay zero-JS. A `where`
// that reads :state → becomes a reactive filtered loop with the rows baked in.
/**
 * A compiled `@loop … where` predicate.
 * @typedef {object} Predicate
 * @property {string} body Safe JS boolean expression over `I()`/`S()`/`C()`.
 * @property {boolean} refsState Whether the predicate reads declared state.
 */

/**
 * Loop clause configuration shared by the static and reactive paths.
 * @typedef {object} LoopOpts
 * @property {Predicate | null} where
 * @property {{ key: string, dir: string } | null} sort
 * @property {boolean} reverse
 * @property {NumArg | null} offset
 * @property {NumArg | null} limit
 * @property {string[] | null} empty Empty-branch body lines, if any.
 * @property {boolean} clauseRefsState Whether offset/limit reference state.
 */

/**
 * Build-time pipeline over already-resolved rows: filter → sort → reverse →
 * offset → limit. Used when source + every clause arg are static.
 * @param {unknown[]} rows
 * @param {Predicate | null} where
 * @param {LoopOpts} opts
 * @param {Ctx} ctx
 * @returns {unknown[]}
 */
function pipelineRows(rows, where, opts, ctx) {
  let list = where ? rows.filter((row) => evalPredicate(where.body, row, ctx)) : rows.slice();
  if (opts.sort) {
    const k = opts.sort.key;
    const dir = opts.sort.dir === "desc" ? -1 : 1;
    list = list.map((value, index) => ({ value, index })).sort((a, b) => {
      const av = getPath(a.value, k ? k.split(".") : []);
      const bv = getPath(b.value, k ? k.split(".") : []);
      let c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return (c || a.index - b.index) * dir;
    }).map((w) => w.value);
  }
  if (opts.reverse) list.reverse();
  const off = opts.offset && opts.offset.kind === "literal" ? opts.offset.value : 0;
  if (off) list = list.slice(off);
  if (opts.limit && opts.limit.kind === "literal") list = list.slice(0, opts.limit.value);
  return list;
}

/**
 * @param {unknown[]} rows
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {LoopOpts} opts
 * @returns {string}
 */
function loopOverData(rows, itemName, bodyLines, ctx, opts) {
  // Reactive when the where reads state OR an offset/limit references a state key.
  const reactive = (opts.where && opts.where.refsState) || opts.clauseRefsState;
  if (reactive) return reactiveLoop(null, itemName, bodyLines, ctx, { ...opts, data: rows });
  return staticUnroll(pipelineRows(rows, opts.where, opts, ctx), itemName, bodyLines, ctx, opts.empty);
}

// Compile a `where` predicate to a safe JS boolean expression over I()/S()/C().
// Conditions (operand <op> operand) join with `and`/`or`; operands are loop-item
// paths, declared :state, numbers, or strings. No identifiers survive un-mapped.
/**
 * @param {string} raw
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {Predicate}
 */
function compilePredicate(raw, itemName, ctx) {
  const parts = raw.split(/\s+(and|or)\s+/i);
  /** @type {string[]} */
  const pieces = [];
  let refsState = false;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { pieces.push(parts[i].toLowerCase() === "and" ? "&&" : "||"); continue; }
    const cond = compileCondition(parts[i].trim(), itemName, ctx);
    refsState = refsState || cond.usesState;
    pieces.push(`(${cond.expr})`);
  }
  return { body: pieces.join(" "), refsState };
}

/**
 * @param {string} cond
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ expr: string, usesState: boolean }}
 */
function compileCondition(cond, itemName, ctx) {
  const m = cond.match(/^(.+?)\s+(contains|==|!=|>=|<=|>|<)\s+(.+)$/i);
  if (!m) throw new Error(`Malformed where-condition "${cond}" in ${ctx.file}. Use: ${itemName}.field contains state, or ${itemName}.field <op> value.`);
  const left = compileOperand(m[1].trim(), itemName, ctx);
  const right = compileOperand(m[3].trim(), itemName, ctx);
  const usesState = left.usesState || right.usesState;
  const op = m[2].toLowerCase();
  if (op === "contains") return { expr: `C(${left.code}, ${right.code})`, usesState };
  return { expr: `${left.code} ${op} ${right.code}`, usesState };
}

/**
 * @param {string} tok
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {{ code: string, usesState: boolean }}
 */
function compileOperand(tok, itemName, ctx) {
  if (/^"[^"]*"$/.test(tok) || /^'[^']*'$/.test(tok)) return { code: JSON.stringify(tok.slice(1, -1)), usesState: false };
  if (/^-?\d+(?:\.\d+)?$/.test(tok)) return { code: tok, usesState: false };
  if (["true", "false", "null"].includes(tok)) return { code: tok, usesState: false };
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tok)) {
    throw new Error(`Unsupported operand "${tok}" in @loop where (${ctx.file}). Use ${itemName}.field, a :state name, a number, or a "string".`);
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw new Error(`Path "${tok}" is not allowed in @loop where (${ctx.file})`);
  }
  if (segs[0] === itemName) return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, usesState: false };
  const key = resolveStateKey(segs[0], ctx);
  if (!key) {
    throw new Error(`@loop where references unknown name "${segs[0]}" in ${ctx.file}. Use the loop item (${itemName}.field) or a declared :state.`);
  }
  const rest = segs.slice(1).join(".");
  return { code: `S(${JSON.stringify(key)}${rest ? `, ${JSON.stringify(rest)}` : ""})`, usesState: true };
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
const containsHelper = (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase());

/**
 * Evaluate a compiled predicate against a row at build time.
 * @param {string} body
 * @param {unknown} item
 * @param {Ctx} ctx
 * @returns {boolean}
 */
function evalPredicate(body, item, ctx) {
  try {
    /** @param {string} [p] */
    const I = (p) => getPath(item, p ? p.split(".") : []);
    /** @param {string} k @param {string} [r] */
    const S = (k, r) => getPath(ctx.comp.state.get(k), r ? r.split(".") : []);
    return Boolean(new Function("I", "S", "C", `return (${body});`)(I, S, containsHelper));
  } catch {
    console.warn(`@loop where predicate "${body}" in ${ctx.file} could not be evaluated at build time; treating the row as excluded. Check the condition.`);
    return false;
  }
}

/**
 * Compile one operand of a `::: … .class when <predicate>` expression. Like the
 * `@loop where` operand, but also folds a static-scope value (a loop-unrolled
 * item field or include arg) to its build-time literal, so a fully-static
 * predicate can be evaluated at compile time. Mirrors `:if`'s scope→item→state
 * resolution order.
 * @param {string} tok
 * @param {Ctx} ctx
 * @param {string} what Directive label for error messages.
 * @returns {{ code: string, state: boolean, item: boolean }}
 */
function compileWhenOperand(tok, ctx, what) {
  if (/^"[^"]*"$/.test(tok) || /^'[^']*'$/.test(tok)) return { code: JSON.stringify(tok.slice(1, -1)), state: false, item: false };
  if (/^-?\d+(?:\.\d+)?$/.test(tok)) return { code: tok, state: false, item: false };
  if (["true", "false", "null"].includes(tok)) return { code: tok, state: false, item: false };
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(tok)) {
    throw new Error(`Unsupported operand "${tok}" in ${what} (${ctx.file}). Use item.field, a :state name, a number, or a "string".`);
  }
  const segs = tok.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw new Error(`Path "${tok}" is not allowed in ${what} (${ctx.file})`);
  }
  const scoped = lookupVar(ctx.scope, segs[0]);
  if (scoped.found) return { code: JSON.stringify(getPath(scoped.value, segs.slice(1)) ?? null), state: false, item: false };
  if (ctx.loopItem && segs[0] === ctx.loopItem) return { code: `I(${JSON.stringify(segs.slice(1).join("."))})`, state: false, item: true };
  const key = resolveStateKey(segs[0], ctx);
  if (!key) throw new Error(`${what} references unknown name "${segs[0]}" in ${ctx.file}. Use a loop item field, a declared :state, a number, or a "string".`);
  const rest = segs.slice(1).join(".");
  return { code: `S(${JSON.stringify(key)}${rest ? `, ${JSON.stringify(rest)}` : ""})`, state: true, item: false };
}

/**
 * Compile a `::: … .class when <predicate>`. Allows `:if`-style bare truthy
 * paths and `where`-style `left <op> right` conditions joined by `and`/`or`.
 * Folds to a static verdict when every operand is build-known, else returns a
 * runtime body over I()/S()/C() plus whether it reads the reactive loop item
 * (which decides data-wd-each-class vs the global data-wd-class).
 * @param {string} raw
 * @param {Ctx} ctx
 * @param {string} [what] Directive label for error messages.
 * @returns {{ static: true, value: boolean } | { static: false, body: string, item: boolean }}
 */
function compileWhen(raw, ctx, what = '"::: … when"') {
  const parts = raw.split(/\s+(and|or)\s+/i);
  /** @type {string[]} */
  const pieces = [];
  let usesState = false;
  let usesItem = false;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { pieces.push(parts[i].toLowerCase() === "and" ? "&&" : "||"); continue; }
    let seg = parts[i].trim();
    // Optional leading `not` negates the whole sub-condition.
    let negate = false;
    if (/^not\s+/i.test(seg)) { negate = true; seg = seg.replace(/^not\s+/i, "").trim(); }
    const opMatch = seg.match(/^(.+?)\s+(contains|==|!=|>=|<=|>|<)\s+(.+)$/i);
    let expr;
    if (opMatch) {
      const left = compileWhenOperand(opMatch[1].trim(), ctx, what);
      const right = compileWhenOperand(opMatch[3].trim(), ctx, what);
      usesState = usesState || left.state || right.state;
      usesItem = usesItem || left.item || right.item;
      const op = opMatch[2].toLowerCase();
      expr = op === "contains" ? `C(${left.code}, ${right.code})` : `${left.code} ${op} ${right.code}`;
    } else {
      const only = compileWhenOperand(seg, ctx, what);
      usesState = usesState || only.state;
      usesItem = usesItem || only.item;
      expr = only.code;
    }
    pieces.push(negate ? `(!(${expr}))` : `(${expr})`);
  }
  const body = pieces.join(" ");
  if (!usesState && !usesItem) return { static: true, value: evalPredicate(body, undefined, ctx) };
  return { static: false, body, item: usesItem };
}

/**
 * @param {unknown[]} rows
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {string[] | null} [empty] Empty-branch body, rendered when 0 rows.
 * @returns {string}
 */
function staticUnroll(rows, itemName, bodyLines, ctx, empty = null) {
  if (rows.length === 0 && empty) return compileBody(empty, { ...ctx, loopMeta: true });
  const out = [];
  const count = rows.length;
  for (let i = 0; i < count; i++) {
    const meta = { $index: i, $number: i + 1, $first: i === 0, $last: i === count - 1, $count: count };
    const rowCtx = { ...ctx, loopMeta: true, scope: createScope(ctx.scope, { [itemName]: rows[i], ...meta }) };
    out.push(compileBody(bodyLines, rowCtx));
  }
  return out.join("\n");
}

/**
 * Emit a reactive loop region (template + initial rows + clause config) for the
 * runtime. `key` may be a dotted path (e.g. `team.members`); the runtime reads
 * it via getPath. `opts` carries where/sort/reverse/offset/limit/empty.
 * @param {string | null} key State key/path of the list, or null for baked data.
 * @param {string} itemName
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {Partial<LoopOpts> & { data?: unknown[] } | null} [opts]
 * @returns {string}
 */
function reactiveLoop(key, itemName, bodyLines, ctx, opts = null) {
  ctx.comp.assets.runtime = true;
  /** @type {Ctx} */
  const templateCtx = { ...ctx, loopItem: itemName, loopKey: key ?? undefined, loopMeta: true, scope: createScope(ctx.scope) };
  const templateHtml = compileBody(bodyLines, templateCtx).trim();

  let wrapperTag = "div";
  let itemTemplate = templateHtml;
  const listMatch = templateHtml.match(/^<(ul|ol)>\s*([\s\S]*?)\s*<\/\1>$/);
  if (listMatch && (listMatch[2].match(/<li>/g) || []).length === 1) {
    wrapperTag = listMatch[1];
    itemTemplate = listMatch[2].trim();
  } else {
    itemTemplate = `<div data-wd-loop-piece>${templateHtml}</div>`;
  }

  const where = opts?.where || null;
  const sort = opts?.sort || null;
  const reverse = opts?.reverse || false;
  const offset = opts?.offset || null;
  const limit = opts?.limit || null;
  const emptyLines = opts?.empty || null;
  const baked = opts?.data || null;       // rows for a static source filtered by state
  // Resolve the (possibly dotted) source for the initial paint.
  const segs = key ? key.split(".") : [];
  const stateRows = key ? getPath(ctx.comp.state.get(segs[0]), segs.slice(1)) : null;
  /** @type {unknown[]} */
  const allRows = key ? (Array.isArray(stateRows) ? stateRows : []) : (baked || []);
  // Initial paint runs the same pipeline the runtime will, reading state-key
  // offset/limit from their current declared values.
  /** @param {NumArg|null} a */
  const num = (a) => a ? (a.kind === "literal" ? a.value : Number(ctx.comp.state.get(a.value) ?? 0)) : null;
  const rows = pipelineRows(allRows, where, { where, sort, reverse, offset: offset && offset.kind === "key" ? { kind: "literal", value: num(offset) || 0 } : offset, limit: limit && limit.kind === "key" ? { kind: "literal", value: num(limit) ?? allRows.length } : limit, empty: null, clauseRefsState: false }, ctx);
  /** @type {Map<string, number>} */
  const counts = new Map();
  const count = rows.length;
  const initial = rows
    .map((/** @type {unknown} */ item, i) => {
      const itemKey = loopKeyOf(item, counts);
      const meta = { index: i, number: i + 1, first: i === 0, last: i === count - 1, count };
      return fillTemplateString(withLoopKey(itemTemplate, itemKey), item, meta);
    })
    .join("");

  const emptyTemplate = emptyLines ? `<template data-wd-loop-empty>${compileBody(emptyLines, { ...ctx, loopMeta: true }).trim()}</template>` : "";
  const initialOut = count === 0 && emptyLines ? compileBody(emptyLines, { ...ctx, loopMeta: true }).trim() : initial;

  const attrs =
    (where ? ` data-wd-loop-where="${escapeHtml(where.body)}"` : "") +
    (sort ? ` data-wd-loop-sort="${escapeHtml(sort.key)}" data-wd-loop-sort-dir="${sort.dir}"` : "") +
    (reverse ? ` data-wd-loop-reverse` : "") +
    (offset ? ` data-wd-loop-offset="${numArgAttr(offset)}"` : "") +
    (limit ? ` data-wd-loop-limit="${numArgAttr(limit)}"` : "") +
    (baked ? ` data-wd-loop-data="${escapeHtml(JSON.stringify(baked))}"` : "");
  return `<div data-wd-loop="${escapeHtml(key || "")}"${attrs}><template data-wd-loop-template>${itemTemplate}</template>${emptyTemplate}<${wrapperTag} data-wd-loop-out>${initialOut}</${wrapperTag}></div>`;
}

/**
 * @param {string} template
 * @param {string} itemKey
 * @returns {string}
 */
function withLoopKey(template, itemKey) {
  return template.replace(/^<([a-zA-Z][a-zA-Z0-9-]*)/, `<$1 data-wd-loop-key="${escapeHtml(itemKey)}"`);
}

/**
 * @param {string} template
 * @param {unknown} item
 * @param {Record<string, unknown>} [meta] Per-row meta values for the initial paint.
 * @returns {string}
 */
function fillTemplateString(template, item, meta = {}) {
  // Resolve per-item :if regions first (recursively, so nested conditionals are
  // pre-rendered for the initial paint), then fill text binds and meta markers.
  return fillEachMeta(fillEachText(fillEachIfRegions(template, item, meta), item), meta);
}

/**
 * Fill `<span data-wd-each-meta="…">` markers with their per-row value.
 * @param {string} str
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function fillEachMeta(str, meta) {
  return str.replace(/<span data-wd-each-meta="([a-z]+)"><\/span>/g, (_, name) => {
    const value = name in meta ? meta[name] : "";
    return `<span data-wd-each-meta="${name}">${escapeHtml(value ?? "")}</span>`;
  });
}

// Walk the string resolving only the OUTERMOST data-wd-each-if regions; each
// chosen branch is recursed so nested conditionals resolve too. The <template>
// markup is left pristine so the runtime can keep toggling branches.
/**
 * @param {string} str
 * @param {unknown} item
 * @param {Record<string, unknown>} [meta]
 * @returns {string}
 */
function fillEachIfRegions(str, item, meta = {}) {
  const marker = '<span data-wd-each-if ';
  let result = "";
  let i = 0;
  for (;;) {
    const start = str.indexOf(marker, i);
    if (start === -1) return result + str.slice(i);
    result += str.slice(i, start);
    const end = matchElement(str, start, "span");
    result += fillOneEachIf(str.slice(start, end), item, meta);
    i = end;
  }
}

/**
 * @param {string} region
 * @param {unknown} item
 * @param {Record<string, unknown>} meta
 * @returns {string}
 */
function fillOneEachIf(region, item, meta) {
  const metaMatch = region.match(/^<span data-wd-each-if data-wd-meta="([a-z]+)">/);
  const path = (region.match(/^<span data-wd-each-if data-wd-path="([^"]*)">/) || ["", ""])[1];
  const trueStart = region.indexOf("<template data-wd-if-true>");
  const trueEnd = matchElement(region, trueStart, "template");
  const falseStart = region.indexOf("<template data-wd-if-false>", trueEnd);
  const falseEnd = matchElement(region, falseStart, "template");
  const open = "<template data-wd-if-true>".length;
  const close = "</template>".length;
  const truthy = region.slice(trueStart + open, trueEnd - close);
  const falsy = region.slice(falseStart + "<template data-wd-if-false>".length, falseEnd - close);
  const test = metaMatch ? Boolean(meta[metaMatch[1]]) : Boolean(getPath(item, path ? path.split(".") : []));
  const branch = test ? truthy : falsy;
  const head = region.slice(0, falseEnd);
  return `${head}<span data-wd-each-if-out>${fillEachIfRegions(branch, item, meta)}</span></span>`;
}

/**
 * @param {string} str
 * @param {unknown} item
 * @returns {string}
 */
function fillEachText(str, item) {
  return str.replace(/<span data-wd-each(?: data-wd-path="([^"]*)")?><\/span>/g, (_, p) => {
    const value = p ? getPath(item, p.split(".")) : item;
    const pathAttr = p ? ` data-wd-path="${p}"` : "";
    return `<span data-wd-each${pathAttr}>${escapeHtml(value ?? "")}</span>`;
  });
}

// Return the index just past the balanced close of the element of `tag` that
// begins at `start`. Counts nested same-tag opens/closes so regions that embed
// their own spans/templates (nested :if) match correctly.
/**
 * @param {string} str
 * @param {number} start
 * @param {string} tag
 * @returns {number}
 */
function matchElement(str, start, tag) {
  const openPrefix = `<${tag}`;
  const closeTag = `</${tag}>`;
  let depth = 0;
  let i = start;
  while (i < str.length) {
    if (str.startsWith(openPrefix, i) && (str[i + openPrefix.length] === " " || str[i + openPrefix.length] === ">")) {
      depth++;
      const gt = str.indexOf(">", i);
      i = gt === -1 ? str.length : gt + 1;
    } else if (str.startsWith(closeTag, i)) {
      depth--;
      i += closeTag.length;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return str.length;
}

/**
 * Stable per-render key for a loop row, disambiguating duplicates with `#n`.
 * @param {unknown} item
 * @param {Map<string, number>} counts Mutable seen-count accumulator.
 * @returns {string}
 */
export function loopKeyOf(item, counts) {
  const base =
    item && typeof item === "object"
      ? String(/** @type {Record<string, unknown>} */ (item).id ?? /** @type {Record<string, unknown>} */ (item).key ?? JSON.stringify(item))
      : String(item);
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}

/**
 * Render the documentation-demo directives (`:try`, `:note`, `:sprint`).
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
function renderDemoDirective(line, ctx) {
  const tryMatch = line.match(/^:try\s+"([^"]+)"\s+href="([^"]+)"$/);
  if (tryMatch) {
    const href = validateDemoHref(tryMatch[2], ctx);
    return `<a class="try-card" href="${escapeHtml(href)}"><span>Try</span>${escapeHtml(tryMatch[1])}</a>`;
  }
  const note = line.match(/^:note\s+"([^"]+)"$/);
  if (note) return `<aside class="note">${escapeHtml(note[1])}</aside>`;
  const sprint = line.match(/^:sprint\s+min=(\d+)\s+max=(\d+)\s+roles="([^"]+)"$/);
  if (sprint) {
    const roles = sprint[3].split(",").map((role) => role.trim()).filter(Boolean);
    return `<section class="sprint-board" data-min="${sprint[1]}" data-max="${sprint[2]}">${roles.map((role) => `<article><strong>${escapeHtml(role)}</strong><span>active lane</span></article>`).join("")}</section>`;
  }
  return "";
}

/**
 * Validate demo-card links without adding arbitrary URL passthrough.
 * @param {string} href
 * @param {Ctx} ctx
 * @returns {string}
 */
function validateDemoHref(href, ctx) {
  const value = href.trim();
  if (value !== href || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`);
  }
  if (value.startsWith("//")) {
    throw new Error(`Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Protocol-relative URLs are not allowed; use http: or https: explicitly.`);
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("#")) {
    return value;
  }
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme && ["http", "https", "mailto"].includes(scheme[1].toLowerCase())) {
    return value;
  }
  throw new Error(`Unsafe :try href "${escapeHtml(href)}" in ${ctx.file}. Use a relative URL starting with /, ./, ../, or #, or an http:, https:, or mailto: URL.`);
}

// ---------------------------------------------------------------------------
// Interpolation: one syntax, { name } / { name.path }
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @param {Ctx} ctx
 * @returns {string}
 */
function renderProse(text, ctx) {
  text = resolveDestinationBindings(text, ctx);
  return (ctx.md ?? md).render(text, { resolveBinding: (/** @type {string} */ expr) => resolveBindingHtml(expr, ctx) });
}

/**
 * Pre-resolve `{ expr }` interpolations sitting in a markdown link/image
 * destination — the `](…)` slot — so a build-time `@loop` (or any static scope)
 * can drive an href/src. A markdown destination cannot contain the spaces inside
 * `{ … }`, so markdown-it would otherwise never form the link; substituting the
 * static value here lets the normal link/image parser run. Only build-time
 * (static-scope) values are substituted — reactive `:state`/reactive-loop
 * bindings resolve to `null` and are left untouched (they cannot live in a
 * destination). Issue #19.
 * @param {string} text
 * @param {Ctx} ctx
 * @returns {string}
 */
function resolveDestinationBindings(text, ctx) {
  return text.replace(
    /(\]\(\s*)\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g,
    (whole, prefix, expr) => {
      const raw = resolveBindingRaw(expr, ctx);
      return raw == null ? whole : prefix + raw;
    }
  );
}

/**
 * Resolve `{ expr }` to its raw static value (a plain string) for use in a
 * destination, or `null` when the binding is reactive or not in build-time
 * scope. Mirrors the static branch of {@link resolveBindingHtml} but returns the
 * unescaped value (markdown-it normalizes the URL).
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function resolveBindingRaw(expr, ctx) {
  const segs = expr.split(".");
  const found = lookupVar(ctx.scope, segs[0]);
  if (!found.found) return null;
  const resolved = getPath(found.value, segs.slice(1));
  const leaf = interpolateLeaf(resolved, expr, ctx);
  return leaf == null ? null : String(leaf);
}

/**
 * markdown-it plugin: turns `{ name.path }` into an inline `html_inline` token
 * whose content comes from the env's `resolveBinding` callback.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function bindingPlugin(mdInstance) {
  mdInstance.inline.ruler.push("wd_binding", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x7b /* { */) return false;
    const match = /^\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/.exec(state.src.slice(state.pos));
    if (!match) return false;
    const resolve = state.env?.resolveBinding;
    const html = resolve ? resolve(match[1]) : null;
    if (typeof html !== "string") return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = html;
    }
    state.pos += match[0].length;
    return true;
  });
}

/**
 * markdown-it plugin (core rule): a `{.class .class #id}` block immediately
 * following an inline element (link, image, em/strong, code) attaches those
 * classes / id to that element. Lets a link be styled as a button without a
 * wrapper container. The block must directly follow the element (no space), and
 * `{ … }` interpolation is unaffected (its content starts with a name, not `.`/`#`).
 * Issue #18.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function attrsPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_attrs", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const children = block.children;
      for (let i = 0; i < children.length; i++) {
        const tok = children[i];
        if (tok.type !== "text") continue;
        const m = /^\{([.#][^}]*)\}/.exec(tok.content);
        if (!m) continue;
        const target = attrTarget(children, i);
        if (!target) continue;
        for (const part of m[1].split(/\s+/).filter(Boolean)) {
          if (part[0] === ".") target.attrJoin("class", part.slice(1));
          else if (part[0] === "#") target.attrSet("id", part.slice(1));
        }
        tok.content = tok.content.slice(m[0].length);
      }
    }
    return false;
  });
}

/**
 * The inline token an attr block attaches to: the immediately-preceding image
 * (self-closing) or the open token matching the immediately-preceding close
 * (link/em/strong/…). Returns null when nothing valid precedes.
 * @param {any[]} children markdown-it inline child tokens
 * @param {number} i Index of the attr-block text token.
 * @returns {any} the matching markdown-it Token, or null
 */
function attrTarget(children, i) {
  const prev = children[i - 1];
  if (!prev) return null;
  if (prev.type === "image") return prev;
  if (prev.nesting === -1) {
    const openType = prev.type.replace(/_close$/, "_open");
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const t = children[j];
      if (t.type === prev.type) depth++;
      else if (t.type === openType) { depth--; if (depth === 0) return t; }
    }
  }
  return null;
}

/**
 * Resolve a `{ name.path }` binding to HTML: loop item span, static value, or
 * a reactive bind span. Returns null when nothing in scope matches.
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function resolveBindingHtml(expr, ctx) {
  const segs = expr.split(".");
  const head = segs[0];

  // Per-row meta vars ($index/$number/$first/$last/$count) — only inside a loop.
  if (LOOP_META[head]) {
    if (!ctx.loopMeta) throw new Error(`"{ ${expr} }" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Move it into a loop body, or rename your value.`);
    if (ctx.loopItem) return `<span data-wd-each-meta="${LOOP_META[head]}"></span>`; // reactive: filled per row
    // static: the value is in scope (injected by staticUnroll); fall through.
  }

  if (ctx.loopItem && head === ctx.loopItem) {
    const rest = segs.slice(1).join(".");
    return `<span data-wd-each${rest ? ` data-wd-path="${escapeHtml(rest)}"` : ""}></span>`;
  }

  const staticValue = lookupVar(ctx.scope, head);
  if (staticValue.found) {
    const resolved = getPath(staticValue.value, segs.slice(1));
    return escapeHtml(interpolateLeaf(resolved, expr, ctx));
  }

  const key = resolveStateKey(head, ctx);
  if (key) {
    ctx.comp.assets.runtime = true;
    const initial = getPath(ctx.comp.state.get(key), segs.slice(1));
    const rest = segs.slice(1).join(".");
    const pathAttr = rest ? ` data-wd-path="${escapeHtml(rest)}"` : "";
    return `<span data-wd-bind="${key}"${pathAttr}>${escapeHtml(interpolateLeaf(initial, expr, ctx))}</span>`;
  }

  return null;
}

/**
 * Render an interpolated value as text. Arrays join with ", " (matching the
 * documented `{ meta.tags }` behavior); a bare object is a mistake — fail
 * loudly with a fix rather than emitting "[object Object]".
 * @param {unknown} value
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string}
 */
function interpolateLeaf(value, expr, ctx) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    throw new Error(`Cannot interpolate the object value "{ ${expr} }" in ${ctx.file}. Interpolate a field instead — e.g. { ${expr}.title } — or iterate it with @loop ${expr} into item.`);
  }
  return String(value);
}

/**
 * Walk the scope chain for a top-level variable.
 * @param {Scope} scope
 * @param {string} name
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
function lookupVar(scope, name) {
  /** @type {Scope | null} */
  let current = scope;
  for (; current; current = current.parent) {
    if (name in current.vars) return { found: true, value: current.vars[name] };
  }
  return { found: false };
}

/**
 * Resolve a dotted path against the static scope chain.
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
function lookupPath(expr, ctx) {
  const segs = expr.split(".");
  const head = lookupVar(ctx.scope, segs[0]);
  if (!head.found) return { found: false };
  return { found: true, value: getPath(head.value, segs.slice(1)) };
}

/**
 * Safely read a dotted path off a value, rejecting prototype-pollution segments.
 * @param {unknown} value
 * @param {string[]} segments
 * @returns {unknown}
 */
function getPath(value, segments) {
  /** @type {any} */
  let current = value;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (["constructor", "prototype", "__proto__"].includes(segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Validate a dotted path shape, rejecting prototype-pollution segments at every
 * level. Shared by actions/loops/fetch. Throws with a corrective `Use:` hint.
 * @param {string} path Dotted path, e.g. `cart.items`.
 * @param {Ctx} ctx
 * @param {string} use Corrective suggestion for the error message.
 * @returns {string[]} The validated segments.
 */
function validatePath(path, ctx, use) {
  const segs = path.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw new Error(`Path segment in "${path}" is not allowed in ${ctx.file}. Use: ${use}`);
  }
  return segs;
}

/**
 * Resolve a bare state name to its fully-qualified key, walking section scopes.
 * @param {string} name
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function resolveStateKey(name, ctx) {
  for (let i = ctx.sections.length - 1; i >= 0; i--) {
    const key = `${ctx.sections[i]}:${name}`;
    if (ctx.comp.state.has(key)) return key;
  }
  return ctx.comp.state.has(name) ? name : null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * A parsed `:button` action.
 * @typedef {object} Action
 * @property {string} op Runtime operation (inc/dec/add/sub/append/prepend/set/toggle/member-toggle/remove/remove-value/clear/merge/delete/reset/append-row).
 * @property {string} target State key (possibly dotted) the action mutates.
 * @property {unknown} [value] Literal value for value-carrying ops.
 */

const ACTION_USE =
  'Use: name++, name--, n += k, n -= k, name = v, flag toggle, list append/prepend v, list toggle v, list remove v, x clear, obj merge other, obj delete key, name reset — chain with ";".';

/**
 * Parse a `:button` action expression into a validated `{ op, target, value }`,
 * or — when `;`-separated — an ordered array of them applied in sequence.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {Action | Action[]}
 */
function parseAction(raw, ctx) {
  const parts = raw.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts.map((part) => parseSingleAction(part, raw, ctx));
  return parseSingleAction(raw.trim(), raw, ctx);
}

/**
 * Parse one (non-`;`) action expression into a validated `{ op, target, value }`.
 * Targets may be dotted paths (`cart.count`); a bare name is a 1-segment path.
 * @param {string} expression
 * @param {string} raw The full original action source (for error context).
 * @param {Ctx} ctx
 * @returns {Action}
 */
function parseSingleAction(expression, raw, ctx) {
  const PATH = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";
  /** @param {string} name @returns {string} */
  const resolveTarget = (name) => {
    const segs = validatePath(name, ctx, ACTION_USE);
    const key = resolveStateKey(segs[0], ctx);
    if (!key) {
      throw new Error(`Button action targets unknown state "${segs[0]}" in ${ctx.file}. Declare it first with :state ${segs[0]} = ...`);
    }
    return [key, ...segs.slice(1)].join(".");
  };

  const increment = expression.match(new RegExp(`^(${PATH})\\+\\+$`));
  if (increment) return { op: "inc", target: resolveTarget(increment[1]) };
  const decrement = expression.match(new RegExp(`^(${PATH})--$`));
  if (decrement) return { op: "dec", target: resolveTarget(decrement[1]) };
  const sub = expression.match(new RegExp(`^(${PATH})\\s*-=\\s*(.+)$`));
  if (sub) return { op: "sub", target: resolveTarget(sub[1]), value: parseActionLiteral(sub[2]) };
  // Per-row: carry the current loop item into another list — `cart += product`.
  // Only inside a reactive @loop; the runtime resolves the row from the DOM.
  const add = expression.match(new RegExp(`^(${PATH})\\s*\\+=\\s*(.+)$`));
  if (add) {
    const rhs = add[2].trim();
    if (ctx.loopItem && rhs === ctx.loopItem) {
      const target = resolveTarget(add[1]);
      if (!Array.isArray(ctx.comp.state.get(target))) {
        throw new Error(`Button action "${raw}" needs ${add[1]} to be a :state list (declare it "${add[1]} = []") in ${ctx.file}.`);
      }
      return { op: "append-row", target };
    }
    const target = resolveTarget(add[1]);
    const value = parseActionLiteral(rhs);
    if (Array.isArray(ctx.comp.state.get(target))) return { op: "append", target, value };
    if (typeof value === "number") return { op: "add", target, value };
    throw new Error(`Unsupported button action "${raw}" in ${ctx.file}. += with non-number values requires a list state target — declare it "${add[1]} = []".`);
  }
  // `flag toggle` (no operand) → boolean flip; `list toggle v` → member-toggle.
  const toggle = expression.match(new RegExp(`^(${PATH})\\s+toggle(?:\\s+(.+))?$`));
  if (toggle) {
    const target = resolveTarget(toggle[1]);
    if (toggle[2] === undefined) return { op: "toggle", target };
    return { op: "member-toggle", target, value: parseActionLiteral(toggle[2]) };
  }
  const prepend = expression.match(new RegExp(`^(${PATH})\\s+(?:append|prepend)\\s+(.+)$`));
  if (prepend) {
    const op = expression.includes(" prepend ") ? "prepend" : "append";
    return { op, target: resolveTarget(prepend[1]), value: parseActionLiteral(prepend[2]) };
  }
  // Per-row: remove the current row from the list being looped — `todos remove todo`.
  // Disambiguation: operand IS the loop item name → `remove` (current row);
  // otherwise the operand is a value → `remove-value`.
  const remove = expression.match(new RegExp(`^(${PATH})\\s+remove\\s+(.+)$`));
  if (remove) {
    const operand = remove[2].trim();
    if (ctx.loopItem && operand === ctx.loopItem) {
      if (!ctx.loopKey || resolveStateKey(remove[1], ctx) !== ctx.loopKey) {
        throw new Error(`Button action "${raw}" must target the :state list being looped (@loop ${remove[1]} into ${ctx.loopItem}) in ${ctx.file}.`);
      }
      return { op: "remove", target: ctx.loopKey };
    }
    return { op: "remove-value", target: resolveTarget(remove[1]), value: parseActionLiteral(operand) };
  }
  const clear = expression.match(new RegExp(`^(${PATH})\\s+clear$`));
  if (clear) return { op: "clear", target: resolveTarget(clear[1]) };
  const merge = expression.match(new RegExp(`^(${PATH})\\s+merge\\s+(.+)$`));
  if (merge) return { op: "merge", target: resolveTarget(merge[1]), value: parseMergeOperand(merge[2], ctx) };
  const del = expression.match(new RegExp(`^(${PATH})\\s+delete\\s+(.+)$`));
  if (del) return { op: "delete", target: resolveTarget(del[1]), value: parseActionLiteral(del[2]) };
  const reset = expression.match(new RegExp(`^(${PATH})\\s+reset$`));
  if (reset) return { op: "reset", target: resolveTarget(reset[1]) };
  // `name refetch` re-invokes the matching :fetch node. The target is the fetch
  // key (bare name); the runtime finds the [data-wd-fetch-key] node and re-runs.
  const refetch = expression.match(new RegExp(`^(${PATH})\\s+refetch$`));
  if (refetch) return { op: "refetch", target: resolveTarget(refetch[1]) };
  const assign = expression.match(new RegExp(`^(${PATH})\\s*=\\s*(.+)$`));
  if (assign) return { op: "set", target: resolveTarget(assign[1]), value: parseActionLiteral(assign[2]) };
  throw new Error(`Unsupported button action "${raw}" in ${ctx.file}. ${ACTION_USE}`);
}

/**
 * `merge` operand: either an inline JSON object literal, or a state/store key
 * name (emitted as a string the runtime resolves via getPath).
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {unknown}
 */
function parseMergeOperand(raw, ctx) {
  const value = raw.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(value)) {
    const key = resolveStateKey(value, ctx);
    if (!key) throw new Error(`Button action merge targets unknown state "${value}" in ${ctx.file}. Declare it first with :state ${value} = ...`);
    return key;
  }
  const parsed = parseActionLiteral(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  throw new Error(`Unsupported merge operand "${raw}" in ${ctx.file}. Use: obj merge other (a state key or an inline {…} object).`);
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function parseActionLiteral(raw) {
  const value = raw.trim();
  if (/^["'].*["']$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^[\[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Unsupported action literal "${raw}". Use: a quoted string, number, boolean, null, or valid JSON.`);
    }
  }
  throw new Error(`Unsupported action literal "${raw}". Use: a quoted string, number, boolean, null, or valid JSON.`);
}

// ---------------------------------------------------------------------------
// Includes / assets
// ---------------------------------------------------------------------------

/**
 * Register a page's colocated `.skin`/`.js` siblings as emitted assets.
 * @param {string} file
 * @param {Paths} context
 * @param {Assets} assets
 * @returns {void}
 */
function collectColocatedAssets(file, context, assets) {
  const ext = path.extname(file);
  const stem = file.slice(0, -ext.length);
  for (const [assetExt, folder] of [[".skin", "styles"], [".js", "scripts"]]) {
    const candidate = `${stem}${assetExt}`;
    if (!fs.existsSync(candidate)) continue;
    const rel = path.relative(context.cwd, candidate).replaceAll(path.sep, "/");
    const outputExt = assetExt === ".skin" ? ".css" : ".js";
    const publicPath = `/__wd/${folder}/${rel.slice(0, -assetExt.length).replace(/[/.]/g, "_")}${outputExt}`;
    assets.files.set(candidate, publicPath);
    if (assetExt === ".skin") assets.skins.add(publicPath);
    if (assetExt === ".js") assets.scripts.add(publicPath);
  }
}

/**
 * Resolve an include spec to an absolute path inside `site/pages` or `site/_`.
 * @param {string} spec Include target (may be quoted).
 * @param {string} fromFile File requesting the include.
 * @param {Paths} context
 * @param {boolean} [allowAny] Allow non-page extensions (e.g. JSON for `@loop`).
 * @returns {string}
 */
function resolveInclude(spec, fromFile, context, allowAny = false) {
  const clean = stripQuotes(spec);
  const candidates = [];
  if (clean.startsWith("/")) {
    candidates.push(path.join(context.shelfRoot, clean.slice(1)));
  } else {
    candidates.push(path.resolve(path.dirname(fromFile), clean));
    candidates.push(path.join(context.shelfRoot, clean));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isAllowedInclude(resolved, context)) {
      throw new Error(`Include "${spec}" from ${fromFile} resolves outside site/pages or site/_`);
    }
    if (!fs.existsSync(resolved)) continue;
    if (!allowAny && !pageIncludeExtensions.includes(path.extname(resolved))) continue;
    return resolved;
  }
  throw new Error(`Could not resolve include "${spec}" from ${fromFile}`);
}

/**
 * @param {string} file
 * @param {Paths} context
 * @returns {boolean}
 */
function isAllowedInclude(file, context) {
  const roots = [context.routesRoot, context.shelfRoot].map((root) => path.resolve(root));
  return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`));
}

// ---------------------------------------------------------------------------
// Plain .md hints
// ---------------------------------------------------------------------------

/**
 * Warn when a plain `.md` file contains `.wd`-only syntax that stays inert.
 * @param {string} body
 * @param {string} file
 * @param {Compilation} comp
 * @returns {void}
 */
function scanMarkdownHints(body, file, comp) {
  let fence = null;
  for (const line of body.split("\n")) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const hit = line.match(/^(@include|@loop|@repeat|:state|:button|:if|:for|:try|:note|:sprint|:::)(\s|$)/);
    if (hit) {
      comp.warnings.push(
        `${file}: "${hit[1]}" is .wd syntax and stays plain text in .md — rename the file to .wd to activate it.`
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

/**
 * JSON-encode a value for an inline `<script>`, escaping `<` to stay HTML-safe.
 * @param {unknown} value
 * @returns {string}
 */
function safeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function parseStateValue(raw) {
  const value = raw.trim();
  if (/^["'].*["']$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * @param {string} raw
 * @returns {string | number | boolean}
 */
function parseScalar(raw) {
  const trimmed = raw.trim();
  if (/^["']/.test(trimmed)) return stripQuotes(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/**
 * @param {string} [value]
 * @returns {string}
 */
function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, "") ?? "";
}

/**
 * Turn a field name / state key into a human-readable accessible name, e.g.
 * `quest` → "Quest", `user-name` → "User name", `firstName` → "First name".
 * Hyphens, underscores, and camelCase boundaries become spaces; the first letter
 * is capitalized. Used to auto-derive aria-label on generated form inputs.
 * @param {string} name
 * @returns {string}
 */
function humanizeName(name) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase
    .replace(/[-_]+/g, " ")                  // hyphens/underscores → spaces
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * Escape a value for safe inclusion in HTML text and attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
