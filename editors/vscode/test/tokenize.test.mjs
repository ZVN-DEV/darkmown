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

// The grammar covered roughly a third of the language: `:store`, `:effect`,
// `:every`, `:theme`, `:bind`, `:slider`, `:carousel`, the media trio, three of
// the five form fields, `@empty` and `:else if` all fell through to plain
// Markdown, while three DEMO-ONLY directives were highlighted as if public.
// One line per previously-unhighlighted directive.
test("darkmown grammar scopes the directives the 0.1.0 grammar missed", async () => {
  const t = await tokens("text.markdown.darkmown", [
    ":store cart = [] ephemeral",
    ":state seen = false ephemeral",
    ":effect query -> searches++",
    ":every 5s -> seconds++",
    ':theme mode = "auto"',
    ':bind query placeholder="Search"',
    ":slider volume = 50 min=0 max=100",
    ":carousel autoplay=4000",
    ":endcarousel",
    ":video /clip.mp4 controls muted",
    ":audio /theme.mp3 controls",
    ':embed https://www.youtube.com/watch?v=abc title="Demo"',
    ':textarea bio placeholder="About you" rows=4',
    ":select size required",
    ":checkbox toppings",
    ":radio plan",
    ":endform",
    "@empty",
    ":else if count > 3",
    ':button "Refresh" -> board refetch'
  ]);

  assert.ok(scoped(t, ":store", "keyword.control.state"), ":store keyword");
  assert.ok(scoped(t, "ephemeral", "storage.modifier.persist"), "ephemeral modifier");
  assert.ok(scoped(t, ":effect", "keyword.control.effect"), ":effect keyword");
  assert.ok(scoped(t, ":every", "keyword.control.every"), ":every keyword");
  assert.ok(scoped(t, "5s", "constant.numeric.duration"), ":every duration");
  assert.ok(scoped(t, ":theme", "keyword.control.theme"), ":theme keyword");
  assert.ok(scoped(t, ":bind", "keyword.control.bind"), ":bind keyword");
  assert.ok(scoped(t, ":slider", "keyword.control.slider"), ":slider keyword");
  assert.ok(scoped(t, ":carousel", "keyword.control.carousel"), ":carousel keyword");
  assert.ok(scoped(t, ":endcarousel", "keyword.control.carousel.end"), ":endcarousel");
  assert.ok(scoped(t, ":video", "keyword.control.media"), ":video keyword");
  assert.ok(scoped(t, ":audio", "keyword.control.media"), ":audio keyword");
  assert.ok(scoped(t, ":embed", "keyword.control.embed"), ":embed keyword");
  assert.ok(scoped(t, ":textarea", "keyword.control.textarea"), ":textarea keyword");
  assert.ok(scoped(t, ":select", "keyword.control.select"), ":select keyword");
  assert.ok(scoped(t, ":checkbox", "keyword.control.checkbox"), ":checkbox keyword");
  assert.ok(scoped(t, ":radio", "keyword.control.radio"), ":radio keyword");
  assert.ok(scoped(t, ":endform", "keyword.control.form.end"), ":endform");
  assert.ok(scoped(t, "@empty", "keyword.control.loop.empty"), "@empty marker");
  assert.ok(scoped(t, ":else if", "keyword.control.conditional.elseif"), ":else if keyword");
  assert.ok(scoped(t, "refetch", "keyword.operator.action"), "refetch action op");
});

test("@loop clauses and format pipes are scoped, not left as prose", async () => {
  const t = await tokens("text.markdown.darkmown", [
    "@loop products into p where p.price < 50 sort by p.price desc limit 5",
    "Total: { cart | sum:\"price\" }"
  ]);
  assert.ok(scoped(t, "where", "keyword.control.loop.clause"), "where clause");
  assert.ok(scoped(t, "sort by", "keyword.control.loop.clause"), "sort by clause");
  assert.ok(scoped(t, "limit", "keyword.control.loop.clause"), "limit clause");
  assert.ok(scoped(t, "desc", "keyword.control.loop.clause"), "sort direction");
  assert.ok(scoped(t, "<", "keyword.operator.comparison"), "comparison operator");
  assert.ok(scoped(t, "sum", "support.function.pipe"), "format pipe name");
});

test("the demo-only directives are no longer highlighted as public syntax", async () => {
  // `:note` and `:sprint` are demo directives the spec doc says are not public;
  // highlighting them taught users a vocabulary that does not exist. `:try` is
  // still listed, so it stays.
  const t = await tokens("text.markdown.darkmown", [":note hello", ":sprint 3", ":try href=/x"]);
  assert.ok(!scoped(t, ":note", "keyword.control"), ":note must not be highlighted");
  assert.ok(!scoped(t, ":sprint", "keyword.control"), ":sprint must not be highlighted");
  assert.ok(scoped(t, ":try", "keyword.control.demo"), ":try is still listed and stays");
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
