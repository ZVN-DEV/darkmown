// ---------------------------------------------------------------------------
// Markdown layer: the shared markdown-it instances (strict default + a lazy
// `html: true` raw-HTML variant), the `wd_binding` inline plugin and `wd_attrs`
// core plugin, and prose rendering with `{ name.path }` interpolation resolved
// against the loop item / static scope / declared state.
// ---------------------------------------------------------------------------

import path from "node:path";
import MarkdownIt from "markdown-it";
import { highlightCode } from "../highlight.js";
import { LOOP_META, lineOf, recordRead, wdError } from "./context.js";
import { applyPipeline, fmtAttr, validatePipes } from "./format.js";
import { imageSize } from "./image-size.js";
import {
  escapeHtml,
  getPath,
  interpolateBound,
  interpolateLeaf,
  lookupVar,
  resolveStateKey,
  unsafeUrlValue
} from "./interpolation.js";

// The two halves of the destination contract, re-exported together: a caller
// painting an href itself (a loop row's build-time initial) has to encode the
// value the same way this module does and answer the same scheme question.
export { unsafeUrlValue };

/**
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Build-time syntax highlighting: highlight.js runs over every fenced code block
// with a known language. The callback returns escaped token HTML or `""` to let
// markdown-it render a plain escaped `<code>` (graceful degradation). Both
// instances share it so `html: false` pages highlight too.
const md = new MarkdownIt({ html: false, highlight: highlightCode });
md.use(bindingPlugin);
md.use(attrsPlugin);
md.use(attrBindPlugin);
md.use(imageVariantsPlugin);
md.use(rawHtmlPlugin);
md.use(anchorPlugin);
md.use(siblingHtmlPlugin);

// Raw HTML in markdown is escaped by default: a stray `<script>` or `onerror=`
// attribute in content renders as inert text, so multi-author content (blog
// collections, contributed docs) is stored-XSS-safe out of the box. A page
// whose author writes their own HTML opts in with frontmatter `html: true`;
// that instance is built lazily so the default path stays a single instance.
/** @type {MarkdownIt | null} */
let mdRawHtml = null;
/**
 * Pick the markdown-it instance for a page (raw HTML off by default, on with `html: true`).
 * @param {Meta} [meta]
 * @returns {MarkdownIt}
 */
export function selectMd(meta) {
  // Frontmatter scalars stay strings (no coercion), so accept both forms.
  if (meta?.html !== true && meta?.html !== "true") return md;
  if (!mdRawHtml) {
    mdRawHtml = new MarkdownIt({ html: true, highlight: highlightCode });
    mdRawHtml.use(bindingPlugin);
    mdRawHtml.use(attrsPlugin);
    mdRawHtml.use(attrBindPlugin);
    mdRawHtml.use(imageVariantsPlugin);
    mdRawHtml.use(rawHtmlPlugin);
    mdRawHtml.use(anchorPlugin);
    mdRawHtml.use(siblingHtmlPlugin);
  }
  return mdRawHtml;
}

/**
 * Render one prose chunk.
 * @param {string} text
 * @param {Ctx} ctx
 * @param {number} [index] 0-based line index the chunk starts at in the current
 *   `compileBody` slice, so a warning about a binding inside it reports the true
 *   `file:line`. Defaults to the top of the slice.
 * @returns {string}
 */
export function renderProse(text, ctx, index = 0) {
  /** @type {PendingAttr[]} */
  const attrs = [];
  text = resolveDestinationBindings(text, ctx, attrs, index);
  const html = (ctx.md ?? md).render(text, {
    resolveBinding: (/** @type {string} */ expr) => resolveBinding(expr, ctx),
    // Raw-HTML interpolation needs the compile context AND the chunk's offset,
    // and markdown-it's env is the only channel into a core rule. `attrs` is the
    // destination-binding registry `attrBindPlugin` reads back (see below).
    wd: { ctx, index, attrs },
    headingSlugs: ctx.comp.headingSlugs
  });
  if (!attrs.length) return html;
  // A `](…)` that markdown did NOT turn into a link — the commonest being an
  // inline code span documenting the syntax — keeps its placeholder. Put the
  // author's own braces back rather than shipping the marker.
  return html.replace(ATTR_MARK_RE, (mark, n) =>
    attrs[Number(n)] ? escapeHtml(attrs[Number(n)].raw) : mark
  );
}

