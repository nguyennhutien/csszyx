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
const requireBinaries = process.argv.includes("--require-binaries");

assertNativeOptionalDependencies(corePackage);

if (workspaceYaml.includes('!packages/core-*')) {
  fail("pnpm-workspace.yaml must include packages/core-* for native publishing.");
}

for (const expected of NATIVE_PLATFORM_PACKAGES) {
  const packagePath = path.join(repoRoot, expected.dir, "package.json");
  if (!existsSync(packagePath)) {
    fail(`${expected.dir}/package.json is missing`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  assertEqual(pkg.name, expected.name, `${expected.dir} name`);
  assertEqual(pkg.version, corePackage.version, `${expected.dir} version`);
  assertEqual(pkg.private, undefined, `${expected.dir} private`);
  assertEqual(pkg.type, "commonjs", `${expected.dir} type`);
  assertArray(pkg.os, expected.os, `${expected.dir} os`);
  assertArray(pkg.cpu, expected.cpu, `${expected.dir} cpu`);
  assertArray(pkg.libc ?? [], expected.libc ?? [], `${expected.dir} libc`);
  assertEqual(pkg.main, `./${expected.node}`, `${expected.dir} main`);
  assertArray(pkg.files, [expected.node], `${expected.dir} files`);

  if (requireBinaries) {
    const nodePath = path.join(repoRoot, expected.dir, expected.node);
    if (!existsSync(nodePath)) {
      fail(`${expected.dir}/${expected.node} is missing`);
    }
  }
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
 * Assert the umbrella package wires every native platform package as an
 * optional workspace dependency. pnpm rewrites these to the package version
 * during pack/publish.
 *
 * @param {{ optionalDependencies?: Record<string, string> }} pkg Core package.
 */
function assertNativeOptionalDependencies(pkg) {
  const optionalDependencies = pkg.optionalDependencies ?? {};

  for (const dependency of nativePackageNames) {
    if (optionalDependencies[dependency] !== "workspace:*") {
      fail(
        `@csszyx/core optionalDependencies must include ${dependency}: "workspace:*"`,
      );
    }
  }

  const unknownNativeDependencies = Object.keys(optionalDependencies).filter(
    (dependency) =>
      dependency.startsWith("@csszyx/core-") &&
      !nativePackageNames.has(dependency),
  );

  if (unknownNativeDependencies.length > 0) {
    fail(
      [
        "@csszyx/core optionalDependencies reference unknown native packages:",
        unknownNativeDependencies.join(", "),
      ].join(" "),
    );
  }
}
