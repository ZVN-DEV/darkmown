// ---------------------------------------------------------------------------
// Block parser: directives + prose segments. `compileBody` walks a `.wd` body
// line-by-line, honoring fenced code, dispatching each directive opener to its
// handler (passing the 0-based line index so malformed errors report file:line)
// and flushing intervening prose through the markdown layer. The block scanners
// (`scanBlock`/`scanContainer`/`scanConditional`/`splitEmptyBranch`) capture
// multi-line directive bodies with nesting + fence awareness.
// ---------------------------------------------------------------------------

import { at, lineOf, stampBlockEnd, wdError } from "./context.js";
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
import { handleLoop, spliceTables } from "./loops.js";
import { renderProse } from "./markdown.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// The directives that REQUIRE arguments, mapped to the handler that owns their
// `Use:` hint. Each entry is called with the bare line and an empty body, and
// every one of them throws — the block openers included, because their argument
// check runs before they ever look at a body. `:theme` and `:carousel` are
// deliberately absent: both are valid bare, and both dispatchers already accept
// `(?:\s|$)`.
/** @type {Record<string, (line: string, ctx: Ctx, index: number) => unknown>} */
const BARE_DIRECTIVE = {
  "@include": (line, ctx, i) => handleInclude(line, ctx, i),
  "@loop": (line, ctx, i) => handleLoop(line, [], null, ctx, i),
  ":state": (line, ctx, i) => handleState(line, ctx, i),
  ":store": (line, ctx, i) => handleStore(line, ctx, i),
  ":fetch": (line, ctx, i) => handleFetch(line, ctx, i),
  ":computed": (line, ctx, i) => handleComputed(line, ctx, i),
  ":effect": (line, ctx, i) => handleEffect(line, ctx, i),
  ":every": (line, ctx, i) => handleEvery(line, ctx, i),
  ":video": (line, ctx, i) => handleMedia(line, "video", ctx, i),
  ":audio": (line, ctx, i) => handleMedia(line, "audio", ctx, i),
  ":embed": (line, ctx, i) => handleEmbed(line, ctx, i),
  ":form": (line, ctx, i) => handleForm(line, [], ctx, i),
  ":input": (line, ctx, i) => handleInput(line, ctx, i),
  ":textarea": (line, ctx, i) => handleTextarea(line, ctx, i),
  ":select": (line, ctx, i) => handleSelect(line, [], ctx, i),
  ":checkbox": (line, ctx, i) => handleChoiceGroup(line, [], ctx, "checkbox", i),
  ":radio": (line, ctx, i) => handleChoiceGroup(line, [], ctx, "radio", i),
  ":bind": (line, ctx, i) => handleBind(line, ctx, i),
  ":slider": (line, ctx, i) => handleSlider(line, ctx, i),
  ":submit": (line, ctx, i) => handleSubmit(line, ctx, i),
  ":button": (line, ctx, i) => handleButton(line, ctx, i),
  ":if": (line, ctx, i) => handleIf(line, [], [], ctx, i)
};

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
  // The slice index the pending prose run starts at, so a warning raised while
  // rendering it (an unbindable value in a link destination or in raw HTML)
  // reports the offending line and not the top of the file.
  let proseStart = 0;
  let fence = null;

  // Append one chunk, splicing it into the previous one when the seam between
  // them is a table split in half. Markdown only sees a table when a header row
  // is followed by a `|---|` separator, so `| Name | N |` + `|---|---|` in the
  // prose ABOVE a loop compiles to a header-only table, and the loop's rows
  // compile separately: the two halves have to be stitched back together here,
  // where prose output and handler output meet. Every other seam falls through
  // to the plain newline join, so all other output is byte-identical.
  const push = (/** @type {string} */ html) => {
    const last = out.length - 1;
    const merged = last >= 0 ? spliceTables(out[last], html) : null;
    if (merged === null) out.push(html);
    else out[last] = merged;
  };

  const flush = () => {
    if (!prose.length) return;
    const text = prose.join("\n");
    const start = proseStart;
    prose = [];
    if (text.trim()) push(renderProse(text, ctx, start));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!prose.length) proseStart = i;
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

    // A directive name ALONE on a line is a mistake with one obvious fix: it is
    // missing its arguments. Every dispatcher below requires a space after the
    // keyword, so such a line used to fall through to prose — and because
    // `KNOWN_DIRECTIVE` accepted `(?:\s|$)`, even the "looks like a directive"
    // warning was suppressed. `:state` on its own rendered as the literal text
    // `:state` with nothing said about it. Hand the line to the directive's OWN
    // handler with an empty body: it throws its own coded malformed error with
    // its own `Use:` hint, so there is exactly one place that owns each hint.
    const bare = line.match(/^([@:][a-z]+)\s*$/);
    if (bare && Object.hasOwn(BARE_DIRECTIVE, bare[1])) {
      flush();
      BARE_DIRECTIVE[bare[1]](line, ctx, i);
    }

    if (/^@include\s/.test(line)) {
      flush();
      push(handleInclude(line, ctx, i));
      continue;
    }
    if (/^@loop\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^@loop\s/, "@endloop", ctx);
      const split = splitEmptyBranch(block.body);
      const loopAt = ctx.comp.symbols.length;
      push(handleLoop(line, split.body, split.empty, ctx, i, split.emptyStart));
      stampBlockEnd(ctx, loopAt, block.end);
      i = block.end;
      continue;
    }
    const container = line.match(/^:::\s*(.*)$/);
    if (container) {
      flush();
      if (!container[1].trim())
        throw wdError(`Stray ::: close with no open container in ${ctx.file}`, {
          code: "WD007",
          file: ctx.file
        });
      const block = scanContainer(lines, i, ctx);
      push(handleContainer(container[1].trim(), block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:state\s/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      push(handleState(v.line, ctx, i));
      i = v.end;
      continue;
    }
    if (/^:store\s/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      push(handleStore(v.line, ctx, i));
      i = v.end;
      continue;
    }
    if (/^:fetch\s/.test(line)) {
      flush();
      push(handleFetch(line, ctx, i));
      continue;
    }
    if (/^:computed\s/.test(line)) {
      flush();
      push(handleComputed(line, ctx, i));
      continue;
    }
    if (/^:effect\s/.test(line)) {
      flush();
      push(handleEffect(line, ctx, i));
      continue;
    }
    if (/^:every\s/.test(line)) {
      flush();
      push(handleEvery(line, ctx, i));
      continue;
    }
    if (/^:theme(?:\s|$)/.test(line)) {
      flush();
      const v = joinValueDirective(lines, i);
      push(handleTheme(v.line, ctx, i));
      i = v.end;
      continue;
    }
    const media = line.match(/^:(video|audio)\s/);
    if (media) {
      flush();
      push(handleMedia(line, /** @type {"video" | "audio"} */ (media[1]), ctx, i));
      continue;
    }
    if (/^:embed\s/.test(line)) {
      flush();
      push(handleEmbed(line, ctx, i));
      continue;
    }
    if (/^:form\s/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^:form\s/, ":endform", ctx);
      push(handleForm(line, block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:carousel(?:\s|$)/.test(line)) {
      flush();
      const block = scanBlock(lines, i, /^:carousel(?:\s|$)/, ":endcarousel", ctx);
      push(handleCarousel(line, block.body, ctx, i));
      i = block.end;
      continue;
    }
    if (/^:input\s/.test(line)) {
      flush();
      push(handleInput(line, ctx, i));
      continue;
    }
    if (/^:textarea\s/.test(line)) {
      flush();
      push(handleTextarea(line, ctx, i));
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
      push(handleSelect(line, opts, ctx, i));
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
      push(
        handleChoiceGroup(line, opts, ctx, /** @type {"checkbox" | "radio"} */ (choiceMatch[1]), i)
      );
      i = j - 1;
      continue;
    }
    if (/^:bind\s/.test(line)) {
      flush();
      push(handleBind(line, ctx, i));
      continue;
    }
    if (/^:slider\s/.test(line)) {
      flush();
      push(handleSlider(line, ctx, i));
      continue;
    }
    if (/^:submit\s/.test(line)) {
      flush();
      push(handleSubmit(line, ctx, i));
      continue;
    }
    if (/^:button\s/.test(line)) {
      flush();
      push(handleButton(line, ctx, i));
      continue;
    }
    if (/^:if\s/.test(line)) {
      flush();
      const block = scanConditional(lines, i, ctx);
      const ifAt = ctx.comp.symbols.length;
      push(handleIf(line, block.truthy, block.falsy, ctx, i, block.falsyStart));
      stampBlockEnd(ctx, ifAt, block.end);
      i = block.end;
      continue;
    }
    const demo = renderDemoDirective(line, ctx);
    if (demo) {
      flush();
      push(demo);
      continue;
    }
    if (/^@repeat\b/.test(line)) {
      throw wdError(
        `@repeat was replaced by @loop in ${ctx.file}. Use: @loop /data.json into item ... @endloop`,
        { code: "WD008", file: ctx.file, hint: "@loop /data.json into item ... @endloop" }
      );
    }
    if (/^:for\b/.test(line)) {
      throw wdError(
        `:for was replaced by @loop in ${ctx.file}. Use: @loop items into item ... @endloop`,
        { code: "WD009", file: ctx.file, hint: "@loop items into item ... @endloop" }
      );
    }
    // `:endcarousel` joins the family: a closer with no opener is a mistake with
    // one obvious fix, and the vague "matches none" warning it used to get named
    // the wrong problem ("check the spelling") for a token spelled correctly.
    // `@empty` too: it is a MID-block marker, consumed by `splitEmptyBranch` when
    // it sits inside a `@loop`, so one reaching here has no loop to belong to and
    // used to render as the literal text `@empty` with nothing said about it.
    if (/^(@endloop|@empty|:endif|:endfor|:endform|:endcarousel|:else)\s*$/.test(line)) {
      throw wdError(`Stray "${line.trim()}" with no matching opener in ${ctx.file}`, {
        code: "WD010",
        file: ctx.file
      });
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
// Keep this in step with the dispatch above: a name listed here but no longer
// handled is the worst outcome — the line renders as literal text AND the
// warning that would have said so is suppressed. (`:note`/`:sprint` were deleted
// from the demo handler and are gone from here for exactly that reason.)
const KNOWN_DIRECTIVE =
  /^(?:(?:@(?:include|loop|empty|endloop)|:(?:state|store|fetch|computed|effect|every|theme|video|audio|embed|form|endform|input|textarea|select|checkbox|radio|bind|slider|submit|button|carousel|endcarousel|if|endif|else))(?:\s|$)|:try\s)/;
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
  throw wdError(`Missing ${endToken} for "${lines[start]}" in ${at(ctx, start)}`, {
    code: "WD011",
    file: ctx.file,
    line: lineOf(ctx, start)
  });
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
  throw wdError(`Missing closing ::: for "${lines[start]}" in ${at(ctx, start)}`, {
    code: "WD012",
    file: ctx.file,
    line: lineOf(ctx, start)
  });
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
          throw wdError(
            `":else if" after ":else" in ${ctx.file}. ":else" must be the last branch — order the "else if" conditions before the bare ":else".`,
            { code: "WD013", file: ctx.file }
          );
        falsy.push(`:if ${elseIf[1]}`); // desugar the chain tail into a nested :if
        falsyStart = i;
        current = falsy;
        mode = "elseif";
        continue;
      }
      if (t === ":else") {
        if (mode === "else")
          throw wdError(
            `Duplicate ":else" in ${ctx.file}. A conditional may have only one bare ":else".`,
            { code: "WD014", file: ctx.file }
          );
        falsyStart = i + 1;
        current = falsy;
        mode = "else";
        continue;
      }
    }
    current.push(line);
  }
  throw wdError(`Missing :endif for "${lines[start]}" in ${at(ctx, start)}`, {
    code: "WD015",
    file: ctx.file,
    line: lineOf(ctx, start)
  });
}
