import { execFileSync } from "node:child_process";
import test from "node:test";

test("package consumer smoke script completes", { timeout: 60_000 }, () => {
  execFileSync(process.execPath, ["scripts/smoke-consumer.mjs"], { stdio: "pipe" });
});
