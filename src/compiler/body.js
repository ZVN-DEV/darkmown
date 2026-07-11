// ---------------------------------------------------------------------------
// Block parser: directives + prose segments. `compileBody` walks a `.wd` body
// line-by-line, honoring fenced code, dispatching each directive opener to its
// handler (passing the 0-based line index so malformed errors report file:line)
// and flushing intervening prose through the markdown layer. The block scanners
// (`scanBlock`/`scanContainer`/`scanConditional`/`splitEmptyBranch`) capture
// multi-line directive bodies with nesting + fence awareness.
// ---------------------------------------------------------------------------

import { at } from "./context.js";
import {
  handleBind,
  handleButton,
  handleCarousel,
  handleChoiceGroup,
  handleComputed,
  handleContainer,
  handleEffect,
  handleEmbed,
  handleEvery,
  handleFetch,
  handleForm,
  handleIf,
  handleInclude,
  handleInput,
  handleMedia,
  handleSelect,
  handleSlider,
  handleState,
  handleStore,
  handleSubmit,
  handleTextarea,
  handleTheme,
  renderDemoDirective
} from "./directives.js";
import { handleLoop } from "./loops.js";
import { renderProse } from "./markdown.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

/**
 * Parse a `.wd` body line-by-line into HTML, mixing directives and prose.
 * @param {string[]} lines
 * @param {Ctx} ctx
 * @returns {string}
 */
export function compileBody(lines, ctx) {
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
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      prose.push(line);
      continue;
    }

    if (/^@include\s/.test(line)) {
      flush();
      out.push(handleInclude(line, ctx, i));
      continue;
    }
    if (/^@loop\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^@loop\s/, "@endloop", ctx);
      const split = splitEmptyBranch(block.body);
      out.push(handleLoop(line, split.body, split.empty, ctx, i, split.emptyStart));
      i = block.end;
      continue;
    }
    const container = line.match(/^:::\s*(.*)$/);
    if (container) {
      flush();
      if (!container[1].trim())
        throw new Error(`Stray ::: close with no open container in ${ctx.file}`);
      const block = scanContainer(lines, i, ctx);
      out.push(handleContainer(container[1].trim(), block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:state\s/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      out.push(handleState(v.line, ctx, i));
      i = v.end;
      continue;
    }
    if (/^:store\s/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      out.push(handleStore(v.line, ctx, i));
      i = v.end;
      continue;
    }
    if (/^:fetch\s/.test(line)) {
      flush();
      out.push(handleFetch(line, ctx, i));
      continue;
    }
    if (/^:computed\s/.test(line)) {
      flush();
      out.push(handleComputed(line, ctx, i));
      continue;
    }
    if (/^:effect\s/.test(line)) {
      flush();
      out.push(handleEffect(line, ctx, i));
      continue;
    }
    if (/^:every\s/.test(line)) {
      flush();
      out.push(handleEvery(line, ctx, i));
      continue;
    }
    if (/^:theme(?:\s|$)/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      out.push(handleTheme(v.line, ctx, i));
      i = v.end;
      continue;
    }
    const media = line.match(/^:(video|audio)\s/);
    if (media) {
      flush();
      out.push(handleMedia(line, /** @type {"video" | "audio"} */ (media[1]), ctx, i));
      continue;
    }
    if (/^:embed\s/.test(line)) {
      flush();
      out.push(handleEmbed(line, ctx, i));
      continue;
    }
    if (/^:form\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^:form\s/, ":endform", ctx);
      out.push(handleForm(line, block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:carousel(?:\s|$)/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^:carousel(?:\s|$)/, ":endcarousel", ctx);
      out.push(handleCarousel(line, block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:input\s/.test(line)) {
      flush();
      out.push(handleInput(line, ctx, i));
      continue;
    }
    if (/^:textarea\s/.test(line)) {
      flush();
      out.push(handleTextarea(line, ctx, i));
      continue;
    }
    if (/^:select\s/.test(line)) {
      flush();
      const opts = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        opts.push(lines[j]);
        j++;
      }
      out.push(handleSelect(line, opts, ctx, i));
      i = j - 1;
      continue;
    }
    const choiceMatch = line.match(/^:(checkbox|radio)\s/);
    if (choiceMatch) {
      flush();
      const opts = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        opts.push(lines[j]);
        j++;
      }
      out.push(
        handleChoiceGroup(line, opts, ctx, /** @type {"checkbox" | "radio"} */ (choiceMatch[1]), i)
      );
      i = j - 1;
      continue;
    }
    if (/^:bind\s/.test(line)) {
      flush();
      out.push(handleBind(line, ctx, i));
      continue;
    }
    if (/^:slider\s/.test(line)) {
      flush();
      out.push(handleSlider(line, ctx, i));
      continue;
    }
    if (/^:submit\s/.test(line)) {
      flush();
      out.push(handleSubmit(line, ctx, i));
      continue;
    }
    if (/^:button\s/.test(line)) {
      flush();
      out.push(handleButton(line, ctx, i));
      continue;
    }
    if (/^:if\s/.test(line)) {
      flush();
      const block = scanConditional(lines, i, ctx);
      out.push(handleIf(line, block.truthy, block.falsy, ctx, i, block.falsyStart));
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
      throw new Error(
        `@repeat was replaced by @loop in ${ctx.file}. Use: @loop /data.json into item ... @endloop`
      );
    }
    if (/^:for\b/.test(line)) {
      throw new Error(
        `:for was replaced by @loop in ${ctx.file}. Use: @loop items into item ... @endloop`
      );
    }
    if (/^(@endloop|:endif|:endfor|:endform|:else)\s*$/.test(line)) {
      throw new Error(`Stray "${line.trim()}" with no matching opener in ${ctx.file}`);
    }
    warnUnknownDirective(line, ctx);
    prose.push(line);
  }

  flush();
  return out.join("\n");
}

