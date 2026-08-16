import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Invoking npm portably is fiddlier than it looks. On Windows the entry point
// is `npm.cmd`, a bare "npm" fails with ENOENT, and since Node's CVE-2024-27980
// fix spawning a .cmd at all fails with EINVAL unless a shell is involved. So
// run npm's own JS entry under the CURRENT Node binary: shell-free (no argument
// quoting to get wrong) and identical on every platform. `npm_execpath` is set
// whenever this runs under an npm script, which is how CI invokes the suite.
function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  // Direct `node --test` outside an npm script: fall back to the shim.
  const win = process.platform === "win32";
  return execFileSync(win ? "npm.cmd" : "npm", args, { ...options, shell: win });
}

test("npm pack includes the runtime, compiler, cli, and intentional demo/support files", () => {
  const output = runNpm(["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const [report] = JSON.parse(output);
  const files = report.files.map((file) => file.path);
  // Hidden demo sources ship intentionally: they prove the router hides dot/dash
  // pages in the demo/package without needing separate fixture files. AGENTS.md
  // ships intentionally as model-facing guidance for AI-assisted users.
  for (const required of [
    "src/cli.js",
    "src/compiler.js",
    "src/runtime.js",
    "src/builder.js",
    "site/pages/index.wd",
    "site/pages/-draft.wd",
    "site/pages/docs/.secret.wd",
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json"
  ]) {
    assert.equal(files.includes(required), true, `missing ${required} from npm pack`);
  }
});

test("the shipped declarations are the flat tree the exports map points at", () => {
  const output = runNpm(["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const [report] = JSON.parse(output);
  const files = report.files.map((file) => file.path);

  // `darkmown init` copies AGENTS.md out of the installed package into the new
  // project root, which is the only place a coding agent reads it. Drop it from
  // the `files` allowlist and init silently scaffolds a project with no agent
  // context at all: no error, no missing file, just worse output forever after.
  assert.equal(files.includes("AGENTS.md"), true, "AGENTS.md must ship; init copies it");

  // EVERY entrypoint in `exports` must actually resolve inside the tarball,
  // read from the manifest rather than listed here, so adding a subpath cannot
  // add an unshipped one. `types/compiler.d.ts` is not an exports entry but is
  // the deep import the README documents.
  const required = new Set(["types/compiler.d.ts"]);
  for (const entry of Object.values(pkg.exports)) {
    if (typeof entry !== "object") continue;
    for (const target of Object.values(entry)) required.add(String(target).replace(/^\.\//, ""));
  }
  for (const file of required) {
    assert.equal(files.includes(file), true, `missing ${file} from npm pack`);
  }

  // `npm run types` emits into `types/` but does NOT clean it first, so a
  // change to the declaration build's rootDir once left a full duplicate tree
  // under `types/src/**` sitting beside the real one — 38 redundant files that
  // would have shipped. Nothing legitimate lives at that path.
  const nested = files.filter((file) => file.startsWith("types/src/"));
  assert.deepEqual(
    nested,
    [],
    `duplicate declaration tree under types/src/ — delete it and re-run \`npm run types\``
  );
});

// The committed `.d.ts` files are build output that is checked in, so they go
// stale the moment `npm run types` is not re-run — and staleness is INVISIBLE:
// `npm test`, `npm run typecheck` and `npm pack` all pass while a TypeScript
// consumer gets "has no exported member". It has shipped that way twice, the
// second time drifting 344 lines across eight files. Two guards, because there
// are two kinds of declaration here.

test("the generated declarations match what the source would emit today", () => {
  // Everything reachable from `tsconfig.types.json` is tsc output. Regenerating
  // costs under a second, so compare the real thing rather than a proxy for it.
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-types-"));
  try {
    runNpm(["run", "types", "--", "--outDir", out], { cwd: repoRoot, stdio: "pipe" });
    const stale = [];
    for (const file of walk(out)) {
      const rel = path.relative(out, file).split(path.sep).join("/");
      const committed = path.join(repoRoot, "types", rel);
      if (!fs.existsSync(committed)) stale.push(`${rel} (missing)`);
      else if (fs.readFileSync(committed, "utf8") !== fs.readFileSync(file, "utf8")) {
        stale.push(`${rel} (out of date)`);
      }
    }
    assert.deepEqual(stale, [], `committed types/ is stale — run \`npm run types\` and commit`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("every entrypoint's hand-authored declarations cover what it actually exports", async () => {
  // `types/index.d.ts` and `types/catalog.d.ts` are written by hand (they are
  // not in the declaration build's `include`), so nothing regenerates them and
  // the guard above cannot see them. Adding an export to `src/index.js` without
  // adding it here is exactly how `directiveCatalog` went untyped.
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    if (typeof entry !== "object" || !entry.types) continue;
    const runtime = await import(new URL(entry.default, `file://${repoRoot}/`).pathname);
    const declared = fs.readFileSync(path.join(repoRoot, entry.types), "utf8");
    for (const name of Object.keys(runtime)) {
      assert.match(
        declared,
        new RegExp(`\\b${name}\\b`),
        `"${subpath}" exports ${name} at runtime but ${entry.types} never names it — re-run \`npm run types\``
      );
    }
  }
});

/** Every file under `dir`, recursively. @param {string} dir */
function* walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) yield* walk(full);
    else yield full;
  }
}