// ---------------------------------------------------------------------------
// THE SILENT-FAILURE CLASS: interpolation that markdown never sees.
//
// `{ name }` is an INLINE rule, so it only fires where markdown-it is parsing
// inline content. Three positions are not inline content, and in all three the
// framework used to emit the author's braces verbatim with no error and no
// warning:
//
//   1. A link/image destination. `[a]({ x })` worked (one special case), but
//      `[a](/p/{ x }/)` did not: `{ … }` contains spaces, a markdown destination
//      may not, so the link never forms and the WHOLE construct degrades to the
//      literal text `[a](/p/value/)`.
//   2. An attribute inside raw HTML (`<a href="{ x }">`, `html: true`). The tag
//      is one opaque `html_inline` token; nothing inside it is ever parsed.
//   3. The body of a raw `html_block` (`<div>{ x }</div>`).
//
// Every build-time value resolves in all three. A REACTIVE value in a
// destination now BINDS: the destination pass plants a placeholder, and
// `attrBindPlugin` turns the assembled href/src into a `data-wd-attr` template
// the runtime repaints (see there). Raw HTML still cannot bind — a tag is one
// opaque token with no element to mark — so that position keeps the warning.
// ---------------------------------------------------------------------------

/**
 * Warn (non-fatal) that a reactive value landed in raw HTML, which has no
 * element for the runtime to mark.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the offending line in the slice.
 * @param {string} expr The binding source text, without braces.
 * @param {boolean} painted Whether the initial value was written into the output.
 * @returns {void}
 */
function warnUnbindable(ctx, index, expr, painted) {
  const outcome = painted
    ? "its build-time value is painted once and then never updates"
    : "it stays literal text";
  ctx.comp.warnings.push(
    `${ctx.file}:${lineOf(ctx, index)}: "{ ${expr} }" is reactive, but raw HTML (an attribute or an html block) cannot bind, so ${outcome}. ` +
      `Move the value into ordinary text or a markdown link/image destination (where { ${expr} } does bind), or update it from a colocated .js with wd.subscribe.`
  );
}

// ---------------------------------------------------------------------------
// REACTIVE ATTRIBUTE BINDING (a link/image destination).
//
// A destination is not inline content, so there is no token for the inline rule
// to emit and nothing to hang `data-wd-bind` on. The pass below therefore runs
// in two halves:
//
//   1. `resolveDestinationBindings` (pre-parse) substitutes a build-time value
//      directly, exactly as before, and replaces a REACTIVE one with the
//      placeholder `~wd-attr-<n>~`, recording what it stands for. The
//      placeholder is deliberately shaped out of characters markdown-it's URL
//      normalizer leaves untouched, so it survives into the token's href/src.
//   2. `attrBindPlugin` (core rule) finds the placeholder in the assembled
//      href/src, splits the value into literal chunks + bindings, writes the
//      initial paint, and stamps the template onto the element.
//
// The template rides on `data-wd-attr` (state/`:computed`, repainted in the
// runtime's text-bind pass) or `data-wd-each-attr` (anything per-row, filled by
// `fillItem`) — the same split `data-wd-bind` / `data-wd-each` already use for
// text. One template serves every row, so a per-row destination paints EMPTY at
// build time and gets its first real value on hydrate.
// ---------------------------------------------------------------------------

/**
 * One reactive binding found in a destination: the serialized template part the
 * runtime evaluates, plus the build-time text to paint for it.
 * @typedef {object} PendingAttr
 * @property {["s", string, string] | ["i", string] | ["m", string]} part
 *   `s` = state key + sub-path, `i` = loop-row sub-path, `m` = row meta variable.
 * @property {string} text Build-time paint ("" for anything per-row).
 * @property {string} raw The author's own `{ … }` source, restored when the
 *   `](…)` turned out not to be a link after all.
 */

/** @param {number} n @returns {string} */
const attrMark = (n) => `~wd-attr-${n}~`;
const ATTR_MARK_RE = /~wd-attr-(\d+)~/g;

// A value going into a markdown link destination is URL text, not markdown, and
// the destination has no quoting: an unencoded `)` CLOSES it and hands whatever
// follows back to the parser (raw HTML on an `html: true` page), and a space
// silently kills the link. Encode the ASCII characters that carry meaning there
// by hand, because encodeURIComponent deliberately leaves `(`, `)` and `'`
// alone. Non-ASCII is left to markdown-it's own normalizeLink.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — a control character in a destination has to be encoded, not passed through.
const DEST_UNSAFE = /[\u0000-\u0020()<>"'`\\\u007F]/g;

/**
 * `unknown` rather than `string`: a caller painting a row's own initial href
 * holds whatever `getPath` returned, and the coercion is right here.
 * @param {unknown} value
 * @returns {string}
 */
export const encodeDest = (value) =>
  String(value).replace(
    DEST_UNSAFE,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );

/**
 * Byte ranges of the inline code spans on one line, so a destination being SHOWN
 * rather than used stays literal. `` `[x](/p/{ p.slug }/)` `` in a docs
 * paragraph documents the syntax, exactly like the fenced-block skip.
 * @param {string} line
 * @returns {[number, number][]}
 */
function codeSpansOf(line) {
  /** @type {[number, number][]} */
  const spans = [];
  const runs = [...line.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      // CommonMark closes a run of N backticks with a run of exactly N.
      if (runs[j][0].length !== runs[i][0].length) continue;
      spans.push([runs[i].index, runs[j].index + runs[j][0].length]);
      i = j;
      break;
    }
  }
  return spans;
}

