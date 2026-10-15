// ---------------------------------------------------------------------------
// The Darkmown MCP server's tools and resources.
//
// Nothing here re-implements the framework: every tool is a thin adapter over
// a surface that already exists and is already drift-guarded by the test
// suite — the directive catalog (src/catalog.js), the agent grammar slice
// (src/tools/grammar.js), the GBNF generator (src/grammar.js), the in-memory
// validator (src/tools/validate.js), and the error-code registry
// (src/errors.js). An MCP client and the `darkmown` CLI therefore can never
// disagree about what compiles or what a WD code means.
//
// The five tools:
//
//   catalog   the machine-readable directive catalog (JSON, llms, llms-full)
//   grammar   the GBNF grammar, or a category slice of the directive cheatsheet
//   validate  compile .wd source in memory, answering with WD codes and fixes
//   error     one WDxxx code's cause, fix, and example (or the valid list)
//   doc       fuzzy-find a section of README.md / AGENTS.md by topic
//
// The resources expose the shipped markdown docs at darkmown://docs/* URIs,
// read from the installed package files at request time.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { directiveCatalog, llmsFullText, llmsText } from "./catalog.js";
import { errorCatalog, errorForCode } from "./errors.js";
import { generateGrammar } from "./grammar.js";
import { grammar } from "./tools/grammar.js";
import { validate } from "./tools/validate.js";

/** The installed Darkmown version, read from the shipped package.json. */
function packageVersion() {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(pkg.version || "0.0.0");
}

/** Read a file shipped in the package root (or under it), as UTF-8. */
function readPackageFile(/** @type {string} */ file) {
  return fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

// --- catalog ---------------------------------------------------------------

/** @type {string[]} The render modes, mirroring the CLI's catalog flags. */
const CATALOG_MODES = ["json", "llms", "llms-full"];

/** @type {import("./mcp.js").McpTool} */
const catalogTool = {
  name: "catalog",
  description:
    "The Darkmown .wd directive catalog: every directive, @loop clause, action op, " +
    'format pipe, predicate operator, frontmatter key, and WDxxx error code. mode "json" ' +
    '(default) is the full machine-readable catalog, "llms" the compact cheatsheet, ' +
    '"llms-full" the complete reference.',
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: CATALOG_MODES,
        description: 'Render mode: "json" (default), "llms", or "llms-full".'
      }
    }
  },
  run(args) {
    const mode = args.mode ?? "json";
    if (typeof mode !== "string" || !CATALOG_MODES.includes(mode)) {
      return {
        text: `unknown catalog mode ${JSON.stringify(mode)}. Valid modes: ${CATALOG_MODES.join(", ")}`,
        isError: true
      };
    }
    if (mode === "llms") return { text: llmsText() };
    if (mode === "llms-full") return { text: llmsFullText() };
    return { text: JSON.stringify(directiveCatalog(), null, 2) };
  }
};

// --- grammar ---------------------------------------------------------------

/** @type {import("./mcp.js").McpTool} */
const grammarTool = {
  name: "grammar",
  description:
    "The .wd directive syntax. Pass gbnf:true for the full GBNF directive-line grammar " +
    '(for constrained decoding), or categories like ["state", "actions"] for just the ' +
    "cheatsheet rows covering those directives. Categories: state, loops, actions, " +
    "forms, fetch, structure, media. No arguments returns every category.",
  inputSchema: {
    type: "object",
    properties: {
      gbnf: {
        type: "boolean",
        description: "Return the full GBNF grammar instead of a cheatsheet slice."
      },
      categories: {
        type: "array",
        items: { type: "string" },
        description:
          "Directive categories to include: state, loops, actions, forms, fetch, structure, media."
      }
    }
  },
  run(args) {
    if (args.gbnf === true) return { text: generateGrammar() };
    const categories = Array.isArray(args.categories)
      ? args.categories.filter((c) => typeof c === "string")
      : undefined;
    const result = grammar(categories);
    return { text: result.text, data: result.data, ...(result.ok ? {} : { isError: true }) };
  }
};

// --- validate ---------------------------------------------------------------

/** @type {import("./mcp.js").McpTool} */
const validateTool = {
  name: "validate",
  description:
    "Compile .wd (or .md) source with the real Darkmown compiler, in memory. On success " +
    "answers whether the page is static or reactive and lists any warnings; on failure " +
    "answers with the stable WD error code, the file:line, a Use: hint, and a concrete " +
    "example. Prove a page compiles before writing it.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "The full .wd/.md page source." },
      filename: {
        type: "string",
        description: 'Name the source is compiled under (default "index.wd").'
      }
    },
    required: ["source"]
  },
  run(args) {
    if (typeof args.source !== "string") {
      return { text: 'validate needs a "source" string.', isError: true };
    }
    const filename =
      typeof args.filename === "string" && args.filename.trim()
        ? args.filename.replace(/^\/+/, "")
        : "index.wd";
    const key = filename.startsWith("site/") ? filename : `site/pages/${filename}`;
    const result = validate({ [key]: args.source }, key);
    return { text: result.text, data: { ok: result.ok, ...result.data } };
  }
};

// --- error -----------------------------------------------------------------

/** @type {import("./mcp.js").McpTool} */
const errorTool = {
  name: "error",
  description:
    "Look up one Darkmown compile-error code (e.g. WD201): its title, what causes it, " +
    "how to fix it, and a concrete compilable example. An unknown code answers with " +
    "the list of valid codes.",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: 'The WDxxx code, e.g. "WD201".' }
    },
    required: ["code"]
  },
  run(args) {
    const code = typeof args.code === "string" ? args.code.trim().toUpperCase() : "";
    const entry = errorForCode(code);
    if (!entry) {
      const codes = errorCatalog().map((e) => e.code);
      return {
        text:
          `unknown error code ${JSON.stringify(code || args.code)}. ` +
          `Valid codes: ${codes.join(", ")}`,
        data: { codes },
        isError: true
      };
    }
    const lines = [`${entry.code} ${entry.title}`, `cause: ${entry.cause}`, `fix: ${entry.fix}`];
    if (entry.example) lines.push(`e.g. ${entry.example}`);
    return { text: lines.join("\n"), data: entry };
  }
};

