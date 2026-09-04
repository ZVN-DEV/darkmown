// ---------------------------------------------------------------------------
// F5 — file upload.
//
// `:input photo type=file` was already accepted (the `type=` value is not a
// whitelist), but the form around it was not: a native submit urlencoded the
// body, which sends the file's NAME and nothing else, and the runtime's
// round-trip did the same. A `:form` containing a file field now declares
// `enctype="multipart/form-data"` and the runtime posts the FormData itself.
//
// The third half is the local serverless runner: this file proves an actual
// multipart POST reaches an `api/` handler intact, so the demo is real.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleApiRequest } from "../src/api-runner.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-upload-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), lines.join("\n"));
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const body = (page) => page.html.slice(page.html.indexOf("<main"), page.html.indexOf("</main>"));

function errorFor(lines) {
  try {
    compile(lines);
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// Compile side
// ---------------------------------------------------------------------------

test(":input type=file produces a real file input", () => {
  const html = body(
    compile([':form action="/api/upload"', ":input photo type=file", ':submit "Send"', ":endform"])
  );
  assert.match(html, /<input type="file" name="photo" aria-label="Photo">/);
});

test("a form containing a file field declares multipart", () => {
  const html = body(
    compile([':form action="/api/upload"', ":input photo type=file", ':submit "Up"', ":endform"])
  );
  assert.match(html, /<form action="\/api\/upload" method="post" enctype="multipart\/form-data">/);
});

test("the round-trip form gets the enctype too", () => {
  const html = body(
    compile([
      ':form into reply action="/api/upload"',
      ":input photo type=file",
      ':submit "Up"',
      ":endform"
    ])
  );
  assert.match(
    html,
    /data-wd-form="reply" action="\/api\/upload" method="post" enctype="multipart\/form-data"/
  );
});

test("NEGATIVE CONTROL: a form with no file field is unchanged", () => {
  const html = body(
    compile([':form action="/api/echo"', ":input email type=email", ':submit "Go"', ":endform"])
  );
  assert.match(html, /<form action="\/api\/echo" method="post">/);
  assert.doesNotMatch(html, /enctype/);
});

test('a file field with method="get" is WD452', () => {
  const error = errorFor([
    ':form action="/api/upload" method="get"',
    ":input photo type=file",
    ':submit "Up"',
    ":endform"
  ]);
  assert.match(error.message, /\[WD452\]/);
  assert.match(error.message, /has a file field and method="get"/);
  assert.match(error.message, /a GET request has no body/);
  assert.equal(error.wd.code, "WD452");
  assert.equal(error.wd.line, 1);
});

test('method="get" is still fine without a file field', () => {
  const html = body(
    compile([':form action="/search" method="get"', ":input q", ':submit "Go"', ":endform"])
  );
  assert.match(html, /method="get"/);
});

// ---------------------------------------------------------------------------
// The local serverless runner passes a multipart body through untouched.
// ---------------------------------------------------------------------------

const ECHO_UPLOAD = `export default async function (request) {
  const form = await request.formData();
  const file = form.get("photo");
  return Response.json({
    type: request.headers.get("content-type").split(";")[0],
    name: file.name,
    size: file.size,
    note: form.get("note")
  });
}
`;

test("a multipart POST reaches an api/ handler with the file intact", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-upload-api-"));
  const apiDir = path.join(root, "api");
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(path.join(apiDir, "upload.mjs"), ECHO_UPLOAD);

  const server = http.createServer((req, res) => {
    handleApiRequest({ apiDir, req, res }).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end("no route");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());

  const form = new FormData();
  form.append("photo", new Blob(["hello darkmown"], { type: "text/plain" }), "notes.txt");
  form.append("note", "a caption");
  const response = await fetch(`http://127.0.0.1:${port}/api/upload`, {
    method: "POST",
    body: form
  });
  const reply = await response.json();

  server.close();
  fs.rmSync(root, { recursive: true, force: true });

  assert.equal(response.status, 200);
  assert.equal(reply.type, "multipart/form-data", "the runner did not rewrite the content-type");
  assert.equal(reply.name, "notes.txt");
  assert.equal(reply.size, "hello darkmown".length);
  assert.equal(reply.note, "a caption", "ordinary fields ride along");
});
