// Grammar tokenization tests. Loads the real .wd and .skin TextMate grammars
// through vscode-textmate + vscode-oniguruma (the same engine VS Code uses) and
// asserts directive/selector scopes land on the right tokens. Kept here, with
// its own devDependencies, so the framework root stays dependency-free.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const oniguruma = require("vscode-oniguruma");
const textmate = require("vscode-textmate");

const here = dirname(fileURLToPath(import.meta.url));
const WD = resolve(here, "../syntaxes/darkmown.tmLanguage.json");
const SKIN = resolve(here, "../syntaxes/skin.tmLanguage.json");

await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer);
const onigLib = Promise.resolve({
  createOnigScanner: (s) => new oniguruma.OnigScanner(s),
  createOnigString: (s) => new oniguruma.OnigString(s)
});

const grammars = {
  "text.markdown.darkmown": WD,
  "source.darkmown-skin": SKIN
};
const registry = new textmate.Registry({
  onigLib,
  loadGrammar: async (scope) => {
    // The built-in Markdown grammar is provided by VS Code at runtime; stub it here.
    if (scope === "text.html.markdown") return { scopeName: scope, patterns: [] };
    if (grammars[scope]) return textmate.parseRawGrammar(readFileSync(grammars[scope], "utf8"), grammars[scope]);
    return null;
  }
});

async function tokens(scope, lines) {
  const grammar = await registry.loadGrammar(scope);
  let ruleStack = textmate.INITIAL;
  const out = [];
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, ruleStack);
    for (const t of result.tokens) out.push([line.slice(t.startIndex, t.endIndex).trim(), t.scopes]);
    ruleStack = result.ruleStack;
  }
  return out;
}

const scoped = (toks, text, part) => toks.some(([t, s]) => t === text && s.some((x) => x.includes(part)));

test("darkmown grammar scopes every directive", async () => {
  const t = await tokens("text.markdown.darkmown", [
    ":state count = 0",
    ':button "Add" -> count++',
    ":if member.lead",
    ":else",
    ":endif",
    "@loop team into member",
    "@endloop",
    "@include /nav.wd with x={ row.name }",
    ':fetch team from "/data.json" when=visible',
    ":computed total = items.length * 4",
    "::: section #cart .dark",
    "Count: { count }"
  ]);
  assert.ok(scoped(t, ":state", "keyword.control.state"), "state keyword");
  assert.ok(scoped(t, "count", "variable.other.state"), "state name");
  assert.ok(scoped(t, "->", "keyword.operator.arrow"), "button arrow");
  assert.ok(scoped(t, "++", "keyword.operator"), "button op");
  assert.ok(scoped(t, ":if", "keyword.control.conditional.if"), "if keyword");
  assert.ok(scoped(t, "member.lead", "variable.other"), "if path");
  assert.ok(scoped(t, ":else", "keyword.control.conditional.else"), "else");
  assert.ok(scoped(t, ":endif", "keyword.control.conditional.end"), "endif");
  assert.ok(scoped(t, "@loop", "keyword.control.loop"), "loop keyword");
  assert.ok(scoped(t, "into", "keyword.control.loop.into"), "loop into");
  assert.ok(scoped(t, "@endloop", "keyword.control.loop.end"), "endloop");
  assert.ok(scoped(t, "@include", "keyword.control.include"), "include keyword");
  assert.ok(scoped(t, ":fetch", "keyword.control.fetch"), "fetch keyword");
  assert.ok(scoped(t, '"/data.json"', "string.quoted.double"), "fetch url");
  assert.ok(scoped(t, ":computed", "keyword.control.computed"), "computed keyword");
  assert.ok(scoped(t, ":::", "keyword.control.section.begin"), "section begin");
  assert.ok(scoped(t, "#cart", "attribute-name.id"), "section id");
  assert.ok(scoped(t, ".dark", "attribute-name.class"), "section class");
  assert.ok(scoped(t, "count", "variable.other.interpolation"), "interpolation");
});

test("skin grammar scopes selectors, tokens, colors, and properties", async () => {
  const t = await tokens("source.darkmown-skin", [
    "tokens",
    "  accent #16645a",
    "  radius 8px",
    ".topnav",
    "  color $accent",
    "  padding 1rem 2rem",
    "  font ui-sans-serif, system-ui",
    "body",
    "&:hover"
  ]);
  assert.ok(scoped(t, "tokens", "keyword.control.tokens"), "tokens keyword");
  assert.ok(scoped(t, "#16645a", "constant.other.color"), "hex color");
  assert.ok(scoped(t, "8px", "constant.numeric"), "unit");
  assert.ok(scoped(t, ".topnav", "attribute-name.class"), "class selector");
  assert.ok(scoped(t, "$accent", "variable.other.token"), "token ref");
  assert.ok(scoped(t, "color", "support.type.property-name"), "property name");
  assert.ok(scoped(t, "font", "support.type.property-name"), "font is a property, not a selector");
  assert.ok(scoped(t, "body", "entity.name.tag"), "bare tag selector");
  assert.ok(scoped(t, "&", "entity.name.tag.reference"), "parent ref");
});