// Lines that reached prose but LOOK like a directive (a `@word`/`:word` token at
// the very start, followed by a space or end of line) and match no handler are
// almost always a typo — every real directive was intercepted above. Warn, never
// throw: prose legitimately contains `@` and `:`, so the match is deliberately
// narrow (lowercase token + boundary; emoji shortcodes, times, and `@user`
// followed by punctuation do not match).
const KNOWN_DIRECTIVE =
  /^(?:@(?:include|loop|empty|endloop)|:(?:state|store|fetch|computed|effect|every|theme|video|audio|embed|form|endform|input|textarea|select|checkbox|radio|bind|submit|button|if|endif|else|try|note|sprint))(?:\s|$)/;
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {void}
 */
function warnUnknownDirective(line, ctx) {
  // Catch capitalized (`:State`) and hyphenated (`:end-loop`) typos too — the
  // known-directive whitelist stays case-sensitive, so a mis-cased real
  // directive correctly trips the warning. Still unindented-only, to keep prose
  // that legitimately starts lines with `@`/`:` from false-positiving.
  const m = line.match(/^([@:][A-Za-z][A-Za-z-]*)(?:\s|$)/);
  if (m && !KNOWN_DIRECTIVE.test(line)) {
    ctx.comp.warnings.push(
      `${ctx.file}: "${m[1]}" looks like a directive but matches none — it will render as literal text. Check the spelling (e.g. @loop, @include, :state, :if).`
    );
  }
}

/**
 * Net bracket depth of a string, ignoring brackets inside JSON string literals.
 * Positive means more openers (`[`/`{`) than closers — the value is unbalanced.
 * @param {string} s
 * @returns {number}
 */
function bracketDepth(s) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
  }
  return depth;
}

/**
 * `:state`/`:store`/`:theme` take a single-line value, but a JSON array/object
 * seed reads far better across several lines. When the value after `=` opens an
 * unbalanced `[`/`{` on the directive line, gather the contiguous continuation
 * lines (stopping at a blank line, which delimits the literal) until the brackets
 * balance, then collapse them into one physical line the existing single-line
 * handler parses unchanged — JSON ignores the inter-token whitespace. A literal
 * that never balances falls through as-is, so `parseStateValue` reports it.
 * @param {string[]} lines
 * @param {number} start Index of the directive line.
 * @returns {{ line: string, end: number }} `end` = last consumed line index.
 */
