import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { availableTemplates, initProject } from "../src/scaffold.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-tmpl-"));
}

test("availableTemplates lists every shipped template", () => {
  const list = availableTemplates();
  for (const name of ["starter", "blog", "store", "dashboard", "landing"]) {
    assert.ok(list.includes(name), `missing template: ${name}`);
  }
});

test("init defaults to the starter template", () => {
  const root = tmp();
  const result = initProject(root);
  assert.equal(result.template, "starter");
  assert.ok(fs.existsSync(path.join(root, "site/pages/about.md")));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.type, "module", "templates set type:module so api/*.js import as ESM");
});

test("init --template store copies its api function and data", () => {
  const root = tmp();
  const result = initProject(root, { template: "store" });
  assert.equal(result.template, "store");
  assert.ok(fs.existsSync(path.join(root, "api/checkout.js")));
  assert.ok(fs.existsSync(path.join(root, "site/_/products.json")));
});

test("an unknown template errors with the available list", () => {
  assert.throws(
    () => initProject(tmp(), { template: "nope" }),
    /Unknown template "nope".*starter/s
  );
});

test("init never overwrites existing files", () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), "# Mine\n");
  initProject(root, { template: "blog" });
  assert.equal(fs.readFileSync(path.join(root, "site/pages/index.wd"), "utf8"), "# Mine\n");
});

test("every shipped template scaffolds and builds without error", () => {
  for (const name of availableTemplates()) {
    const root = tmp();
    initProject(root, { template: name });
    const { routes } = buildSite(root);
    assert.ok(routes.length > 0, `${name} produced no routes`);
  }
});
