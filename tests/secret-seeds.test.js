// ---------------------------------------------------------------------------
// Secret-shaped seeds — a `:state`/`:store` seed is inlined into the public
// HTML as JSON by design, so a seed that is really an API key or token is
// published to every reader. The compiler emits a build HINT (never an error)
// for the realistic shapes: known key prefixes, JWTs, long high-entropy
// tokens, and private-key headers — including strings nested in array/object
// seeds. False positives must never break a build, so the negatives below are
// as much the contract as the positives.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-secret-seeds-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  try {
    return compilePage(file, createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function secretWarnings(page) {
  return page.warnings.filter((w) => w.includes("looks like a secret"));
}

// Fixture tokens are assembled from fragments at runtime so this file never
// contains a complete secret-shaped literal (GitHub push protection scans
// added lines, and a file testing a secret detector otherwise trips it).
const JWT_HEAD = ["eyJhbGciOiJIUzI1NiIs", "InR5cCI6IkpXVCJ9"].join("");
const JWT = [
  JWT_HEAD,
  ["eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZS", "SI6IkpvaG4ifQ"].join(""),
  ["SflKxwRJSMeKKF2QT4fwp", "MeJf36POk6yJVadQssw5c"].join("")
].join(".");
const LONG_TOKEN = ["Aa1Bb2Cc3Dd4Ee5Ff6Gg7", "Hh8Ii9Jj0Kk1Ll2Mm3N"].join("");
const AWS_KEY = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
const PREFIXED_KEYS = [
  ["sk-proj-", "AbCdEfGhIjKlMnOp", "QrStUvWx"].join(""),
  ["sk_", "live_", "4eC39HqLyjWDarjtT1zd", "p7dc"].join(""),
  ["sk_", "test_", "4eC39HqLyjWDarjtT1zd", "p7dc"].join(""),
  ["ghp_", "aBcDeFgHiJkLmNoPqRsT", "uVwXyZ0123456789"].join(""),
  ["gho_", "aBcDeFgHiJkLmNoPqRsT", "uVwXyZ0123456789"].join(""),
  ["xoxb-", "123456789012-", "AbCdEfGhIjKlMnOp"].join(""),
  ["xoxp-", "123456789012-", "AbCdEfGhIjKlMnOp"].join("")
];

test("a JWT seed fires the hint on :state", () => {
  const page = compile([`:state token = "${JWT}"`]);
  assert.equal(secretWarnings(page).length, 1);
  assert.match(
    secretWarnings(page)[0],
    /index\.wd:1: :state "token" seed looks like a secret — it will be inlined into public HTML\./
  );
  assert.match(
    secretWarnings(page)[0],
    /Seed empty and fill it from an api\/ endpoint at runtime\./
  );
});

test("a long unbroken mixed-charset token fires", () => {
  const page = compile([`:state apiKey = "${LONG_TOKEN}"`]);
  assert.equal(secretWarnings(page).length, 1);
});

test("an AWS-style AKIA key fires", () => {
  const page = compile([`:state aws = "${AWS_KEY}"`]);
  assert.equal(secretWarnings(page).length, 1);
});

test("every documented key prefix fires", () => {
  for (const key of PREFIXED_KEYS) {
    const page = compile([`:state k = "${key}"`]);
    assert.equal(secretWarnings(page).length, 1, `expected a hint for ${key}`);
  }
});

const PEM_HEAD = ["-----", "BEGIN RSA PRIVATE KEY-----"].join("");
const SSH_HEAD = ["-----", "BEGIN OPENSSH PRIVATE KEY-----"].join("");

test("a private-key header fires", () => {
  const page = compile([`:store pem = "${PEM_HEAD}"`, `:state other = "${SSH_HEAD}"`]);
  assert.equal(secretWarnings(page).length, 2);
});

test("the hint fires for :store the same as :state, persist or not", () => {
  assert.equal(secretWarnings(compile([`:store token = "${JWT}"`])).length, 1);
  assert.equal(secretWarnings(compile([`:store token = "${JWT}" ephemeral`])).length, 1);
  assert.equal(secretWarnings(compile([`:state token = "${JWT}" persist`])).length, 1);
  assert.equal(secretWarnings(compile([`:state token = "${JWT}" persist from-url`])).length, 1);
});

test("the hint names :store as :store in the message", () => {
  const page = compile([`:store creds = "${AWS_KEY}"`]);
  assert.match(secretWarnings(page)[0], /:store "creds" seed looks like a secret/);
});

test("a secret nested in an object or array seed still fires", () => {
  assert.equal(
    secretWarnings(compile([`:state cfg = {"outer": {"key": "${AWS_KEY}"}}`])).length,
    1
  );
  assert.equal(secretWarnings(compile([`:state toks = ["fine", "${LONG_TOKEN}"]`])).length, 1);
});

test("a multi-line array seed is scanned too", () => {
  const page = compile([":store rows = [", `  {"id": 1, "token": "${AWS_KEY}"}`, "] persist"]);
  assert.equal(secretWarnings(page).length, 1);
  assert.match(secretWarnings(page)[0], /index\.wd:1: :store "rows"/);
});

test("the hint fires once per declaration, not once per secret", () => {
  const page = compile([
    `:store creds = {"a": "${PREFIXED_KEYS[1]}", "b": ["${JWT}", "${AWS_KEY}"]}`
  ]);
  assert.equal(secretWarnings(page).length, 1);
});

test("the hint never blocks the build — the seed still compiles through", () => {
  const page = compile([`:state token = "${JWT}"`]);
  assert.ok(page.html.includes(JWT_HEAD));
  assert.equal(page.assets.runtime, true);
});

test("the documented auth pattern stays quiet", () => {
  // The AGENTS.md/README example seeds EMPTY and fills from an api/ endpoint.
  const page = compile([
    ":store session = {}",
    "",
    ':form action="/api/login" into login',
    ":input email type=email required",
    ':submit "Sign in"',
    ":endform",
    "",
    ":effect login -> session merge login",
    "",
    ':fetch feed from "/api/feed" headers=session refresh="/auth/refresh"'
  ]);
  assert.equal(secretWarnings(page).length, 0);
});

test("ordinary seeds stay quiet: prose, URLs, paths, short strings", () => {
  const page = compile([
    ":state title = Hello world",
    ':state empty = ""',
    ':state docs = "https://example.com/docs/getting-started"',
    ':state font = "/__wd/media/fonts/newsreader.woff2"',
    ':state id = "abc123"',
    ':state status = "draft"'
  ]);
  assert.equal(secretWarnings(page).length, 0);
});

test("lowercase-only long strings stay quiet: slugs, hashes, UUIDs", () => {
  const page = compile([
    ":state slug = v2-10-0-release-notes-and-migration-guide",
    ':state hash = "a3f5c8d9e2b1a3f5c8d9e2b1a3f5c8d9e2b1a3f5"',
    ':state uuid = "550e8400-e29b-41d4-a716-446655440000"',
    ':state word = "abcdefghijklmnopqrstuvwxyzabcdef"'
  ]);
  assert.equal(secretWarnings(page).length, 0);
});

test("a prefix alone is not enough: short bodies and prose stay quiet", () => {
  const page = compile([
    ':state k = "sk-short"',
    ':state note = "sk-ipping rocks today"',
    ':state g = "ghp_"'
  ]);
  assert.equal(secretWarnings(page).length, 0);
});

test("non-string seeds are never candidates, nested or not", () => {
  const page = compile([
    ":state n = 42",
    ":state flag = true",
    ":state nothing = null",
    ':state data = {"n": 42, "ok": true, "nothing": null, "list": [1, 2]}'
  ]);
  assert.equal(secretWarnings(page).length, 0);
});
