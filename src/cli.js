#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { buildSite } from "./builder.js";
import { devClientPath, devClientScript, devEventsPath, injectDevClient } from "./dev.js";
import { initProject } from "./scaffold.js";
import { contentType, resolvePublicFile, serve } from "./server.js";

const command = process.argv[2] || "build";

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else if (command === "version" || command === "--version" || command === "-v") {
  console.log("0.1.0");
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
  let current = buildSite();
  const clients = new Set();
  let timer;

  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const started = performance.now();
        current = buildSite();
        const elapsed = Math.round(performance.now() - started);
        broadcast(clients, `event: reload\ndata: ${JSON.stringify({ routes: current.routes.length, elapsed })}\n\n`);
        console.log(`Rebuilt ${current.routes.length} routes in ${elapsed}ms`);
      } catch (error) {
        console.error(error.stack || String(error));
      }
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
      serveDev(current.distRoot, url, res);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error.stack || String(error));
    }
  });
  server.listen(port, () => {
    console.log(`Markie dev server ready at http://localhost:${port}`);
    console.log(`Live compiler watching site/ and src/`);
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
  markie help         Show this help

Authoring:
  site/pages          File-based routes: .md stays plain, .wd adds directives
  site/_              Include shelf for @include /name.wd
  @loop x into item   Loop over JSON files, in-scope values, or :state lists
  *.skin              Colocated indentation-based CSS
  *.js                Colocated page behavior
`);
}