// --- doc -------------------------------------------------------------------

/** The shipped long-form docs the `doc` tool searches, in search order. */
const DOC_FILES = ["README.md", "AGENTS.md"];

/**
 * One searchable section of a shipped doc.
 * @typedef {object} DocSection
 * @property {string} topic The heading text, e.g. "Includes & sections".
 * @property {string} file The doc the section lives in.
 * @property {string} body The section's markdown, heading excluded.
 */

/**
 * Split a doc into sections on `#`/`##`/`###` headings, ignoring heading-shaped
 * lines inside fenced code blocks (README's example robots.txt and sample pages
 * carry lines that start with `#`).
 * @returns {DocSection[]}
 */
export function docSections() {
  /** @type {{ topic: string, file: string, lines: string[] }[]} */
  const raw = [];
  for (const file of DOC_FILES) {
    let fenced = false;
    /** @type {{ topic: string, file: string, lines: string[] } | null} */
    let current = null;
    for (const line of readPackageFile(file).split("\n")) {
      if (/^(```|~~~)/.test(line.trimStart())) fenced = !fenced;
      const heading = !fenced && /^#{1,3} (.+)$/.exec(line);
      if (heading) {
        current = { topic: heading[1].trim(), file, lines: [] };
        raw.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    }
  }
  return raw.map(({ topic, file, lines }) => ({ topic, file, body: lines.join("\n").trim() }));
}

/**
 * Score a section heading against a query, higher is better. Exact match wins,
 * then containment either way, then shared-word count. Normalisation folds
 * case and strips punctuation, so "raw html" matches
 * "⚠️ Raw HTML is escaped by default (since 2.0.0)".
 * @param {string} topic
 * @param {string} query
 * @returns {number}
 */
function scoreSection(topic, query) {
  const normalize = (/** @type {string} */ s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const heading = normalize(topic);
  const wanted = normalize(query);
  if (!wanted) return 0;
  if (heading === wanted) return 100;
  if (heading.includes(wanted) || wanted.includes(heading)) return 60;
  const words = new Set(heading.split(" "));
  let overlap = 0;
  for (const word of wanted.split(" ")) if (words.has(word)) overlap++;
  return overlap;
}

/** @type {import("./mcp.js").McpTool} */
const docTool = {
  name: "doc",
  description:
    "Fuzzy-find a section of the shipped Darkmown docs (README.md and AGENTS.md) by " +
    'topic, e.g. "includes", "forms", "dark mode", and return that section\'s markdown. ' +
    "Call with no topic to list every available section.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "What to look up, in a word or two." }
    }
  },
  run(args) {
    const topic = typeof args.topic === "string" ? args.topic.trim() : "";
    const sections = docSections();
    const list = sections.map((s) => `- ${s.topic} (${s.file})`).join("\n");
    if (!topic) {
      return {
        text: `Available doc sections:\n${list}`,
        data: { topics: sections.map((s) => ({ topic: s.topic, file: s.file })) }
      };
    }
    let best = /** @type {DocSection | null} */ (null);
    let bestScore = 0;
    for (const section of sections) {
      const score = scoreSection(section.topic, topic);
      if (score > bestScore) {
        best = section;
        bestScore = score;
      }
    }
    if (!best) {
      return {
        text: `no doc section matches ${JSON.stringify(topic)}. Available sections:\n${list}`,
        isError: true
      };
    }
    return {
      text: `# ${best.topic} (${best.file})\n\n${best.body}`,
      data: { topic: best.topic, file: best.file }
    };
  }
};

// --- resources ---------------------------------------------------------------

/**
 * The shipped docs exposed as MCP resources, read from the installed package
 * at request time so a long-running server sees the files the user actually
 * has installed.
 * @type {{ uri: string, name: string, file: string, description: string }[]}
 */
const DOC_RESOURCES = [
  {
    uri: "darkmown://docs/readme",
    name: "README.md",
    file: "README.md",
    description: "The Darkmown README: authoring model, directive reference, commands."
  },
  {
    uri: "darkmown://docs/agents",
    name: "AGENTS.md",
    file: "AGENTS.md",
    description: "The agent authoring guide: the complete .wd directive set and the hard rules."
  },
  {
    uri: "darkmown://docs/changelog",
    name: "CHANGELOG.md",
    file: "CHANGELOG.md",
    description: "Darkmown release history."
  },
  {
    uri: "darkmown://docs/errors",
    name: "docs/errors.md",
    file: "docs/errors.md",
    description: "Every stable WDxxx compile-error code with cause, fix, and example."
  },
  {
    uri: "darkmown://docs/cli",
    name: "docs/cli.md",
    file: "docs/cli.md",
    description: "The Darkmown CLI command reference."
  }
];

/**
 * The server configuration: identity, the five tools, and the doc resources.
 * Built fresh on each call so tests can mutate nothing shared.
 * @returns {import("./mcp.js").McpConfig}
 */
export function mcpConfig() {
  return {
    serverInfo: { name: "darkmown", version: packageVersion() },
    tools: [catalogTool, grammarTool, validateTool, errorTool, docTool],
    resources: DOC_RESOURCES.map(({ uri, name, file, description }) => ({
      uri,
      name,
      description,
      mimeType: "text/markdown",
      read: () => readPackageFile(file)
    }))
  };
}