/**
 * Pre-resolve `{ expr }` interpolations sitting in a markdown link/image
 * destination — the `](…)` slot — so a build-time `@loop` (or any static scope)
 * can drive an href/src, and a reactive value can be bound by the core rule.
 *
 * A markdown destination cannot contain the spaces inside `{ … }`, so markdown-it
 * would never form the link; substituting here first lets the normal link/image
 * parser run. Every `{ … }` in the destination is substituted, not just one at
 * the very start — `/products/{ p.slug }/` is the shape a collection listing
 * actually writes.
 *
 * Fenced code is skipped: a docs page showing `[{ p.name }](/p/{ p.slug }/)`
 * inside a ```` ```wd ```` block is DOCUMENTING the syntax, not using it.
 * @param {string} text
 * @param {Ctx} ctx
 * @param {PendingAttr[]} attrs Registry the core rule reads placeholders back from.
 * @param {number} index 0-based line index of the slice, for `file:line`.
 * @returns {string}
 */
function resolveDestinationBindings(text, ctx, attrs, index) {
  const lines = text.split("\n");
  /** @type {string | null} */
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const spans = codeSpansOf(lines[i]);
    lines[i] = lines[i].replace(/\]\(([^)\n]*)\)/g, (whole, dest, offset) => {
      if (spans.some(([a, b]) => offset >= a && offset < b)) return whole;
      const filled = dest.replace(
        /\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g,
        (/** @type {string} */ brace, /** @type {string} */ expr) => {
          const found = resolveBinding(expr, ctx);
          if (!found) return brace; // not in scope — leave the author's text alone
          if (found.kind === "static") {
            // The scheme test runs on the RAW value, before encoding, because
            // that is the string the runtime's guard sees. Encoding first would
            // turn " javascript:x" into "%20javascript:x" and quietly ship it.
            if (unsafeUrlValue(found.text)) {
              warnUnsafeUrl(ctx, index + i, expr);
              return "";
            }
            return encodeDest(found.text);
          }
          const part = /** @type {PendingAttr["part"]} */ (
            found.kind === "state"
              ? ["s", found.key ?? "", found.path ?? ""]
              : found.meta
                ? ["m", found.meta]
                : ["i", found.path ?? ""]
          );
          attrs.push({ part, text: found.text, raw: brace });
          return attrMark(attrs.length - 1);
        }
      );
      return filled === dest ? whole : `](${filled})`;
    });
  }
  return lines.join("\n");
}

