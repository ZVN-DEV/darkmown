import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildSite } from "./builder.js";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP } from "./headers.js";

/** The platforms `darkmown deploy` knows how to drive. */
export const DEPLOY_TARGETS = ["vercel", "cloudflare"];

/**
 * Deploy a Darkmown site to a platform by wrapping its CLI. The build is
 * target-aware (Cloudflare gets the `dist/_worker.js` for `api/*`), platform
 * config is written if missing, then the platform CLI runs via `npx`.
 *
 * The process spawn is injected (`run`) so this is unit-testable without touching
 * the network; the binary defaults to {@link spawnProcess}.
 * @param {object} opts
 * @param {string} opts.cwd Project directory.
 * @param {string} opts.target One of {@link DEPLOY_TARGETS}.
 * @param {boolean} [opts.prod] Promote to production.
 * @param {(msg: string) => void} opts.log Progress sink.
 * @param {(file: string, args: string[], options: object) => Promise<{ code: number, stdout: string, stderr: string }>} [opts.run]
 * @param {string} [opts.projectName] Cloudflare Pages project name (defaults to package.json name).
 * @returns {Promise<{ url: string | null }>}
 */
export async function deploy({ cwd, target, prod = false, log, run = spawnProcess, projectName }) {
  if (!DEPLOY_TARGETS.includes(target)) {
    throw new Error(`Unknown deploy target "${target}". Use one of: ${DEPLOY_TARGETS.join(", ")}.`);
  }

  ensurePlatformConfig(cwd, target);
  log(`Building for ${target}…`);
  buildSite(cwd, { target });

  const plan = deployCommand({ target, prod, name: projectName || packageName(cwd) });
  log(`$ ${plan.file} ${plan.args.join(" ")}`);
  const result = await run(plan.file, plan.args, { cwd });
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.code !== 0) {
    // Matches both Vercel ("Not authenticated. Please log in.") and wrangler
    // ("you are not logged in", "Authentication error", "run `wrangler login`",
    // "You need to log in first") auth-failure wording.
    if (
      /not authenticated|not logged in|please log ?in|unauthorized|no auth|log ?in first|authentication (?:error|failed)|wrangler login/i.test(
        output
      )
    ) {
      throw new Error(
        `The ${target} CLI is not signed in. Run \`${plan.loginHint}\` (try \`! ${plan.loginHint}\` in this session), then re-run \`darkmown deploy ${target}\`.`
      );
    }
    throw new Error(`${target} deploy failed (exit ${result.code}).`);
  }

  const url = plan.parseUrl(output);
  if (url) log(`Deployed → ${url}`);
  else log("Deploy finished (no URL detected in the CLI output).");
  return { url };
}

/**
 * Build the platform CLI invocation: binary, args, login hint, and a URL parser.
 * @param {{ target: string, prod: boolean, name: string }} opts
 * @returns {{ file: string, args: string[], loginHint: string, parseUrl: (out: string) => string | null }}
 */
function deployCommand({ target, prod, name }) {
  if (target === "vercel") {
    const args = ["--yes", "vercel", "deploy", "--yes"];
    if (prod) args.push("--prod");
    return {
      file: "npx",
      args,
      loginHint: "npx vercel login",
      parseUrl: (out) => firstMatch(out, /https:\/\/[^\s]*\.vercel\.app[^\s]*/)
    };
  }
  // cloudflare — `--branch main` promotes to production only if the project's
  // configured production branch is literally `main` (Cloudflare's default).
  const args = ["--yes", "wrangler", "pages", "deploy", "dist", "--project-name", name];
  if (prod) args.push("--branch", "main");
  return {
    file: "npx",
    args,
    loginHint: "npx wrangler login",
    parseUrl: (out) => firstMatch(out, /https:\/\/[^\s]*\.pages\.dev[^\s]*/)
  };
}

/**
 * Ensure the platform has the config it needs. Vercel reads `vercel.json` BEFORE
 * the build, so write a sane default if absent (never overwrite). Cloudflare needs
 * nothing extra — the build emits `dist/_worker.js` + `dist/_headers`.
 * @param {string} cwd
 * @param {string} target
 * @returns {void}
 */
function ensurePlatformConfig(cwd, target) {
  if (target !== "vercel") return;
  const file = path.join(cwd, "vercel.json");
  if (fs.existsSync(file)) return;
  const config = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: null,
    buildCommand: "npm run build",
    outputDirectory: "dist",
    cleanUrls: true,
    trailingSlash: false,
    headers: [
      {
        source: "/(.*)",
        headers: [
          ...Object.entries(BASE_SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
          { key: "Content-Security-Policy", value: REACTIVE_CSP }
        ]
      }
    ]
  };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Spawn a process, streaming its output to the terminal while capturing it for
 * URL parsing. Resolves (never rejects) with the exit code + captured streams.
 * @param {string} file
 * @param {string[]} args
 * @param {object} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function spawnProcess(file, args, options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(file, args, { ...options, stdio: ["inherit", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: `${stderr}${err}` }));
  });
}

/**
 * @param {string} text
 * @param {RegExp} re
 * @returns {string | null}
 */
function firstMatch(text, re) {
  const match = text.match(re);
  // The greedy `[^\s]*` can swallow trailing sentence punctuation (e.g. a period
  // after the URL in "Deployed to https://x.pages.dev."); strip it off.
  return match ? match[0].replace(/[.,;:)\]}'"]+$/, "") : null;
}

/**
 * The project's package.json `name`, or the directory name, as a Cloudflare Pages
 * project slug.
 * @param {string} cwd
 * @returns {string}
 */
function packageName(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    if (pkg.name) return String(pkg.name).replace(/^@[^/]+\//, "");
  } catch {
    /* no package.json — fall back to the directory name */
  }
  return path.basename(cwd) || "darkmown-site";
}
