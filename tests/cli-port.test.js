// `--port` for the local servers (`darkmown dev`, `darkmown serve`).
//
// Covers: flag/env/default precedence, rejected values, the banner printing the
// port the OS really bound (so `--port 0` is useful), and the one-line
// EADDRINUSE / EACCES failures that leave nothing running.
//
// Every bind here is on 127.0.0.1, either to port 0 or to a port this file holds
// open itself, so no test can collide with another suite or a running dev server.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CliError, helpText, listenErrorMessage, resolvePort, run } from "../src/cli.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function freshDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `darkmown-port-${label}-`));
}

/** A project with one page, so `dev` has something to build. */
function devProject(label) {
  const root = freshDir(label);
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Port test\n");
  return root;
}

/** A project with a built `dist`, so `serve` has something to serve. */
function serveProject(label) {
  const root = freshDir(label);
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist/index.html"), "<h1>ok</h1>");
  return root;
}

function capture(cwd) {
  const out = { log: [], warn: [], error: [] };
  return {
    env: {
      cwd,
      log: (...a) => out.log.push(a.join(" ")),
      warn: (...a) => out.warn.push(a.join(" ")),
      error: (...a) => out.error.push(a.join(" "))
    },
    out
  };
}

/** Run `fn` with PORT/HOST set as given (undefined deletes), then restore them. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Hold a real port on 127.0.0.1 until the returned server is closed. */
function holdPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Counts of the handle kinds a half-started server could leak: a watcher, a
 * debounce timer, a rebuild child, a listening server. A closed handle stays in
 * `getActiveResourcesInfo()` for a tick or two, so read until two consecutive
 * readings agree (earlier tests' closed servers drain out first).
 */
async function leakableHandles() {
  const read = () => {
    const counts = { FSEventWrap: 0, Timeout: 0, ProcessWrap: 0, TCPServerWrap: 0 };
    for (const kind of process.getActiveResourcesInfo()) {
      if (kind in counts) counts[kind]++;
    }
    return JSON.stringify(counts);
  };
  let last = "";
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const now = read();
    if (now === last) break;
    last = now;
  }
  return JSON.parse(last);
}

/** Run the real binary; resolve with its exit code and output (never rejects on a non-zero exit). */
function runBinary(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { cwd, env: { ...process.env, ...env }, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err && typeof err.code !== "number") return reject(err);
        resolve({ code: err ? err.code : 0, stdout, stderr });
      }
    );
  });
}

// --- precedence ------------------------------------------------------------

test("resolvePort: --port beats PORT, PORT beats the default, both flag spellings work", () => {
  const error = () => assert.fail("no error expected");
  assert.equal(resolvePort(["dev", "--port", "3000"], "dev", "4000", error), 3000);
  assert.equal(resolvePort(["dev", "--port=3001"], "dev", "4000", error), 3001);
  assert.equal(resolvePort(["serve", "--port", "3002"], "serve", undefined, error), 3002);
  assert.equal(resolvePort(["dev"], "dev", "4000", error), 4000);
  assert.equal(resolvePort(["dev"], "dev", undefined, error), 5173);
  assert.equal(resolvePort(["serve"], "serve", undefined, error), 4173);
  // An empty PORT has always meant "unset".
  assert.equal(resolvePort(["dev"], "dev", "", error), 5173);
  // 0 is valid: any free port.
  assert.equal(resolvePort(["dev", "--port", "0"], "dev", "4000", error), 0);
  assert.equal(resolvePort(["dev", "--port", "65535"], "dev", undefined, error), 65535);
  // A CRLF .env file leaves a trailing \r on the value.
  assert.equal(resolvePort(["dev"], "dev", "5000\r", error), 5000);
  // The flag may sit anywhere after the command.
  assert.equal(resolvePort(["dev", "--other", "--port", "3003"], "dev", undefined, error), 3003);
});

test("resolvePort rejects a bad --port value with one corrective line", () => {
  const bad = ["abc", "-1", "80.5", "65536", "70000", "1e3", "0x10", "+80", "5173abc"];
  for (const value of bad) {
    for (const argv of [
      ["dev", "--port", value],
      ["dev", `--port=${value}`]
    ]) {
      const lines = [];
      assert.throws(
        () => resolvePort(argv, "dev", "4000", (line) => lines.push(line)),
        (err) => {
          assert.ok(err instanceof CliError, `${argv.join(" ")} throws a CliError`);
          assert.equal(err.silent, true, "already printed, so the binary must not print it twice");
          assert.equal(
            err.message,
            `Invalid --port "${value}": expected a whole number from 0 to 65535 (0 picks any free port). Use: darkmown dev --port 5173`
          );
          return true;
        }
      );
      assert.deepEqual(lines, [
        `✗ Invalid --port "${value}": expected a whole number from 0 to 65535 (0 picks any free port). Use: darkmown dev --port 5173`
      ]);
    }
  }
});