/**
 * markdown-it plugin (core rule): turn a destination placeholder back into a
 * bound attribute. Reads the `~wd-attr-<n>~` markers out of a `link_open`'s
 * `href` / an `image`'s `src`, writes the build-time paint, and stamps the
 * template the runtime re-evaluates on every render.
 *
 * The build-time paint runs through the same scheme guard the runtime uses, on
 * the same unencoded string: markdown-it's own `validateLink` vetted the
 * placeholder, not the value that replaced it, so an unsafe seed would
 * otherwise ship in the HTML.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function attrBindPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_attr_bind", (state) => {
    /** @type {PendingAttr[] | undefined} */
    const registry = state.env?.wd?.attrs;
    if (!registry || !registry.length) return false;
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        const name = token.type === "link_open" ? "href" : token.type === "image" ? "src" : "";
        if (!name) continue;
        const raw = token.attrGet(name);
        if (!raw || !raw.includes("~wd-attr-")) continue;
        /** @type {(string | PendingAttr)[]} */
        const template = [];
        let initial = "";
        let plain = ""; // the same value UNencoded: what the runtime will hold
        let perRow = false;
        let end = 0;
        ATTR_MARK_RE.lastIndex = 0;
        /** @type {RegExpExecArray | null} */
        let hit;
        while ((hit = ATTR_MARK_RE.exec(raw))) {
          const pending = registry[Number(hit[1])];
          if (!pending) continue; // not one of ours — leave the author's text
          if (hit.index > end) {
            template.push(raw.slice(end, hit.index));
            initial += raw.slice(end, hit.index);
            plain += raw.slice(end, hit.index);
          }
          template.push(pending);
          initial += encodeDest(pending.text);
          plain += pending.text;
          if (pending.part[0] !== "s") perRow = true;
          end = hit.index + hit[0].length;
        }
        if (!template.length) continue;
        if (end < raw.length) {
          template.push(raw.slice(end));
          initial += raw.slice(end);
          plain += raw.slice(end);
        }
        // Tested on the UNencoded assembly, exactly as `applyAttr` will test it
        // in the browser: encoding first hides a leading space or control
        // character from a guard that is meant to strip it.
        token.attrSet(name, unsafeUrlValue(plain) ? "" : initial);
        token.attrSet(
          perRow ? "data-wd-each-attr" : "data-wd-attr",
          JSON.stringify([name, ...template.map((t) => (typeof t === "string" ? t : t.part))])
        );
      }
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// RESPONSIVE IMAGE VARIANTS (the `@width` convention, 2.8.0 / A2).
//
// Darkmown has no image pipeline and never will (no resize dependency), so the
// convention wires variants the AUTHOR (or their CDN tooling) already made:
// next to `/doctors/dr-x.webp` sit `dr-x@640.webp`, `dr-x@1280.webp` — same
// directory, same extension, `@<width>` before it. When at least one exists,
// the markdown image gains a `srcset` (variants ascending, then the original
// at its intrinsic width) so the browser downloads the size it needs instead
// of the full-resolution file. The original stays the `src` fallback.
//
// Discovery is an existence PROBE over {@link VARIANT_WIDTHS} through the
// injected reader: the Reader contract has no directory listing, so an off-list
// width (say `@500`) is simply not wired — a deliberate, documented miss, never
// an error. Each variant's descriptor width is its REAL intrinsic width from
// the image header (a `@640` file that actually holds 600px says 600w); when
// the bytes cannot be read or parsed (the in-memory reader has no binaries), the
// filename width is the fallback. The original's intrinsic width follows the
// same rule, except it has no filename fallback: unreadable means it is left
// out of the srcset and stays the plain `src` default.
//
// A bound src (`![alt]({ photo })`) is repainted by the runtime, so a srcset
// computed from the seed would go stale on the first render — those images are
// skipped, exactly as `enhanceImages` skips stamping their dimensions. Raw-HTML
// `<img>` tags are author territory and never pass through this rule.
// ---------------------------------------------------------------------------

// The widths probed for a `@<width>` sibling: the union of the common srcset
// breakpoints (320-2048) and the small avatar/thumbnail sizes. Sorted; the
// emitted srcset is re-sorted by MEASURED width, so this order is only probe
// order and carries no output meaning.
const VARIANT_WIDTHS = [
  64, 96, 128, 160, 256, 320, 480, 640, 768, 960, 1024, 1280, 1440, 1536, 1920, 2048, 2560, 3840
];

// srcset computation per image src, memoized per compilation: a page that
// references the same image twice (or in a loop template and a hero) probes
// the reader once. WeakMap so a finished compilation takes its cache with it.
/** @type {WeakMap<object, Map<string, string | null>>} */
const srcsetCache = new WeakMap();

/**
 * markdown-it plugin (core rule): wire `@<width>` sibling files into a `srcset`
 * on every markdown image. Registered AFTER `attrBindPlugin` so a bound src is
 * already marked `data-wd-attr`/`data-wd-each-attr` and can be skipped.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function imageVariantsPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_image_variants", (state) => {
    /** @type {{ ctx: Ctx } | undefined} */
    const wd = state.env?.wd;
    if (!wd) return false; // a bare `.md` render carries no compile context
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== "image") continue;
        if (token.attrGet("data-wd-attr") || token.attrGet("data-wd-each-attr")) continue;
        const srcset = srcsetFor(token.attrGet("src") ?? "", wd.ctx);
        if (srcset) token.attrSet("srcset", srcset);
      }
    }
    return false;
  });
}