function joinValueDirective(lines, start) {
  const opener = lines[start];
  const eq = opener.indexOf("=");
  if (eq === -1) return { line: opener, end: start };
  const value = opener.slice(eq + 1);
  // Only a JSON array/object literal can span lines; bare scalars/strings cannot.
  if (!/^\s*[[{]/.test(value)) return { line: opener, end: start };
  let depth = bracketDepth(value);
  if (depth <= 0) return { line: opener, end: start }; // already balanced on one line
  const parts = [opener];
  let i = start;
  while (depth > 0 && i + 1 < lines.length && lines[i + 1].trim() !== "") {
    i++;
    parts.push(lines[i]);
    depth += bracketDepth(lines[i]);
  }
  return { line: parts.join(" "), end: i };
}

/**
 * Capture lines from an opener until a matching close token, honoring nesting and fences.
 * @param {string[]} lines
 * @param {number} start Index of the opening line.
 * @param {RegExp} openRe Pattern that re-opens a nested block.
 * @param {string} endToken Literal closing token (e.g. `@endloop`).
 * @param {Ctx} ctx Compile context, for `file:line` errors.
 * @returns {{ body: string[], end: number }}
 */
function scanBlock(lines, start, openRe, endToken, ctx) {
  /** @type {string[]} */
  const body = [];
  let depth = 0;
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
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
  throw new Error(`Missing ${endToken} for "${lines[start]}" in ${at(ctx, start)}`);
}

/**
 * Split a `@loop` body at a top-level `@empty` into the rows body and the empty
 * branch. Honors nested `@loop … @endloop` (so an inner loop's `@empty` is not
 * mistaken for the outer one) and fenced code. `emptyStart` is the index within
 * `body` the empty branch starts at (the line after `@empty`), so nested errors
 * in that branch still report the true file line.
 * @param {string[]} body
 * @returns {{ body: string[], empty: string[] | null, emptyStart: number }}
 */
function splitEmptyBranch(body) {
  /** @type {string[]} */
  const rows = [];
  /** @type {string[] | null} */
  let empty = null;
  let emptyStart = 0;
  let target = rows;
  let depth = 0;
  let fence = null;
  for (let i = 0; i < body.length; i++) {
    const line = body[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      target.push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      target.push(line);
      continue;
    }
    if (/^@loop\s/.test(line)) depth++;
    if (line.trim() === "@endloop") depth--;
    if (depth === 0 && line.trim() === "@empty") {
      empty = [];
      emptyStart = i + 1;
      target = empty;
      continue;
    }
    target.push(line);
  }
  return { body: rows, empty, emptyStart };
}

/**
 * Capture the body of a `:::` container up to its matching close, honoring nesting.
 * @param {string[]} lines
 * @param {number} start Index of the opening line.
 * @param {Ctx} ctx Compile context, for `file:line` errors.
 * @returns {{ body: string[], end: number }}
 */
function scanContainer(lines, start, ctx) {
  /** @type {string[]} */
  const body = [];
  let depth = 0;
  let fence = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
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
  throw new Error(`Missing closing ::: for "${lines[start]}" in ${at(ctx, start)}`);
}

/**
 * Split an `:if … :else if … :else … :endif` chain into the first condition's
 * truthy body and a falsy body. A bare `:else` works as before. The first
 * `:else if B` is **desugared** into a nested `:if` that lives in the falsy
 * branch: the falsy body becomes `[":if B", …rest…, ":endif"]`, which re-enters
 * `compileBody`/`handleIf` recursively. A whole `:if/:else if/:else` chain
 * therefore compiles to nested `data-wd-if` regions the runtime already drives —
 * identical behavior for static, reactive, and loop-row conditionals.
 *
 * `falsyStart` is the index within `lines` the falsy body starts at — the line
 * after a bare `:else`, or the `:else if` line itself (its synthesized `:if`
 * stands in for it) — so nested errors in that branch report the true file line.
 * @param {string[]} lines
 * @param {number} start Index of the `:if` line.
 * @param {Ctx} ctx Compile context, for `file:line` errors.
 * @returns {{ truthy: string[], falsy: string[], end: number, falsyStart: number }}
 */
function scanConditional(lines, start, ctx) {
  /** @type {string[]} */
  const truthy = [];
  /** @type {string[]} */
  const falsy = [];
  let falsyStart = start + 1;
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
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
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
        return { truthy, falsy, end: i, falsyStart };
      }
      depth--;
    }
    if (depth === 0 && mode !== "elseif") {
      const t = line.trim();
      const elseIf = t.match(/^:else if\s+(.+?)\s*$/);
      if (elseIf) {
        if (mode === "else")
          throw new Error(
            `":else if" after ":else" in ${ctx.file}. ":else" must be the last branch — order the "else if" conditions before the bare ":else".`
          );
        falsy.push(`:if ${elseIf[1]}`); // desugar the chain tail into a nested :if
        falsyStart = i;
        current = falsy;
        mode = "elseif";
        continue;
      }
      if (t === ":else") {
        if (mode === "else")
          throw new Error(
            `Duplicate ":else" in ${ctx.file}. A conditional may have only one bare ":else".`
          );
        falsyStart = i + 1;
        current = falsy;
        mode = "else";
        continue;
      }
    }
    current.push(line);
  }
  throw new Error(`Missing :endif for "${lines[start]}" in ${at(ctx, start)}`);
}
