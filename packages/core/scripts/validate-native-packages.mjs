#!/usr/bin/env node
// Validate metadata-only native platform package scaffolds.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NATIVE_PLATFORM_PACKAGES } from "./native-platforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

let errors = 0;

const corePackagePath = path.join(repoRoot, "packages/core/package.json");
const workspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
const corePackage = JSON.parse(readFileSync(corePackagePath, "utf8"));
const workspaceYaml = readFileSync(workspacePath, "utf8");
const nativePackageNames = new Set(
  NATIVE_PLATFORM_PACKAGES.map((packageInfo) => packageInfo.name),
);

assertNoNativeOptionalDependencies(corePackage);

if (!workspaceYaml.includes('!packages/core-*')) {
  fail(
    'pnpm-workspace.yaml must keep packages/core-* excluded until native packages are publish-ready.',
  );
}

for (const expected of NATIVE_PLATFORM_PACKAGES) {
  const packagePath = path.join(repoRoot, expected.dir, "package.json");
  if (!existsSync(packagePath)) {
    fail(`${expected.dir}/package.json is missing`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  assertEqual(pkg.name, expected.name, `${expected.dir} name`);
  assertEqual(pkg.private, true, `${expected.dir} private`);
  assertEqual(pkg.type, "commonjs", `${expected.dir} type`);
  assertArray(pkg.os, expected.os, `${expected.dir} os`);
  assertArray(pkg.cpu, expected.cpu, `${expected.dir} cpu`);
  assertArray(pkg.libc ?? [], expected.libc ?? [], `${expected.dir} libc`);
  assertEqual(pkg.main, `./${expected.node}`, `${expected.dir} main`);
  assertArray(pkg.files, [expected.node], `${expected.dir} files`);
}

if (errors > 0) {
  process.exit(1);
}

/**
 * Record a validation failure.
 *
 * @param {string} message Failure message.
 */
function fail(message) {
  errors++;
  console.error(`[native-packages] ${message}`);
}

/**
 * Assert scalar equality.
 *
 * @param {unknown} actual Actual value.
 * @param {unknown} expected Expected value.
 * @param {string} label Assertion label.
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Assert array equality.
 *
 * @param {unknown} actual Actual value.
 * @param {unknown[]} expected Expected array.
 * @param {string} label Assertion label.
 */
function assertArray(actual, expected, label) {
  if (!Array.isArray(actual)) {
    fail(`${label}: expected array, got ${JSON.stringify(actual)}`);
    return;
  }

  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Assert the umbrella package has not been half-wired to unpublished optional
 * native packages.
 *
 * @param {{ optionalDependencies?: Record<string, string> }} pkg Core package.
 */
function assertNoNativeOptionalDependencies(pkg) {
  const optionalDependencies = Object.keys(pkg.optionalDependencies ?? {});
  const wiredNativeDependencies = optionalDependencies.filter((dependency) =>
    nativePackageNames.has(dependency),
  );

  if (wiredNativeDependencies.length > 0) {
    fail(
      [
        "@csszyx/core optionalDependencies already reference native packages,",
        "but packages/core-* are still private and excluded from the workspace.",
        `Remove or fully publish-wire: ${wiredNativeDependencies.join(", ")}`,
      ].join(" "),
    );
  }
}