test("resolvePort rejects a --port with no value instead of silently ignoring it", () => {
  for (const argv of [
    ["dev", "--port"],
    ["dev", "--port="]
  ]) {
    const lines = [];
    assert.throws(
      () => resolvePort(argv, "dev", "4000", (line) => lines.push(line)),
      (err) => err instanceof CliError && err.silent
    );
    assert.deepEqual(lines, ["✗ Missing a value for --port. Use: darkmown dev --port 5173"]);
  }
});

test("resolvePort rejects a bad PORT env value, naming PORT and the serve default", () => {
  const lines = [];
  assert.throws(
    () => resolvePort(["serve"], "serve", "http", (line) => lines.push(line)),
    (err) => err instanceof CliError && err.silent
  );
  assert.deepEqual(lines, [
    '✗ Invalid PORT "http": expected a whole number from 0 to 65535 (0 picks any free port). Use: darkmown serve --port 4173'
  ]);
  // A valid flag wins before a bad PORT is ever read.
  assert.equal(
    resolvePort(["serve", "--port", "0"], "serve", "http", () => assert.fail("not read")),
    0
  );
});

test("help documents --port for dev and serve", () => {
  const help = helpText();
  assert.match(help, /darkmown dev \[--port <n>\]/);
  assert.match(help, /darkmown serve \[--port <n>\]/);
  assert.match(help, /--port <n> .*PORT/);
});

// --- listen error messages -------------------------------------------------

test("listenErrorMessage: a taken port suggests the next one up", () => {
  assert.equal(
    listenErrorMessage({ code: "EADDRINUSE" }, { command: "dev", port: 5173 }),
    "Port 5173 is already in use. Use: darkmown dev --port 5174"
  );
  assert.equal(
    listenErrorMessage({ code: "EADDRINUSE" }, { command: "serve", port: 4173 }),
    "Port 4173 is already in use. Use: darkmown serve --port 4174"
  );
  // There is no port above 65535: fall back to the default.
  assert.equal(
    listenErrorMessage({ code: "EADDRINUSE" }, { command: "dev", port: 65535 }),
    "Port 65535 is already in use. Use: darkmown dev --port 5173"
  );
});

test("listenErrorMessage: a refused port suggests the default, or 0 when the default was refused", () => {
  assert.equal(
    listenErrorMessage({ code: "EACCES" }, { command: "dev", port: 80 }),
    "Permission denied for port 80 (ports below 1024 need root). Use: darkmown dev --port 5173"
  );
  assert.equal(
    listenErrorMessage({ code: "EACCES" }, { command: "serve", port: 443 }),
    "Permission denied for port 443 (ports below 1024 need root). Use: darkmown serve --port 4173"
  );
  // Windows reserves ranges of high ports; the default itself can be refused.
  assert.equal(
    listenErrorMessage({ code: "EACCES" }, { command: "dev", port: 5173 }),
    "Permission denied for port 5173. Use: darkmown dev --port 0"
  );
});

test("listenErrorMessage leaves every other listen error alone", () => {
  for (const code of ["EADDRNOTAVAIL", "ENOTFOUND", "EINVAL", undefined]) {
    assert.equal(listenErrorMessage({ code }, { command: "dev", port: 5173 }), undefined);
  }
});

// --- the real bound port ---------------------------------------------------

test("dev --port 0 prints the real, non-zero port it bound", async () => {
  const root = devProject("dev-zero");
  const c = capture(root);
  await withEnv({ PORT: undefined, HOST: "127.0.0.1" }, async () => {
    const handle = await run(["dev", "--port", "0"], c.env);
    try {
      const { port } = handle.server.address();
      assert.ok(port > 0, "the OS picked a real port");
      assert.ok(
        c.out.log.includes(`Darkmown dev server ready at http://127.0.0.1:${port}`),
        `banner names port ${port}: ${c.out.log.join(" | ")}`
      );
    } finally {
      await handle.close();
    }
  });
});

test("serve --port=0 prints the real port, and the flag beats a busy PORT", async () => {
  const held = await holdPort();
  const busy = held.address().port;
  const root = serveProject("serve-zero");
  const c = capture(root);
  try {
    // PORT points at a port that is taken: if PORT won, this would fail.
    await withEnv({ PORT: String(busy), HOST: "127.0.0.1" }, async () => {
      const handle = await run(["serve", "--port=0"], c.env);
      try {
        const { port } = handle.server.address();
        assert.ok(port > 0);
        assert.notEqual(port, busy);
        assert.deepEqual(c.out.log, [`Darkmown preview of dist at http://127.0.0.1:${port}`]);
      } finally {
        await handle.close();
      }
    });
  } finally {
    await closeServer(held);
  }
});

