#!/usr/bin/env node
// Build, load, and clean the current host's native addon.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getHostNativePackage } from "./native-platforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(coreDir, "../..");

const { platformKey, packageDir, nodePath } = getHostNativePackage(repoRoot);

if (!packageDir || !nodePath) {
  fail(`Unsupported native platform: ${platformKey}`);
}

const generatedDtsPath = path.join(packageDir, "index.d.ts");

try {
  runBuild();
  assertFile(nodePath);

  const native = await import(
    pathToFileURL(path.join(coreDir, "native", "index.js"))
  );
  const binding = native.loadNativeBinding(packageDir);

  if (typeof binding?.transformBatch !== "function") {
    fail("Loaded native binding does not export transformBatch().");
  }

  assertNotImplemented(binding);
  console.log(`[native-smoke] Loaded ${path.relative(repoRoot, nodePath)}`);
} finally {
  rmSync(nodePath, { force: true });
  rmSync(generatedDtsPath, { force: true });
}

function runBuild() {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "build-native.mjs"), "--release", "--clean"],
    {
      cwd: coreDir,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertFile(filePath) {
  if (!existsSync(filePath)) {
    fail(
      `Expected native binary was not created: ${path.relative(repoRoot, filePath)}`,
    );
  }
}

function assertNotImplemented(binding) {
  try {
    binding.transformBatch([
      {
        filename: path.join(repoRoot, "fixtures", "native-smoke.tsx"),
        source: "<div sz={{ p: 4 }} />",
      },
    ]);
  } catch (err) {
    if (
      typeof err?.message === "string" &&
      err.message.includes("not implemented yet")
    ) {
      return;
    }

    throw err;
  }

  fail(
    "Native transform unexpectedly completed before the Rust parser is implemented.",
  );
}

/**
 * Print a smoke failure and exit.
 *
 * @param {string} message Failure message.
 * @returns {never}
 */
function fail(message) {
  console.error(`[native-smoke] ${message}`);
  process.exit(1);
}
