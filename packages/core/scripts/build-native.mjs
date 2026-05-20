#!/usr/bin/env node
// Build the current host's native platform package.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getHostNativePackage } from "./native-platforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(coreDir, "../..");

const { platformKey, packageDir, nodePath } = getHostNativePackage(repoRoot);

if (!packageDir || !nodePath) {
  fail(`Unsupported native platform: ${platformKey}`);
}

const generatedDtsPath = path.join(packageDir, "index.d.ts");

if (process.argv.includes("--clean")) {
  rmSync(nodePath, { force: true });
  rmSync(generatedDtsPath, { force: true });
}

const args = [
  "build",
  "--manifest-path",
  "Cargo.toml",
  "--package-json-path",
  "package.json",
  "--features",
  process.argv.includes("--native-engine") ? "native,native-engine" : "native",
  "--platform",
  "--no-js",
  "--no-dts-header",
  "--output-dir",
  packageDir,
];

if (process.argv.includes("--release")) {
  args.push("--release");
}

const result = spawnSync("napi", args, {
  cwd: coreDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(nodePath)) {
  fail(
    `Expected native binary was not created: ${path.relative(repoRoot, nodePath)}`,
  );
}

rmSync(generatedDtsPath, { force: true });

console.log(`[native-build] Built ${path.relative(repoRoot, nodePath)}`);

/**
 * Print a build failure and exit.
 *
 * @param {string} message Failure message.
 * @returns {never}
 */
function fail(message) {
  console.error(`[native-build] ${message}`);
  process.exit(1);
}
