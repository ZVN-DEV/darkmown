import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true });
md.use(bindingPlugin);

const pageIncludeExtensions = [".md", ".wd"];

export function compilePage(file, context) {
  const compiled = compileDocument(file, context);
  const title = compiled.meta.title || "Darkmown";
  const description = compiled.meta.description || "";
  const descriptionTag = description
    ? `\n  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">`
    : "";
  const favicon = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2318221d'/%3E%3Ctext%20x='16'%20y='23'%20text-anchor='middle'%20font-family='Georgia,serif'%20font-size='19'%20font-weight='bold'%20fill='%23f7f3ea'%3ED%3C/text%3E%3C/svg%3E";
  const cssLinks = [...compiled.assets.skins].map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
  const scriptSrcs = compiled.assets.runtime ? ["/__wd/runtime.js", ...compiled.assets.scripts] : [...compiled.assets.scripts];
  const scripts = scriptSrcs.map((src) => `<script type="module" src="${src}"></script>`).join("\n");
  // View transitions are temporarily disabled: cross-document @view-transition
  // render-blocked deployed pages (rAF stalled, navigation hangs). Tracked for
  // reintroduction with proper activation fallbacks.
  const transitions = "";

  return {
    meta: compiled.meta,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${descriptionTag}
  <link rel="icon" href="${favicon}">
  ${cssLinks}${transitions}
</head>
<body>
${compiled.html}
${scripts}
</body>
</html>`,
    assets: compiled.assets,
    warnings: compiled.warnings
  };
}

export function compileDocument(file, context, stack = [], vars = {}) {
  const comp = createCompilation();
  const result = compileFile(file, context, stack, createScope(null, vars), comp, [], null);
  return { meta: result.meta, html: result.html, assets: comp.assets, warnings: comp.warnings };
}

function createCompilation() {
  return {
    assets: { skins: new Set(), scripts: new Set(), files: new Map(), runtime: false },
    state: new Map(),
    warnings: [],
    sectionCounter: 0
  };
}

function createScope(parent, vars = {}) {
  return { parent, vars: { ...vars } };
}

function compileFile(file, context, stack, scope, comp, sections, loopItem) {
  const real = fs.realpathSync(file);
  if (stack.includes(real)) {
    throw new Error(`Include cycle detected: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`);
  }

  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  collectColocatedAssets(file, context, comp.assets);

  if (path.extname(file) === ".md") {
    scanMarkdownHints(body, file, comp);
    return { meta, html: md.render(body, {}) };
  }

  const ctx = { file, context, stack: [...stack, real], scope, comp, sections, loopItem };
  return { meta, html: compileBody(body.replace(/\r\n?/g, "\n").split("\n"), ctx) };
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: raw };
  const front = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const meta = {};
  for (const line of front.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) meta[match[1]] = stripQuotes(match[2]);
  }
  return { meta, body };
}

// ---------------------------------------------------------------------------
// Block parser: directives + prose segments
// ---------------------------------------------------------------------------

function compileBody(lines, ctx) {
  const out = [];
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
      out.push(handleLoop(line, block.body, ctx));
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
    const demo = renderDemoDirective(line);
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

function scanBlock(lines, start, openRe, endToken, file) {
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

function scanContainer(lines, start, file) {
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

function scanConditional(lines, start, file) {
  const truthy = [];
  const falsy = [];
  let current = truthy;
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
      if (depth === 0) return { truthy, falsy, end: i };
      depth--;
    }
    if (line.trim() === ":else" && depth === 0) {
      current = falsy;
      continue;
    }
    current.push(line);
  }
  throw new Error(`Missing :endif for "${lines[start]}" in ${file}`);
}

// ---------------------------------------------------------------------------
// Directive handlers
// ---------------------------------------------------------------------------

function handleInclude(line, ctx) {
  const match = line.match(/^@include\s+(\S+)(?:\s+with\s+(.+))?$/);
  if (!match) throw new Error(`Malformed @include in ${ctx.file}: ${line}`);
  const target = resolveInclude(match[1], ctx.file, ctx.context);
  const args = parseIncludeArgs(match[2] || "", ctx);
  const scope = createScope(ctx.scope, args);
  const child = compileFile(target, ctx.context, ctx.stack, scope, ctx.comp, ctx.sections, ctx.loopItem);
  return child.html;
}

function parseIncludeArgs(raw, ctx) {
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

function handleContainer(header, bodyLines, ctx) {
  const tokens = header.split(/\s+/);
  let tag = "section";
  let extraClass = [];
  let id = "";
  let nameToken = tokens[0] && !tokens[0].startsWith("#") && !tokens[0].startsWith(".") ? tokens.shift() : "section";
  if (nameToken !== "section") {
    tag = "div";
    extraClass.push(nameToken);
  }
  for (const token of tokens) {
    if (token.startsWith("#")) id = token.slice(1);
    else if (token.startsWith(".")) extraClass.push(token.slice(1));
    else throw new Error(`Unexpected token "${token}" in container "::: ${header}" in ${ctx.file}`);
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
  return `<${tag}${idAttr}${classAttr}>\n${inner}\n</${tag}>`;
}

function handleState(line, ctx) {
  const match = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)(\s+persist)?$/);
  if (!match) throw new Error(`Malformed :state in ${ctx.file}: ${line}`);
  const value = parseStateValue(match[2]);
  const key = declareState(match[1], value, ctx);
  const persistAttr = match[3] ? ` data-wd-persist="${key}"` : "";
  return `<script type="application/json" data-wd-state${persistAttr}>${safeScriptJson({ [key]: value })}</script>`;
}

function declareState(name, value, ctx) {
  if (ctx.loopItem) throw new Error(`State cannot be declared inside a reactive @loop body (${ctx.file})`);
  const key = ctx.sections.length ? `${ctx.sections.at(-1)}:${name}` : name;
  if (ctx.comp.state.has(key)) throw new Error(`State "${name}" is declared twice in the same scope (${ctx.file})`);
  ctx.comp.state.set(key, value);
  ctx.comp.assets.runtime = true;
  return key;
}

function handleFetch(line, ctx) {
  const match = line.match(/^:fetch\s+([A-Za-z_$][\w$]*)\s+from\s+("[^"]+"|\S+?)(\s+when=visible)?\s*$/);
  if (!match) {
    throw new Error(`Malformed :fetch in ${ctx.file}: ${line}. Use: :fetch posts from "/api/posts.json" [when=visible]`);
  }
  const key = declareState(match[1], null, ctx);
  declareErrorState(key, ctx);
  const url = stripQuotes(match[2]);
  const when = match[3] ? ` data-wd-fetch-when="visible"` : "";
  return `<span data-wd-fetch data-wd-fetch-key="${key}" data-wd-fetch-url="${escapeHtml(url)}"${when}></span>`;
}

function declareErrorState(key, ctx) {
  const errorKey = `${key}_error`;
  if (!ctx.comp.state.has(errorKey)) ctx.comp.state.set(errorKey, null);
}

function handleComputed(line, ctx) {
  const match = line.match(/^:computed\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (!match) throw new Error(`Malformed :computed in ${ctx.file}: ${line}. Use: :computed total = items.length * 4`);
  const expr = compileComputedExpr(match[2].trim(), ctx);
  let initial;
  try {
    const read = (key, path) => getPath(ctx.comp.state.get(key), path ? path.split(".") : []);
    initial = new Function("S", `return (${expr});`)(read);
  } catch {
    initial = null;
  }
  const key = declareState(match[1], initial ?? null, ctx);
  return `<span data-wd-computed data-wd-computed-key="${key}" data-wd-computed-expr="${escapeHtml(expr)}"></span><script type="application/json" data-wd-state>${safeScriptJson({ [key]: initial ?? null })}</script>`;
}

function compileComputedExpr(raw, ctx) {
  const strings = [];
  let expr = raw.replace(/"[^"\\]*"|'[^'\\]*'/g, (literal) => {
    strings.push(`"${literal.slice(1, -1)}"`);
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

function handleForm(line, bodyLines, ctx) {
  let rest = line.slice(":form".length).trim();
  const action = rest.match(/action="([^"]+)"/)?.[1];
  const method = rest.match(/method="([^"]+)"/)?.[1] || "post";
  const into = rest.match(/(?:^|\s)into\s+([A-Za-z_$][\w$]*)/)?.[1];
  const leftover = rest
    .replace(/action="[^"]+"/, "")
    .replace(/method="[^"]+"/, "")
    .replace(/(?:^|\s)into\s+[A-Za-z_$][\w$]*/, "")
    .trim();
  if ((!action && !into) || leftover) {
    throw new Error(
      `Malformed :form in ${ctx.file}: ${line}. Use ':form into name' (client state), ':form action="/url"' (native post), or both (fetch round-trip into state).`
    );
  }
  const inner = compileBody(bodyLines, ctx).trim();
  if (!into) {
    return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}">${inner}</form>`;
  }
  const key = declareState(into, null, ctx);
  declareErrorState(key, ctx);
  const actionAttrs = action ? ` action="${escapeHtml(action)}" method="${escapeHtml(method)}"` : "";
  return `<script type="application/json" data-wd-state>${safeScriptJson({ [key]: null })}</script><form data-wd-form="${key}"${actionAttrs}>${inner}</form>`;
}

