// ---------------------------------------------------------------------------
// Markdown layer: the shared markdown-it instances (strict default + a lazy
// `html: true` raw-HTML variant), the `wd_binding` inline plugin and `wd_attrs`
// core plugin, and prose rendering with `{ name.path }` interpolation resolved
// against the loop item / static scope / declared state.
// ---------------------------------------------------------------------------

import MarkdownIt from "markdown-it";
import { highlightCode } from "../highlight.js";
import { LOOP_META, lineOf, recordRead, wdError } from "./context.js";
import { applyPipeline, fmtAttr, validatePipes } from "./format.js";
import {
  escapeHtml,
  getPath,
  interpolateBound,
  interpolateLeaf,
  lookupVar,
  resolveStateKey,
  unsafeUrlValue
} from "./interpolation.js";

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
md.use(rawHtmlPlugin);
md.use(anchorPlugin);

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
    mdRawHtml.use(rawHtmlPlugin);
    mdRawHtml.use(anchorPlugin);
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
  text = resolveDestinationBindings(text, ctx, attrs);
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

/** @param {string} value @returns {string} */
const encodeDest = (value) =>
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
 * @returns {string}
 */
function resolveDestinationBindings(text, ctx, attrs) {
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
          if (found.kind === "static") return encodeDest(found.text);
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
 * The build-time paint runs through the same scheme guard the runtime uses:
 * markdown-it's own `validateLink` vetted the placeholder, not the value that
 * replaced it, so an unsafe seed would otherwise ship in the HTML.
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
          }
          template.push(pending);
          initial += encodeDest(pending.text);
          if (pending.part[0] !== "s") perRow = true;
          end = hit.index + hit[0].length;
        }
        if (!template.length) continue;
        if (end < raw.length) {
          template.push(raw.slice(end));
          initial += raw.slice(end);
        }
        token.attrSet(name, unsafeUrlValue(initial) ? "" : initial);
        token.attrSet(
          perRow ? "data-wd-each-attr" : "data-wd-attr",
          JSON.stringify([name, ...template.map((t) => (typeof t === "string" ? t : t.part))])
        );
      }
    }
    return false;
  });
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

// True when a fragment ENDS inside the value of a URL-bearing attribute, so the
// next thing written lands in a URL. Escaping is not enough there: `href` and
// friends resolve `javascript:` without any quote breakout, and unlike a markdown
// destination nothing upstream vets an author's own raw `<a href="…">`.
const URL_ATTR_TAIL =
  /\b(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"[^"]*|'[^']*|[^\s>"']*)$/i;

/**
 * Substitute every `{ expr }` in a raw-HTML fragment with its escaped value.
 * @param {string} html
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the fragment, for warnings.
 * @returns {string}
 */
function fillRawHtml(html, ctx, index) {
  return html.replace(
    /\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}/g,
    (brace, /** @type {string} */ expr, /** @type {number} */ offset) => {
      const found = resolveBinding(expr, ctx);
      if (!found) return brace;
      if (found.kind === "row") {
        warnUnbindable(ctx, index, expr, false);
        return brace;
      }
      if (found.kind === "state") warnUnbindable(ctx, index, expr, true);
      if (unsafeUrlValue(found.text) && URL_ATTR_TAIL.test(html.slice(0, offset))) {
        ctx.comp.warnings.push(
          `${ctx.file}:${lineOf(ctx, index)}: "{ ${expr} }" resolves to a javascript:, data: or vbscript: URL, so the attribute is emitted empty. ` +
            `Use an https:, mailto: or site-relative value, or render it as text rather than a link target.`
        );
        return "";
      }
      return escapeHtml(found.text);
    }
  );
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