test("an explicit --port is the port that gets bound and printed", async () => {
  // Find a free port, release it, then ask for it by number. Bound to
  // 127.0.0.1, so the window in which something else could take it is tiny.
  const probe = await holdPort();
  const port = probe.address().port;
  await closeServer(probe);
  const root = serveProject("serve-explicit");
  const c = capture(root);
  await withEnv({ PORT: "1", HOST: "127.0.0.1" }, async () => {
    const handle = await run(["serve", "--port", String(port)], c.env);
    try {
      assert.equal(handle.server.address().port, port);
      assert.deepEqual(c.out.log, [`Darkmown preview of dist at http://127.0.0.1:${port}`]);
    } finally {
      await handle.close();
    }
  });
});

// --- a taken port ----------------------------------------------------------

test("dev on a taken port: one line, a rejection, no build, nothing left running", async () => {
  const held = await holdPort();
  const busy = held.address().port;
  const root = devProject("dev-busy");
  const c = capture(root);
  try {
    await withEnv({ PORT: undefined, HOST: "127.0.0.1" }, async () => {
      const before = await leakableHandles();
      await assert.rejects(
        () => run(["dev", "--port", String(busy)], c.env),
        (err) => {
          assert.ok(err instanceof CliError);
          assert.equal(err.silent, true);
          assert.equal(
            err.message,
            `Port ${busy} is already in use. Use: darkmown dev --port ${busy + 1}`
          );
          return true;
        }
      );
      assert.deepEqual(c.out.error, [
        `✗ Port ${busy} is already in use. Use: darkmown dev --port ${busy + 1}`
      ]);
      assert.deepEqual(c.out.log, [], "no ready line, no build summary");
      assert.deepEqual(await leakableHandles(), before, "no watcher, timer, child or server left");
      // The port is checked before the initial build, so nothing was built.
      assert.equal(fs.existsSync(path.join(root, "dist")), false);
    });
  } finally {
    await closeServer(held);
  }
});

test("serve on a taken port: one line, a rejection, nothing left running", async () => {
  const held = await holdPort();
  const busy = held.address().port;
  const root = serveProject("serve-busy");
  const c = capture(root);
  try {
    await withEnv({ PORT: String(busy), HOST: "127.0.0.1" }, async () => {
      const before = await leakableHandles();
      await assert.rejects(
        () => run(["serve"], c.env),
        (err) => err instanceof CliError && err.silent
      );
      assert.deepEqual(c.out.error, [
        `✗ Port ${busy} is already in use. Use: darkmown serve --port ${busy + 1}`
      ]);
      assert.deepEqual(c.out.log, []);
      assert.deepEqual(await leakableHandles(), before);
    });
  } finally {
    await closeServer(held);
  }
});

// --- the binary --------------------------------------------------------------

test("binary: dev on a taken port prints one line and exits 1, with no stack trace", async () => {
  const held = await holdPort();
  const busy = held.address().port;
  const root = devProject("bin-busy");
  try {
    const result = await runBinary(["dev", "--port", String(busy)], {
      cwd: root,
      env: { HOST: "127.0.0.1", PORT: "" }
    });
    assert.equal(result.code, 1);
    assert.equal(
      result.stderr,
      `✗ Port ${busy} is already in use. Use: darkmown dev --port ${busy + 1}\n`
    );
    assert.equal(result.stdout, "");
    assert.equal(fs.existsSync(path.join(root, "dist")), false, "no build ran");
  } finally {
    await closeServer(held);
  }
});

test("binary: serve with a bad --port prints one line and exits 1", async () => {
  const root = serveProject("bin-bad");
  const result = await runBinary(["serve", "--port", "http"], {
    cwd: root,
    env: { HOST: "127.0.0.1", PORT: "" }
  });
  assert.equal(result.code, 1);
  assert.equal(
    result.stderr,
    '✗ Invalid --port "http": expected a whole number from 0 to 65535 (0 picks any free port). Use: darkmown serve --port 4173\n'
  );
  assert.equal(result.stdout, "");
});

test("binary: any other listen error still surfaces as before (not rewritten)", async () => {
  // 192.0.2.1 is TEST-NET-1 (RFC 5737): never assigned to this machine, so the
  // bind fails at once with EADDRNOTAVAIL. Only EADDRINUSE and EACCES are
  // rewritten; this one keeps crashing loudly with the original error.
  const root = serveProject("bin-other");
  const result = await runBinary(["serve", "--port", "0"], {
    cwd: root,
    env: { HOST: "192.0.2.1", PORT: "" }
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /EADDRNOTAVAIL/);
  assert.doesNotMatch(result.stderr, /Use: darkmown/);
  assert.equal(result.stdout, "");
});