/**
 * The srcset value for one image src, or null when there is nothing to wire
 * (no variants, or a src this layer must not touch). Memoized per compilation.
 * @param {string} src
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function srcsetFor(src, ctx) {
  let perComp = srcsetCache.get(ctx.comp);
  if (!perComp) srcsetCache.set(ctx.comp, (perComp = new Map()));
  else if (perComp.has(src)) return perComp.get(src) ?? null;
  const built = buildSrcset(src, ctx);
  perComp.set(src, built);
  return built;
}

/**
 * Build the srcset for one src: probe for `@<width>` siblings, measure each
 * one, sort ascending. Null when no sibling variant exists.
 * @param {string} src
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function buildSrcset(src, ctx) {
  if (!src || /^(?:https?:)?\/\//i.test(src) || src.startsWith("data:")) return null;
  // A query/hash suffix would corrupt the `@width` filename surgery; such a src
  // points at a dynamic endpoint anyway, which the convention does not cover.
  if (/[?#]/.test(src)) return null;
  const dot = src.lastIndexOf(".");
  if (dot <= src.lastIndexOf("/") + 1) return null; // no extension
  const base = src.slice(0, dot);
  const ext = src.slice(dot);
  // Resolve the src to a reader path, mirroring the asset emit (and page.js's
  // measureImage): shelf media comes from `site/_`, other absolute paths from
  // `site/pages`. A page-relative src is unresolvable after assembly.
  /** @type {string} */
  let relBase;
  /** @type {string} */
  let root;
  if (base.startsWith("/__wd/media/")) {
    root = ctx.context.shelfRoot;
    relBase = base.slice("/__wd/media/".length);
  } else if (src.startsWith("/")) {
    root = ctx.context.routesRoot;
    relBase = base.slice(1);
  } else {
    return null;
  }
  const reader = ctx.comp.reader;
  /** @type {{ href: string, width: number }[]} */
  const candidates = [];
  for (const width of VARIANT_WIDTHS) {
    const abs = path.join(root, `${relBase}@${width}${ext}`);
    if (!reader.exists(abs)) continue;
    candidates.push({ href: `${base}@${width}${ext}`, width: measureWidth(abs, reader) ?? width });
  }
  if (!candidates.length) return null;
  const intrinsic = measureWidth(path.join(root, `${relBase}${ext}`), reader);
  if (intrinsic) candidates.push({ href: src, width: intrinsic });
  candidates.sort((a, b) => a.width - b.width);
  return candidates.map((c) => `${c.href} ${c.width}w`).join(", ");
}

/**
 * An image file's intrinsic width from its header bytes, or null when the file
 * cannot be read (missing, or the in-memory reader's unsupported binary read)
 * or holds no parseable size. Never throws — a build never fails on an image.
 * @param {string} abs Absolute path the reader understands.
 * @param {import("./reader.js").Reader} reader
 * @returns {number | null}
 */
function measureWidth(abs, reader) {
  try {
    return imageSize(reader.readBinary(abs))?.width ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PARAGRAPH-WRAPPED SIBLING HTML (compile-time hint, 2.8.0 / F11).
//
// CommonMark hoists a line that STARTS with a block-level tag (`<div>`,
// `<section>`, …) into an `html_block`, even mid-run — so sixteen consecutive
// `<div class="card">` lines render fine. But a line starting with any OTHER
// tag (`<a class="card">`, `<picture>`, a custom element) stays inline, and a
// run of those becomes ONE `<p>` with softbreaks: the "cards" render inline
// inside a single paragraph, collapsing the grid they were meant to populate
// (the real rebuild bug: 16 carrier cards, one column, fixed by hand-wrapping
// them in a raw `<div class="grid">`).
//
// The hint therefore keys on the OUTCOME, not a tag list: a core rule inspects
// paragraph (`inline`) tokens — the parser has already decided what hoisted —
// and warns once per run of 2+ consecutive lines that each open with a
// COMPONENT-LOOKING tag (one carrying a class or id). That makes the no-warn
// cases structural rather than special-cased: lines inside a container
// (`<div class="grid">` and everything to `</div>`) are one `html_block`,
// fenced code is a code token, and blank-line-separated lines are separate
// paragraphs, so none of them can false-positive here. The class/id signal is
// the other half of staying conservative: two consecutive classless
// `<a href>` lines are ordinary prose links that are MEANT to share a
// paragraph, and a hint about them would be noise on a correct page.
// ---------------------------------------------------------------------------

// An opening tag at the very start of a line: `<a …`, `<x-card …`. Closing
// tags (`</`), comments (`<!--`) and declarations (`<!`, `<?`) never match —
// only an OPEN tag can be a sibling element that loses its block box.
const SIBLING_TAG = /^<[A-Za-z][A-Za-z0-9-]*(?=[\s/>])/;

// What makes a tag-led line a "component" rather than prose: the opening tag
// carries a class or id, so the author styles it — plausibly as a block or a
// grid/flex child, exactly the box that collapses inside a `<p>`.
const COMPONENT_TAG = /\s(?:class|id)\s*=/i;

/**
 * markdown-it plugin (core rule): warn when 2+ consecutive source lines of one
 * paragraph each open with a component-looking raw HTML tag (class or id) —
 * they will render inline in that one `<p>`. Only meaningful where raw HTML
 * renders (`html: true`); on the strict instance the tags are escaped text and
 * there is nothing to warn about.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function siblingHtmlPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_html_siblings", (state) => {
    if (!state.md.options.html) return false;
    /** @type {{ ctx: Ctx, index: number } | undefined} */
    const wd = state.env?.wd;
    if (!wd) return false; // a bare `.md` render has no warnings channel
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      warnSiblingHtmlRuns(block, wd, wd.ctx);
    }
    return false;
  });
}

