#!/usr/bin/env node
// Verifies non-host optional native package resolution fails loudly and stably.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  NATIVE_PLATFORM_PACKAGES,
  getHostNativePackage,
} from "./native-platforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(coreDir, "../..");

const host = getHostNativePackage(repoRoot);
const nonHostPackage = NATIVE_PLATFORM_PACKAGES.find(
  (pkg) => pkg.name !== host.packageInfo?.name,
);

if (!nonHostPackage) {
  fail("No non-host native package is available in the platform manifest.");
}

const native = await import(pathToFileURL(path.join(coreDir, "native", "index.js")));

try {
  native.loadNativeBinding(nonHostPackage.name);
} catch (err) {
  if (err instanceof native.CsszyxNativeUnavailableError) {
    assertUnavailableError(err, nonHostPackage.name);
    console.log(`[native-unavailable-smoke] ${nonHostPackage.name} failed loudly as expected.`);
    process.exit(0);
  }

  throw err;
}

fail(`Unexpectedly loaded non-host native package ${nonHostPackage.name}.`);

/**
 * Checks the stable unavailable-error contract.
 *
 * @param {Error & { code?: string, packageName?: string }} err Error thrown by the native loader.
 * @param {string} packageName Expected optional native package name.
 */
function assertUnavailableError(err, packageName) {
  if (err.code !== "CSSZYX_NATIVE_UNAVAILABLE") {
    fail(`Unexpected native error code: ${err.code}`);
  }
  if (err.packageName !== packageName) {
    fail(`Unexpected native package name: ${err.packageName}`);
  }
  if (!err.message.includes('build.parser: "oxc" or "babel"')) {
    fail(`Unavailable error missed parser fallback guidance: ${err.message}`);
  }
}

/**
 * Print a smoke failure and exit.
 *
 * @param {string} message Failure message.
 * @returns {never}
 */
function fail(message) {
  console.error(`[native-unavailable-smoke] ${message}`);
  process.exit(1);
}
