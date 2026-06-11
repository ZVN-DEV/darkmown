import fs from "node:fs";
import path from "node:path";

export function compilePage(file, context) {
  const compiled = compileDocument(file, context, []);
  const title = compiled.meta.title || "Markie";
  const favicon = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2318221d'/%3E%3Cpath%20d='M9%2022V10h4l3%206%203-6h4v12h-4v-6l-2%204h-2l-2-4v6z'%20fill='%23f7f3ea'/%3E%3C/svg%3E";
  const cssLinks = [...compiled.assets.skins].map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
  const scriptSrcs = compiled.assets.runtime ? ["/__wd/runtime.js", ...compiled.assets.scripts] : [...compiled.assets.scripts];
  const scripts = scriptSrcs.map((src) => `<script type="module" src="${src}"></script>`).join("\n");

  return {
    meta: compiled.meta,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="${favicon}">
  ${cssLinks}
</head>
<body>
${compiled.html}
${scripts}
</body>
</html>`,
    assets: compiled.assets
  };
}

export function compileDocument(file, context, stack = [], vars = {}) {
  const real = fs.realpathSync(file);
  if (stack.includes(real)) {
    throw new Error(`Include cycle detected: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`);
  }

  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  const assets = createAssets();
  collectColocatedAssets(file, context, assets);
  const expanded = expandIncludes(body, file, context, [...stack, real], vars, assets);
  return {
    meta,
    html: renderMarkdown(applyVars(expanded, vars), assets),
    assets
  };
}

function createAssets() {
  return { skins: new Set(), scripts: new Set(), files: new Map(), runtime: false };
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

function expandIncludes(source, fromFile, context, stack, vars, assets) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    const include = line.match(/^@include\s+(.+?)(?:\s+with\s+(.+))?$/);
    const repeat = line.match(/^@repeat\s+(.+?)\s+from\s+(.+)$/);
    if (include) {
      const target = resolveInclude(include[1].trim(), fromFile, context);
      const childVars = { ...vars, ...parseArgs(include[2] || "") };
      const child = compileDocument(target, context, stack, childVars);
      mergeAssets(assets, child.assets);
      out.push(child.html);
      continue;
    }
    if (repeat) {
      const target = resolveInclude(repeat[1].trim(), fromFile, context);
      const dataFile = resolveInclude(repeat[2].trim(), fromFile, context, true);
      const rows = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      if (!Array.isArray(rows)) throw new Error(`Repeat data must be an array: ${dataFile}`);
      for (const row of rows) {
        const child = compileDocument(target, context, stack, { ...vars, ...row });
        mergeAssets(assets, child.assets);
        out.push(child.html);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

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

function mergeAssets(target, source) {
  for (const skin of source.skins) target.skins.add(skin);
  for (const script of source.scripts) target.scripts.add(script);
  for (const [file, href] of source.files) target.files.set(file, href);
  target.runtime ||= source.runtime;
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
    if (!allowAny && ![".md", ".mdx", ".wd"].includes(path.extname(resolved))) continue;
    return resolved;
  }
  throw new Error(`Could not resolve include "${spec}" from ${fromFile}`);
}

function isAllowedInclude(file, context) {
  const roots = [context.routesRoot, context.shelfRoot].map((root) => path.resolve(root));
  return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`));
}

function parseArgs(raw) {
  const args = {};
  const re = /([A-Za-z0-9_-]+)=("[^"]*"|'[^']*'|[^\s]+)/g;
  for (const match of raw.matchAll(re)) args[match[1]] = stripQuotes(match[2]);
  return args;
}

