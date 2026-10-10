#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(skillRoot, "vendor/itpay-cli/package");
const metadata = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const entry = resolve(packageRoot, typeof metadata.bin === "string" ? metadata.bin : metadata.bin.itpay);
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ITPAY_CLI_SKILLS_DIR: dirname(skillRoot) },
});
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => { console.error(error.message); process.exit(1); });
