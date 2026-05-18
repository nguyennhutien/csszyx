#!/usr/bin/env node
// Validate metadata-only native platform package scaffolds.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const PACKAGES = [
  {
    dir: "packages/core-linux-x64-gnu",
    name: "@csszyx/core-linux-x64-gnu",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
    node: "csszyx-core.linux-x64-gnu.node",
  },
  {
    dir: "packages/core-linux-x64-musl",
    name: "@csszyx/core-linux-x64-musl",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["musl"],
    node: "csszyx-core.linux-x64-musl.node",
  },
  {
    dir: "packages/core-linux-arm64-gnu",
    name: "@csszyx/core-linux-arm64-gnu",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["glibc"],
    node: "csszyx-core.linux-arm64-gnu.node",
  },
  {
    dir: "packages/core-linux-arm64-musl",
    name: "@csszyx/core-linux-arm64-musl",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["musl"],
    node: "csszyx-core.linux-arm64-musl.node",
  },
  {
    dir: "packages/core-darwin-x64",
    name: "@csszyx/core-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    node: "csszyx-core.darwin-x64.node",
  },
  {
    dir: "packages/core-darwin-arm64",
    name: "@csszyx/core-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    node: "csszyx-core.darwin-arm64.node",
  },
  {
    dir: "packages/core-win32-x64-msvc",
    name: "@csszyx/core-win32-x64-msvc",
    os: ["win32"],
    cpu: ["x64"],
    node: "csszyx-core.win32-x64-msvc.node",
  },
  {
    dir: "packages/core-win32-arm64-msvc",
    name: "@csszyx/core-win32-arm64-msvc",
    os: ["win32"],
    cpu: ["arm64"],
    node: "csszyx-core.win32-arm64-msvc.node",
  },
];

let errors = 0;

for (const expected of PACKAGES) {
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
