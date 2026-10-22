import assert from "node:assert/strict";
import test from "node:test";
import { refuseLocalRequest } from "../src/dev.js";

// The dev/preview servers bind to loopback, which does not stop a website the
// developer is visiting from reaching them (DNS rebinding, cross-site POSTs).
const check = (headers, url = "/", options = { bindHost: "127.0.0.1" }) =>
  refuseLocalRequest({ url, headers }, options);

test("loopback names, IP literals and the bind address are served", () => {
  for (const host of [
    "localhost:5173",
    "127.0.0.1:5173",
    "[::1]:5173",
    "app.localhost",
    "192.168.1.5:5173"
  ]) {
    assert.equal(check({ host }), null, host);
  }
  assert.equal(check({ host: "devbox.lan:5173" }, "/", { bindHost: "devbox.lan" }), null);
});

test("a rebound domain name is refused, on pages and api alike", () => {
  for (const url of ["/", "/__wd/dev-events", "/.wd-dev-deps.json", "/api/secret"]) {
    assert.match(check({ host: "evil.example:5173" }, url) ?? "", /not allowed/, url);
  }
  assert.ok(check({}), "a request with no Host is refused");
});

test("/api/ refuses cross-site callers but allows other local origins", () => {
  const host = "localhost:5173";
  assert.ok(check({ host, origin: "https://evil.example" }, "/api/x"));
  assert.ok(check({ host, origin: "null" }, "/api/x"), "sandboxed iframe / file:// origin");
  assert.ok(
    check({ host, origin: "http://203.0.113.9" }, "/api/x"),
    "a public IP origin is not local"
  );
  assert.ok(check({ host, "sec-fetch-site": "cross-site" }, "/api/x"));
  assert.equal(check({ host, origin: "http://localhost:3000" }, "/api/x"), null);
  assert.equal(
    check({ host: "192.168.1.5:5173", origin: "http://192.168.1.5:5173" }, "/api/x"),
    null
  );
  assert.equal(
    check({ host, origin: "https://evil.example" }, "/blog/"),
    null,
    "pages are not origin-gated"
  );
});

test("DARKMOWN_ALLOWED_HOSTS admits a tunnel domain, and * disables the guard", () => {
  const tunnel = { bindHost: "127.0.0.1", allowedHosts: "abc.ngrok.app, other.example" };
  assert.equal(check({ host: "abc.ngrok.app" }, "/", tunnel), null);
  assert.equal(
    check({ host: "abc.ngrok.app", origin: "https://abc.ngrok.app" }, "/api/x", tunnel),
    null
  );
  assert.equal(
    check({ host: "x.example", origin: "https://y.example" }, "/api/x", { allowedHosts: "*" }),
    null
  );
});