function handleInput(line, ctx) {
  const match = line.match(/^:input\s+([A-Za-z_][\w-]*)\s*(.*)$/);
  if (!match) throw new Error(`Malformed :input in ${ctx.file}: ${line}`);
  const attrs = [`name="${escapeHtml(match[1])}"`];
  let type = "text";
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
    if (!["placeholder", "value", "min", "max", "step", "pattern", "autocomplete"].includes(token[1])) {
      throw new Error(`Unknown :input attribute "${token[1]}" in ${ctx.file}`);
    }
    attrs.push(`${token[1]}="${escapeHtml(value)}"`);
  }
  return `<input type="${escapeHtml(type)}" ${attrs.join(" ")}>`;
}

function handleSubmit(line, ctx) {
  const match = line.match(/^:submit\s+"([^"]+)"\s*$/);
  if (!match) throw new Error(`Malformed :submit in ${ctx.file}: ${line}. Use: :submit "Label"`);
  return `<button type="submit">${escapeHtml(match[1])}</button>`;
}

function handleButton(line, ctx) {
  const match = line.match(/^:button\s+"([^"]+)"\s*->\s*(.+)$/);
  if (!match) throw new Error(`Malformed :button in ${ctx.file}: ${line}`);
  ctx.comp.assets.runtime = true;
  const action = parseAction(match[2], ctx);
  const valueAttr = action.value === undefined ? "" : ` data-wd-value="${escapeHtml(JSON.stringify(action.value))}"`;
  return `<button type="button" data-wd-action="${action.op}" data-wd-target="${action.target}"${valueAttr}>${escapeHtml(match[1])}</button>`;
}