function applyVars(source, vars) {
  return source.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

function renderMarkdown(source, assets = createAssets(), initialState = {}) {
  const lines = source.split("\n");
  const html = [];
  let paragraph = [];
  let inCode = false;
  let code = [];
  let list = [];
  const state = { ...initialState };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(" "), state, assets)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inline(item, state, assets)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.trim().startsWith("<")) {
      flushParagraph();
      flushList();
      html.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2], state, assets)}</h${level}>`);
      continue;
    }
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      flushParagraph();
      list.push(item[1]);
      continue;
    }
    const ifMatch = line.match(/^:if\s+([A-Za-z_$][\w$]*)$/);
    if (ifMatch) {
      flushParagraph();
      flushList();
      const block = collectConditional(lines, i);
      html.push(renderConditional(ifMatch[1], block.truthy, block.falsy, assets, state));
      i = block.end;
      continue;
    }
    const forMatch = line.match(/^:for\s+([A-Za-z_$][\w$]*)\s+in\s+([A-Za-z_$][\w$]*)$/);
    if (forMatch) {
      flushParagraph();
      flushList();
      const block = collectBlock(lines, i, ":endfor");
      html.push(renderFor(forMatch[1], forMatch[2], block.body, assets, state));
      i = block.end;
      continue;
    }
    const directive = renderDirective(line, assets, state);
    if (directive) {
      flushParagraph();
      flushList();
      html.push(directive);
      continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return html.join("\n");
}

function collectConditional(lines, start) {
  const truthy = [];
  const falsy = [];
  let current = truthy;
  let depth = 0;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^:if\s+/)) depth++;
    if (line === ":endif" && depth === 0) return { truthy, falsy, end: i };
    if (line === ":endif") depth--;
    if (line === ":else" && depth === 0) {
      current = falsy;
      continue;
    }
    current.push(line);
  }

  throw new Error(`Missing :endif for ${lines[start]}`);
}

function collectBlock(lines, start, endToken) {
  const body = [];
  let depth = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^:for\s+/)) depth++;
    if (line === endToken && depth === 0) return { body, end: i };
    if (line === endToken) depth--;
    body.push(line);
  }
  throw new Error(`Missing ${endToken} for ${lines[start]}`);
}

function renderConditional(key, truthyLines, falsyLines, assets, state) {
  assets.runtime = true;
  const truthy = renderMarkdown(truthyLines.join("\n"), assets, state);
  const falsy = renderMarkdown(falsyLines.join("\n"), assets, state);
  const active = state[key] ? truthy : falsy;
  return `<span data-wd-if="${key}"><template data-wd-true>${truthy}</template><template data-wd-false>${falsy}</template><span data-wd-if-out>${active}</span></span>`;
}

function renderFor(itemName, listName, bodyLines, assets, state) {
  assets.runtime = true;
  const rows = Array.isArray(state[listName]) ? state[listName] : [];
  const template = renderTemplateLines(bodyLines, itemName);
  const initial = rows.map((item) => renderForItem(template, itemName, item)).join("");
  return `<span data-wd-for="${listName}" data-wd-item="${itemName}"><template data-wd-for-template>${template}</template><span data-wd-for-out>${initial}</span></span>`;
}

function renderTemplateLines(lines, itemName) {
  return renderMarkdown(lines.join("\n"), createAssets()).replaceAll(`data-wd-bind="${itemName}"`, `data-wd-each="${itemName}"`);
}

function renderForItem(template, itemName, item) {
  return template.replace(new RegExp(`(<span data-wd-each="${itemName}">)(</span>)`, "g"), `$1${escapeHtml(item)}$2`);
}

function renderDirective(line, assets, state) {
  const stateMatch = line.match(/^:state\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (stateMatch) {
    assets.runtime = true;
    state[stateMatch[1]] = parseStateValue(stateMatch[2]);
    return `<script type="application/json" data-wd-state>${safeScriptJson({ [stateMatch[1]]: state[stateMatch[1]] })}</script>`;
  }
  const button = line.match(/^:button\s+"([^"]+)"\s*->\s*(.+)$/);
  if (button) {
    assets.runtime = true;
    const action = parseAction(button[2], state);
    return `<button type="button" data-wd-action="${action.op}" data-wd-target="${action.target}"${action.value === undefined ? "" : ` data-wd-value="${escapeHtml(JSON.stringify(action.value))}"`}>${escapeHtml(button[1])}</button>`;
  }
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

function inline(text, state = {}, assets = createAssets()) {
  const codeSpans = [];
  const protectedText = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@WD_CODE_${codeSpans.length}@@`;
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });

  return protectedText
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (_, key) => {
      assets.runtime = true;
      return `<span data-wd-bind="${key}">${escapeHtml(state[key] ?? "")}</span>`;
    })
    .replace(/@@WD_CODE_(\d+)@@/g, (_, index) => codeSpans[Number(index)]);
}

function parseAction(raw, state = {}) {
  const expression = raw.trim();
  const increment = expression.match(/^([A-Za-z_$][\w$]*)\+\+$/);
  if (increment) return { op: "inc", target: increment[1] };
  const decrement = expression.match(/^([A-Za-z_$][\w$]*)--$/);
  if (decrement) return { op: "dec", target: decrement[1] };
  const add = expression.match(/^([A-Za-z_$][\w$]*)\s*\+=\s*(.+)$/);
  if (add) {
    const value = parseActionLiteral(add[2]);
    if (Array.isArray(state[add[1]])) return { op: "append", target: add[1], value };
    if (typeof value === "number") return { op: "add", target: add[1], value };
    throw new Error(`Unsupported button action "${raw}". += with non-number values requires an array state target.`);
  }
  const assign = expression.match(/^([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
  if (assign) return { op: "set", target: assign[1], value: parseActionLiteral(assign[2]) };
  throw new Error(`Unsupported button action "${raw}". Supported actions: count++, count--, count += 1, items += "value", name = "value".`);
}

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