/**
 * Warn once per run of 2+ consecutive tag-led lines inside one paragraph.
 * @param {any} block The paragraph's `inline` token.
 * @param {{ index: number }} wd The prose chunk's env (0-based slice offset).
 * @param {Ctx} ctx
 * @returns {void}
 */
function warnSiblingHtmlRuns(block, wd, ctx) {
  // A line "opens with a component tag" when its FIRST token is author HTML
  // carrying a class or id. A `{ name }` binding is an html_inline token too,
  // but `meta.wdText` marks those — and a bound span is MEANT to be inline, so
  // it can neither start a run nor (being real inline content) break one.
  /** @type {boolean[]} */
  const tagLine = [];
  let first = true; // still looking for the current line's first token
  for (const tok of block.children) {
    if (tok.type === "softbreak" || tok.type === "hardbreak") {
      first = true;
      continue;
    }
    if (!first) continue;
    first = false;
    tagLine.push(
      tok.type === "html_inline" &&
        tok.meta?.wdText === undefined &&
        SIBLING_TAG.test(tok.content) &&
        COMPONENT_TAG.test(tok.content)
    );
  }
  let runStart = -1;
  for (let i = 0; i <= tagLine.length; i++) {
    if (i < tagLine.length && tagLine[i]) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1 && i - runStart >= 2) {
      ctx.comp.warnings.push(
        `${ctx.file}:${lineOf(ctx, wd.index + (block.map ? block.map[0] : 0) + runStart)}: ` +
          `${i - runStart} sibling HTML block lines will render inline in one <p>; ` +
          `wrap them in a container (e.g. a raw <div>)`
      );
    }
    runStart = -1;
  }
}

/**
 * markdown-it plugin (core rule): resolve `{ expr }` inside RAW HTML — the
 * opaque `html_inline` tokens a tag becomes and the `html_block` tokens a
 * block-level element becomes, both of which only exist on an `html: true` page.
 * Values are HTML-escaped, which is correct in both positions a brace can sit
 * in (an attribute value and element text), so no tag-position analysis is
 * needed.
 *
 * `.md` files never reach this: `compileFile` renders them with no
 * `resolveBinding` in the env, and this rule is a no-op without it — the
 * extension stays the feature gate.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function rawHtmlPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_raw_html", (state) => {
    const wd = state.env?.wd;
    if (!wd) return false;
    for (const block of state.tokens) {
      const line = wd.index + (block.map ? block.map[0] : 0);
      if (block.type === "html_block") {
        block.content = fillRawHtml(block.content, wd.ctx, line);
        continue;
      }
      // Inline children carry no line map, so count the line breaks walked past:
      // one softbreak/hardbreak per source newline inside the block. Keeps the
      // warning on the author's actual line, not the top of the paragraph.
      let offset = 0;
      for (const child of block.children ?? []) {
        if (child.type === "softbreak" || child.type === "hardbreak") offset++;
        // `child.meta.wdText` marks a token THIS layer already produced (a
        // resolved binding). Its content is DATA, not template: without the skip,
        // a state value that happens to read `{ meta.title }` would be resolved a
        // second time and leak whatever `title` holds into the page.
        else if (child.type === "html_inline" && child.meta?.wdText === undefined)
          child.content = fillRawHtml(child.content, wd.ctx, line + offset);
      }
    }
    return false;
  });
}

// The value of a URL-bearing attribute, as far as a fragment has been written.
// The capture is the value SO FAR: `<a href="java` yields "java", so the guard
// can test what the attribute will actually hold rather than what one brace
// happened to resolve to. Escaping is no defense here: `href` and friends
// resolve `javascript:` without any quote breakout, and unlike a markdown
// destination nothing upstream vets an author's own raw `<a href="…">`.
const URL_ATTR_TAIL =
  /\b(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)|'([^']*)|([^\s>"']*))$/i;

/**
 * Warn that a value in URL position carries a scheme the browser would execute.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index, for `file:line`.
 * @param {string} expr
 * @returns {void}
 */
function warnUnsafeUrl(ctx, index, expr) {
  ctx.comp.warnings.push(
    `${ctx.file}:${lineOf(ctx, index)}: "{ ${expr} }" resolves to a javascript:, data: or vbscript: URL, so the attribute is emitted empty. ` +
      `Use an https:, mailto: or site-relative value, or render it as text rather than a link target.`
  );
}

