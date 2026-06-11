#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./builder.js";
import { devClientPath, devClientScript, devEventsPath, injectDevClient } from "./dev.js";
import { initProject } from "./scaffold.js";
import { contentType, resolvePublicFile, serve } from "./server.js";

const cliPath = fileURLToPath(import.meta.url);
const command = process.argv[2] || "build";

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "version" || command === "--version" || command === "-v") {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
} else if (command === "init") {
  const target = process.argv[3] || ".";
  const result = initProject(path.resolve(process.cwd(), target));
  console.log(`Created Markie project at ${path.relative(process.cwd(), result.root) || "."}`);
  console.log(`Next: cd ${path.relative(process.cwd(), result.root) || "."} && npm install && npm run dev`);
} else if (command === "build") {
  const result = buildSite();
  console.log(`Built ${result.routes.length} routes into ${path.relative(process.cwd(), result.distRoot)}`);
} else if (command === "dev") {
  const port = Number(process.env.PORT || 5173);
  const distRoot = path.join(process.cwd(), "dist");
  buildSite();
  const clients = new Set();
  let timer;

  // Rebuild in a child process so changes to Markie's own src/ always load
  // fresh modules — an in-process rebuild would reuse the stale import cache.
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const started = performance.now();
      execFile(process.execPath, [cliPath, "build"], { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) {
          const message = (stderr || stdout || String(error)).trim();
          console.error(message);
          broadcast(clients, `event: builderror\ndata: ${JSON.stringify({ message: message.slice(0, 4000) })}\n\n`);
          return;
        }
        const elapsed = Math.round(performance.now() - started);
        if (stderr.trim()) console.warn(stderr.trim());
        broadcast(clients, `event: reload\ndata: ${JSON.stringify({ elapsed })}\n\n`);
        console.log(`${stdout.trim().split("\n").at(-1)} (${elapsed}ms)`);
      });
    }, 30);
  };

  for (const dir of ["site", "src"]) {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, rebuild);
    }
  }

  const server = http.createServer((req, res) => {
    try {
      const url = req.url || "/";
      if (url.split("?")[0] === devEventsPath) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write("\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (url.split("?")[0] === devClientPath) {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(devClientScript());
        return;
      }
      if (url.split("?")[0] === "/__wd/echo" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            received: Object.fromEntries(new URLSearchParams(body)),
            at: new Date().toISOString()
          }));
        });
        return;
      }
      serveDev(distRoot, url, res);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error.stack || String(error));
    }
  });
  server.listen(port, () => {
    console.log(`Markie dev server ready at http://localhost:${port}`);
    console.log(`Live compiler watching site/ and src/`);
  });
} else if (command === "serve") {
  const port = Number(process.env.PORT || 4173);
  const distRoot = path.join(process.cwd(), "dist");
  if (!fs.existsSync(distRoot)) {
    console.error("No dist directory found. Run `markie build` first.");
    process.exit(1);
  }
  http.createServer((req, res) => serve(distRoot, req.url || "/", res)).listen(port, () => {
    console.log(`Markie preview of dist at http://localhost:${port}`);
  });
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function serveDev(distRoot, url, res) {
  const file = resolvePublicFile(distRoot, url);
  if (!file || !fs.existsSync(file)) {
    serve(distRoot, url, res);
    return;
  }
  if (file.endsWith(".html")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(injectDevClient(fs.readFileSync(file, "utf8")));
    return;
  }
  res.writeHead(200, { "content-type": contentType(file) });
  fs.createReadStream(file).pipe(res);
}

function broadcast(clients, message) {
  for (const client of clients) client.write(message);
}

function printHelp() {
  console.log(`Markie

Usage:
  markie init [dir]   Scaffold a new Markie project
  markie dev          Start the live compiler dev server
  markie build        Compile site/pages into dist
  markie serve        Preview the built dist locally
  markie help         Show this help

Authoring:
  site/pages          File-based routes: .md stays plain, .wd adds directives
  site/_              Include shelf for @include /name.wd
  @loop x into item   Loop over JSON files, in-scope values, or :state lists
  *.skin              Colocated indentation-based CSS
  *.js                Colocated page behavior
`);
}