function handleIf(line, truthyLines, falsyLines, ctx) {
  const match = line.match(/^:if\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*$/);
  if (!match) throw new Error(`Malformed :if in ${ctx.file}: ${line}. Use ":if name" with a :state or in-scope value.`);
  const segs = match[1].split(".");
  const head = segs[0];

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

function handleLoop(line, bodyLines, ctx) {
  const match = line.match(/^@loop\s+(.+?)\s+into\s+([A-Za-z_$][\w$]*)\s*$/);
  if (!match) throw new Error(`Malformed @loop in ${ctx.file}: ${line}. Use: @loop <things> into <thing>`);
  const source = stripQuotes(match[1].trim());
  const itemName = match[2];

  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source.endsWith(".json")) {
    const dataFile = resolveInclude(source, ctx.file, ctx.context, true);
    const rows = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(rows)) throw new Error(`@loop data must be a JSON array: ${dataFile}`);
    return staticUnroll(rows, itemName, bodyLines, ctx);
  }

  const resolved = lookupPath(source, ctx);
  if (resolved.found) {
    if (!Array.isArray(resolved.value)) {
      throw new Error(`@loop ${source} in ${ctx.file} found an in-scope value, but it is not a list`);
    }
    return staticUnroll(resolved.value, itemName, bodyLines, ctx);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(source)) {
    const key = resolveStateKey(source, ctx);
    if (key) return reactiveLoop(key, itemName, bodyLines, ctx);
  }

  throw new Error(
    `@loop source "${source}" in ${ctx.file} was not found. Loop over a JSON file (@loop /data.json into row), an in-scope value, or a :state list.`
  );
}