/**
 * Substitute every `{ expr }` in a raw-HTML fragment with its escaped value.
 *
 * The output is assembled by hand rather than through `String.replace` because
 * the URL guard has to see the attribute value BEING BUILT: `<a href="java{ x }">`
 * with x = "script:alert(1)" is a live javascript: URL that no single brace
 * value would ever look unsafe on its own. When the assembled value trips the
 * guard, the literal head of that value is dropped from the output too, so the
 * attribute lands empty instead of half-written.
 * @param {string} html
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the fragment, for warnings.
 * @returns {string}
 */
function fillRawHtml(html, ctx, index) {
  // The capture mirrors the inline `wd_binding` rule: path plus an optional
  // `| pipe:arg` chain. A pipe-only divergence here left `{ d | date }` literal
  // in raw HTML while the same expression folded in prose.
  const brace = /\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:\|[^}]*)?)\}/g;
  let out = "";
  let last = 0;
  /** @type {RegExpExecArray | null} */
  let hit;
  while ((hit = brace.exec(html))) {
    out += html.slice(last, hit.index);
    last = hit.index + hit[0].length;
    const expr = hit[1].trim();
    const found = resolveBinding(expr, ctx);
    if (!found) {
      out += hit[0];
      continue;
    }
    if (found.kind === "row") {
      warnUnbindable(ctx, index, expr, false);
      out += hit[0];
      continue;
    }
    if (found.kind === "state") warnUnbindable(ctx, index, expr, true);
    const open = URL_ATTR_TAIL.exec(out);
    const head = open ? (open[1] ?? open[2] ?? open[3]) : "";
    if (open && unsafeUrlValue(head + found.text)) {
      warnUnsafeUrl(ctx, index, expr);
      out = out.slice(0, out.length - head.length); // the head belongs to the refused value
      continue;
    }
    out += escapeHtml(found.text);
  }
  return out + html.slice(last);
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
    // Capture the path plus an optional `| formatter:arg | …` pipe chain. Pipe
    // arguments may not contain `}` (they may be quoted), so the chain runs to
    // the first closing brace.
    const match = /^\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:\|[^}]*)?)\}/.exec(
      state.src.slice(state.pos)
    );
    if (!match) return false;
    const resolve = state.env?.resolveBinding;
    const found = resolve ? resolve(match[1].trim()) : null;
    if (!found) return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = found.html;
      // The heading-anchor rule reads this back: an id must be a slug of what the
      // reader SEES, and what the reader sees here is `found.text`, not the
      // markup carrying it. Marking the token also keeps genuine author HTML
      // (`## Hi <b>x</b>`) contributing nothing, exactly as before.
      token.meta = { wdText: found.text };
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
 * (link/em/strong/…). Returns null when nothing valid precedes. Exported so its
 * contract — including the defensive unbalanced-close fallback that markdown-it's
 * always-balanced token stream never triggers in practice — is unit-testable.
 * @param {any[]} children markdown-it inline child tokens
 * @param {number} i Index of the attr-block text token.
 * @returns {any} the matching markdown-it Token, or null
 */
export function attrTarget(children, i) {
  const prev = children[i - 1];
  if (!prev) return null;
  if (prev.type === "image") return prev;
  // Not a close token (e.g. text, softbreak, or an open) → nothing to attach to.
  if (prev.nesting !== -1) return null;
  // Walk back to the matching open, counting nested same-type close/open pairs.
  const openType = prev.type.replace(/_close$/, "_open");
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    const t = children[j];
    if (t.type === prev.type) depth++;
    else if (t.type === openType) {
      depth--;
      if (depth === 0) return t;
    }
  }
  // Unbalanced close with no matching open — markdown-it never emits this, but
  // the guard keeps attrTarget total: no element is attached.
  return null;
}

/**
 * GitHub-style heading slug: lowercase, punctuation stripped (letters, numbers,
 * whitespace, `_`, and `-` survive), each whitespace character becomes a hyphen.
 * Punctuation-only headings fall back to `"section"` so the id is never empty.
 * @param {string} text Plain heading text.
 * @returns {string}
 */
export function slugify(text) {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .replace(/\s/gu, "-");
  return slug || "section";
}

/**
 * markdown-it plugin (core rule): every heading gets a stable slugified `id`
 * so long pages are linkable without any JS. Duplicate slugs dedupe with
 * `-1`/`-2` suffixes; the counters live in `env.headingSlugs` so a page whose
 * prose renders in chunks (directives between headings) still dedupes across
 * the whole document. A `{ name }` binding contributes its resolved text (its
 * initial value when reactive); author-written inline HTML still contributes
 * none, so only text the reader actually reads shapes the id.
 * @param {MarkdownIt} mdInstance
 * @returns {void}
 */
