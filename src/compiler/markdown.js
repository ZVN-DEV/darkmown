// ---------------------------------------------------------------------------
// Markdown layer: the shared markdown-it instances (raw-HTML default + a lazy
// `html: false` strict variant), the `wd_binding` inline plugin and `wd_attrs`
// core plugin, and prose rendering with `{ name.path }` interpolation resolved
// against the loop item / static scope / declared state.
// ---------------------------------------------------------------------------

import MarkdownIt from "markdown-it";
import { highlightCode } from "../highlight.js";
import { LOOP_META } from "./context.js";
import { applyPipeline, fmtAttr, validatePipes } from "./format.js";
import {
  escapeHtml,
  getPath,
  interpolateLeaf,
  lookupVar,
  resolveStateKey
} from "./interpolation.js";

/**
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Build-time syntax highlighting: highlight.js runs over every fenced code block
// with a known language. The callback returns escaped token HTML or `""` to let
// markdown-it render a plain escaped `<code>` (graceful degradation). Both
// instances share it so `html: false` pages highlight too.
const md = new MarkdownIt({ html: true, highlight: highlightCode });
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
export function selectMd(meta) {
  // Frontmatter scalars stay strings (no coercion), so accept both forms.
  if (meta?.html !== false && meta?.html !== "false") return md;
  if (!mdNoHtml) {
    mdNoHtml = new MarkdownIt({ html: false, highlight: highlightCode });
    mdNoHtml.use(bindingPlugin);
    mdNoHtml.use(attrsPlugin);
  }
  return mdNoHtml;
}

/**
 * @param {string} text
 * @param {Ctx} ctx
 * @returns {string}
 */
export function renderProse(text, ctx) {
  text = resolveDestinationBindings(text, ctx);
  return (ctx.md ?? md).render(text, {
    resolveBinding: (/** @type {string} */ expr) => resolveBindingHtml(expr, ctx)
  });
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
    // Capture the path plus an optional `| formatter:arg | …` pipe chain. Pipe
    // arguments may not contain `}` (they may be quoted), so the chain runs to
    // the first closing brace.
    const match = /^\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:\|[^}]*)?)\}/.exec(
      state.src.slice(state.pos)
    );
    if (!match) return false;
    const resolve = state.env?.resolveBinding;
    const html = resolve ? resolve(match[1].trim()) : null;
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
 * Resolve a `{ name.path }` binding to HTML: loop item span, static value, or
 * a reactive bind span. Returns null when nothing in scope matches.
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string | null}
 */
function resolveBindingHtml(expr, ctx) {
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
      throw new Error(
        `"{ ${expr} }" uses the loop meta variable "${head}" outside a @loop in ${ctx.file}. Move it into a loop body, or rename your value.`
      );
    if (ctx.loopItem) return `<span data-wd-each-meta="${LOOP_META[head]}"${fmt}></span>`; // reactive: filled per row
    // static: the value is in scope (injected by staticUnroll); fall through.
  }

  if (ctx.loopItem && head === ctx.loopItem) {
    const rest = segs.slice(1).join(".");
    return `<span data-wd-each${rest ? ` data-wd-path="${escapeHtml(rest)}"` : ""}${fmt}></span>`;
  }

  const staticValue = lookupVar(ctx.scope, head);
  if (staticValue.found) {
    const resolved = getPath(staticValue.value, segs.slice(1));
    return escapeHtml(interpolateLeaf(fold(resolved), expr, ctx));
  }

  const key = resolveStateKey(head, ctx);
  if (key) {
    ctx.comp.assets.runtime = true;
    const initial = getPath(ctx.comp.state.get(key), segs.slice(1));
    const rest = segs.slice(1).join(".");
    const pathAttr = rest ? ` data-wd-path="${escapeHtml(rest)}"` : "";
    return `<span data-wd-bind="${key}"${pathAttr}${fmt}>${escapeHtml(interpolateLeaf(fold(initial), expr, ctx))}</span>`;
  }

  return null;
}