function staticUnroll(rows, itemName, bodyLines, ctx) {
  const out = [];
  for (const row of rows) {
    const rowCtx = { ...ctx, scope: createScope(ctx.scope, { [itemName]: row }) };
    out.push(compileBody(bodyLines, rowCtx));
  }
  return out.join("\n");
}

function reactiveLoop(key, itemName, bodyLines, ctx) {
  ctx.comp.assets.runtime = true;
  const templateCtx = { ...ctx, loopItem: itemName, scope: createScope(ctx.scope) };
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

  const rows = Array.isArray(ctx.comp.state.get(key)) ? ctx.comp.state.get(key) : [];
  const counts = new Map();
  const initial = rows
    .map((item) => {
      const itemKey = loopKeyOf(item, counts);
      return fillTemplateString(withLoopKey(itemTemplate, itemKey), item);
    })
    .join("");

  return `<div data-wd-loop="${key}"><template data-wd-loop-template>${itemTemplate}</template><${wrapperTag} data-wd-loop-out>${initial}</${wrapperTag}></div>`;
}

function withLoopKey(template, itemKey) {
  return template.replace(/^<([a-zA-Z][a-zA-Z0-9-]*)/, `<$1 data-wd-loop-key="${escapeHtml(itemKey)}"`);
}

function fillTemplateString(template, item) {
  // Resolve per-item :if regions first (recursively, so nested conditionals are
  // pre-rendered for the initial paint), then fill the plain text bindings.
  return fillEachText(fillEachIfRegions(template, item), item);
}

// Walk the string resolving only the OUTERMOST data-wd-each-if regions; each
// chosen branch is recursed so nested conditionals resolve too. The <template>
// markup is left pristine so the runtime can keep toggling branches.
function fillEachIfRegions(str, item) {
  const marker = '<span data-wd-each-if ';
  let result = "";
  let i = 0;
  for (;;) {
    const start = str.indexOf(marker, i);
    if (start === -1) return result + str.slice(i);
    result += str.slice(i, start);
    const end = matchElement(str, start, "span");
    result += fillOneEachIf(str.slice(start, end), item);
    i = end;
  }
}

function fillOneEachIf(region, item) {
  const path = (region.match(/^<span data-wd-each-if data-wd-path="([^"]*)">/) || [, ""])[1];
  const trueStart = region.indexOf("<template data-wd-if-true>");
  const trueEnd = matchElement(region, trueStart, "template");
  const falseStart = region.indexOf("<template data-wd-if-false>", trueEnd);
  const falseEnd = matchElement(region, falseStart, "template");
  const open = "<template data-wd-if-true>".length;
  const close = "</template>".length;
  const truthy = region.slice(trueStart + open, trueEnd - close);
  const falsy = region.slice(falseStart + "<template data-wd-if-false>".length, falseEnd - close);
  const branch = getPath(item, path ? path.split(".") : []) ? truthy : falsy;
  const head = region.slice(0, falseEnd);
  return `${head}<span data-wd-each-if-out>${fillEachIfRegions(branch, item)}</span></span>`;
}

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

export function loopKeyOf(item, counts) {
  const base =
    item && typeof item === "object"
      ? String(item.id ?? item.key ?? JSON.stringify(item))
      : String(item);
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}

