import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const lock = JSON.parse(readFileSync(new URL("../skills/itpay/bundle.lock.json", import.meta.url)));
const launcher = fileURLToPath(new URL("../skills/itpay/scripts/itpay.mjs", import.meta.url));

test("bundled CLI matches the locked version", () => {
  assert.equal(execFileSync(process.execPath, [launcher, "--version"], { encoding: "utf8" }).trim(), lock.version);
  assert.equal(lock.package, "@itpay/cli");
  assert.match(lock.npmIntegrity, /^sha512-/);
});
