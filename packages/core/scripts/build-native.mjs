#!/usr/bin/env node
// Build the current host's native platform package.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(coreDir, "../..");

const PLATFORM_PACKAGES = {
  "linux-arm64-gnu": "core-linux-arm64-gnu",
  "linux-arm64-musl": "core-linux-arm64-musl",
  "linux-x64-gnu": "core-linux-x64-gnu",
  "linux-x64-musl": "core-linux-x64-musl",
  "darwin-arm64": "core-darwin-arm64",
  "darwin-x64": "core-darwin-x64",
  "win32-arm64-msvc": "core-win32-arm64-msvc",
  "win32-x64-msvc": "core-win32-x64-msvc",
};

const platformKey = getPlatformKey();
const packageDirName = PLATFORM_PACKAGES[platformKey];

if (!packageDirName) {
  fail(`Unsupported native platform: ${platformKey}`);
}

const packageDir = path.join(repoRoot, "packages", packageDirName);
const nodeFile = `csszyx-core.${platformKey}.node`;
const nodePath = path.join(packageDir, nodeFile);
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
 * Get the napi platform key for the current host.
 *
 * @returns {string} Platform key.
 */
function getPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    return `${platform}-${arch}-${isMusl() ? "musl" : "gnu"}`;
  }

  if (platform === "win32") {
    return `${platform}-${arch}-msvc`;
  }

  return `${platform}-${arch}`;
}

/**
 * Detect musl Linux.
 *
 * @returns {boolean} True for musl Linux.
 */
function isMusl() {
  if (typeof process.report?.getReport !== "function") {
    return false;
  }

  const report = process.report.getReport();
  return !report.header?.glibcVersionRuntime;
}

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