function renderDemoDirective(line) {
  const tryMatch = line.match(/^:try\s+"([^"]+)"\s+href="([^"]+)"$/);
  if (tryMatch) return `<a class="try-card" href="${tryMatch[2]}"><span>Try</span>${escapeHtml(tryMatch[1])}</a>`;
  const note = line.match(/^:note\s+"([^"]+)"$/);
  if (note) return `<aside class="note">${escapeHtml(note[1])}</aside>`;
  const sprint = line.match(/^:sprint\s+min=(\d+)\s+max=(\d+)\s+roles="([^"]+)"$/);
  if (sprint) {
    const roles = sprint[3].split(",").map((role) => role.trim()).filter(Boolean);
    return `<section class="sprint-board" data-min="${sprint[1]}" data-max="${sprint[2]}">${roles.map((role) => `<article><strong>${escapeHtml(role)}</strong><span>active lane</span></article>`).join("")}</section>`;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Interpolation: one syntax, { name } / { name.path }
// ---------------------------------------------------------------------------

function renderProse(text, ctx) {
  return md.render(text, { resolveBinding: (expr) => resolveBindingHtml(expr, ctx) });
}

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

function resolveBindingHtml(expr, ctx) {
  const segs = expr.split(".");
  const head = segs[0];

  if (ctx.loopItem && head === ctx.loopItem) {
    const rest = segs.slice(1).join(".");
    return `<span data-wd-each${rest ? ` data-wd-path="${escapeHtml(rest)}"` : ""}></span>`;
  }

  const staticValue = lookupVar(ctx.scope, head);
  if (staticValue.found) {
    return escapeHtml(getPath(staticValue.value, segs.slice(1)) ?? "");
  }

  const key = resolveStateKey(head, ctx);
  if (key) {
    ctx.comp.assets.runtime = true;
    const initial = getPath(ctx.comp.state.get(key), segs.slice(1));
    const rest = segs.slice(1).join(".");
    const pathAttr = rest ? ` data-wd-path="${escapeHtml(rest)}"` : "";
    return `<span data-wd-bind="${key}"${pathAttr}>${escapeHtml(initial ?? "")}</span>`;
  }

  return null;
}

function lookupVar(scope, name) {
  for (let current = scope; current; current = current.parent) {
    if (name in current.vars) return { found: true, value: current.vars[name] };
  }
  return { found: false };
}

function lookupPath(expr, ctx) {
  const segs = expr.split(".");
  const head = lookupVar(ctx.scope, segs[0]);
  if (!head.found) return { found: false };
  return { found: true, value: getPath(head.value, segs.slice(1)) };
}

function getPath(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (["constructor", "prototype", "__proto__"].includes(segment)) return undefined;
    current = current[segment];
  }
  return current;
}

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

function parseAction(raw, ctx) {
  const expression = raw.trim();
  const resolveTarget = (name) => {
    const key = resolveStateKey(name, ctx);
    if (!key) {
      throw new Error(`Button action targets unknown state "${name}" in ${ctx.file}. Declare it first with :state ${name} = ...`);
    }
    return key;
  };

  const increment = expression.match(/^([A-Za-z_$][\w$]*)\+\+$/);
  if (increment) return { op: "inc", target: resolveTarget(increment[1]) };
  const decrement = expression.match(/^([A-Za-z_$][\w$]*)--$/);
  if (decrement) return { op: "dec", target: resolveTarget(decrement[1]) };
  const add = expression.match(/^([A-Za-z_$][\w$]*)\s*\+=\s*(.+)$/);
  if (add) {
    const target = resolveTarget(add[1]);
    const value = parseActionLiteral(add[2]);
    if (Array.isArray(ctx.comp.state.get(target))) return { op: "append", target, value };
    if (typeof value === "number") return { op: "add", target, value };
    throw new Error(`Unsupported button action "${raw}". += with non-number values requires a list state target.`);
  }
  const assign = expression.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (assign) return { op: "set", target: resolveTarget(assign[1]), value: parseActionLiteral(assign[2]) };
  throw new Error(`Unsupported button action "${raw}". Supported actions: count++, count--, count += 1, items += "value", name = "value".`);
}

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
      throw new Error(`Unsupported action literal "${raw}". Use a quoted string, number, boolean, null, or valid JSON.`);
    }
  }
  throw new Error(`Unsupported action literal "${raw}". Use a quoted string, number, boolean, null, or valid JSON.`);
}

// ---------------------------------------------------------------------------
// Includes / assets
// ---------------------------------------------------------------------------

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

function isAllowedInclude(file, context) {
  const roots = [context.routesRoot, context.shelfRoot].map((root) => path.resolve(root));
  return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`));
}

// ---------------------------------------------------------------------------
// Plain .md hints
// ---------------------------------------------------------------------------

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

function safeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

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

function parseScalar(raw) {
  const trimmed = raw.trim();
  if (/^["']/.test(trimmed)) return stripQuotes(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, "") ?? "";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