function anchorPlugin(mdInstance) {
  mdInstance.core.ruler.push("wd_heading_anchors", (state) => {
    const counts = (state.env.headingSlugs ??= new Map());
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "heading_open") continue;
      let text = "";
      for (const child of tokens[i + 1].children ?? []) {
        if (child.type === "text" || child.type === "code_inline") text += child.content;
        // A `{ name }` binding is real heading text — without it every
        // interpolated heading on a site slugged to the same `section`,
        // `section-1`, `section-2`, which is what darkmown.com/blog/ shipped.
        // Reactive bindings contribute their INITIAL value: the id has to be
        // stable and crawlable, so it is minted once at build time.
        else if (child.meta?.wdText) text += child.meta.wdText;
      }
      const base = slugify(text);
      const seen = counts.get(base) ?? 0;
      counts.set(base, seen + 1);
      tokens[i].attrSet("id", seen ? `${base}-${seen}` : base);
    }
    return false;
  });
}

/**
 * A resolved `{ name.path }` binding.
 * @typedef {object} Binding
 * @property {string} html What the inline rule emits: a `data-wd-each` /
 *   `data-wd-bind` span for a reactive value, the escaped value for a static one.
 * @property {string} text The PLAIN resolved text (unescaped, no markup) — a
 *   reactive value's initial paint. This is what a link destination, a raw-HTML
 *   attribute, and a heading slug need; `html` is unusable in all three.
 * @property {"static" | "state" | "row"} kind Where the value came from, and
 *   therefore what the non-inline positions may do with it: `static` is a
 *   build-time value and always safe to substitute; `state` is `:state`/`:store`
 *   and paints its seed then binds; `row` is a reactive `@loop` row, whose ONE
 *   template serves every row, so it paints nothing and binds per row.
 * @property {string} [key] For `state`: the fully-qualified state key.
 * @property {string} [path] For `state`/`row`: the dotted sub-path under it ("" for the whole value).
 * @property {string} [meta] For `row`: the per-row meta variable (`index`, `number`, …).
 */

/**
 * Resolve a `{ name.path }` binding: loop item span, static value, or a reactive
 * bind span. Returns null when nothing in scope matches, which every caller
 * treats as "leave the author's braces exactly as written".
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {Binding | null}
 */
function resolveBinding(expr, ctx) {
  const { path, stages } = validatePipes(expr, ctx);
  const segs = path.split(".");
  const head = segs[0];
  // Reactive nodes carry the pipe chain in data-wd-fmt; static values fold now.
  const fmt = stages.length ? ` data-wd-fmt="${escapeHtml(fmtAttr(stages))}"` : "";
  /** @param {unknown} v */
  const fold = (v) => (stages.length ? applyPipeline(v, stages) : v);

  // Per-row meta vars ($index/$number/$first/$last/$count) — only inside a loop.
  if (LOOP_META[head]) {
    if (!ctx.loopMeta)
      throw wdError(
        `"{ ${expr} }" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Move it into a loop body, or rename your value.`,
        { code: "WD005", file: ctx.file }
      );
    if (ctx.loopItem)
      // reactive: filled per row, so there is no single build-time text.
      return {
        html: `<span data-wd-each-meta="${LOOP_META[head]}"${fmt}></span>`,
        text: "",
        kind: "row",
        meta: LOOP_META[head]
      };
    // static: the value is in scope (injected by staticUnroll); fall through.
  }

  if (ctx.loopItem && head === ctx.loopItem) {
    const rest = segs.slice(1).join(".");
    return {
      html: `<span data-wd-each${rest ? ` data-wd-path="${escapeHtml(rest)}"` : ""}${fmt}></span>`,
      text: "",
      kind: "row",
      path: rest
    };
  }

  const staticValue = lookupVar(ctx.scope, head);
  if (staticValue.found) {
    const resolved = getPath(staticValue.value, segs.slice(1));
    const text = interpolateLeaf(fold(resolved), expr, ctx);
    return { html: escapeHtml(text), text, kind: "static" };
  }

  const key = resolveStateKey(head, ctx);
  if (key) {
    ctx.comp.assets.runtime = true;
    recordRead(ctx, key, expr);
    const initial = getPath(ctx.comp.state.get(key), segs.slice(1));
    const rest = segs.slice(1).join(".");
    const pathAttr = rest ? ` data-wd-path="${escapeHtml(rest)}"` : "";
    // interpolateBound, not interpolateLeaf: the runtime repaints this node with
    // textContent, so the initial paint has to use the runtime's own coercion or
    // an array bind silently changes from "a, b" to "a,b" on first render.
    const text = interpolateBound(fold(initial), expr, ctx);
    return {
      html: `<span data-wd-bind="${escapeHtml(key)}"${pathAttr}${fmt}>${escapeHtml(text)}</span>`,
      text,
      kind: "state",
      key,
      path: rest
    };
  }

  return null;
}
