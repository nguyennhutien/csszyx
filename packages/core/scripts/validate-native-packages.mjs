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
const rootPackagePath = path.join(repoRoot, "package.json");
const workspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
const releaseWorkflowPath = path.join(
  repoRoot,
  ".github/workflows/release.yml",
);
const nativeTypesPath = path.join(repoRoot, "packages/core/native/index.d.ts");
const nativeDocsPath = path.join(repoRoot, "packages/core/NATIVE-TRANSFORM.md");
const corePackage = JSON.parse(readFileSync(corePackagePath, "utf8"));
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const workspaceYaml = readFileSync(workspacePath, "utf8");
const releaseWorkflow = readFileSync(releaseWorkflowPath, "utf8");
const nativeTypes = readFileSync(nativeTypesPath, "utf8");
const nativeDocs = readFileSync(nativeDocsPath, "utf8");
const nativePackageNames = new Set(
  NATIVE_PLATFORM_PACKAGES.map((packageInfo) => packageInfo.name),
);
const requireBinaries = process.argv.includes("--require-binaries");

assertNativeOptionalDependencies(corePackage);
assertSupportedArchitectures(workspaceYaml);
assertReleaseMatrix(releaseWorkflow);
assertNativeTypes(nativeTypes);
assertNativeDocs(nativeDocs);

if (workspaceYaml.includes("!packages/core-*")) {
  fail(
    "pnpm-workspace.yaml must include packages/core-* for native publishing.",
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
  assertEqual(pkg.version, corePackage.version, `${expected.dir} version`);
  assertEqual(pkg.private, undefined, `${expected.dir} private`);
  assertEqual(pkg.type, "commonjs", `${expected.dir} type`);
  assertArray(pkg.os, expected.os, `${expected.dir} os`);
  assertArray(pkg.cpu, expected.cpu, `${expected.dir} cpu`);
  assertArray(pkg.libc ?? [], expected.libc ?? [], `${expected.dir} libc`);
  assertEqual(pkg.main, `./${expected.node}`, `${expected.dir} main`);
  assertArray(pkg.files, [expected.node], `${expected.dir} files`);

  // npm provenance verifies the published tarball against the building repo,
  // so every published package needs a non-empty repository.url. An empty one
  // fails publish with a 422 (it happened to the native stubs once).
  const repoUrl =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!repoUrl) {
    fail(`${expected.dir} is missing repository.url (required for npm provenance)`);
  }

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

/**
 * Assert pnpm installs every optional native workspace package for pack/publish
 * rewrite regardless of the current host platform.
 *
 * pnpm 11 moved this config from package.json#pnpm to pnpm-workspace.yaml, so
 * the values are read from the workspace file rather than the root package.
 *
 * @param {string} workspaceYaml pnpm-workspace.yaml contents.
 */
function assertSupportedArchitectures(workspaceYaml) {
  const supported = parseSupportedArchitectures(workspaceYaml);
  for (const packageInfo of NATIVE_PLATFORM_PACKAGES) {
    assertIncludes(
      supported.os,
      packageInfo.os[0],
      "supportedArchitectures.os",
    );
    assertIncludes(
      supported.cpu,
      packageInfo.cpu[0],
      "supportedArchitectures.cpu",
    );
    for (const libc of packageInfo.libc ?? []) {
      assertIncludes(supported.libc, libc, "supportedArchitectures.libc");
    }
  }
}

/**
 * Read the os/cpu/libc arrays from the `supportedArchitectures:` block of
 * pnpm-workspace.yaml. The block is a fixed shape (top-level key, three nested
 * list keys with `- value` items), so a small indentation-aware scan is enough
 * and avoids adding a YAML dependency to this validator.
 *
 * @param {string} workspaceYaml pnpm-workspace.yaml contents.
 * @returns {{ os: string[], cpu: string[], libc: string[] }}
 */
function parseSupportedArchitectures(workspaceYaml) {
  const result = { os: [], cpu: [], libc: [] };
  const lines = workspaceYaml.split("\n");
  const start = lines.findIndex((line) => line.startsWith("supportedArchitectures:"));
  if (start === -1) {
    fail("pnpm-workspace.yaml is missing supportedArchitectures.");
    return result;
  }
  let currentKey = null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      continue;
    }
    // A non-indented line ends the block.
    if (!line.startsWith(" ")) {
      break;
    }
    const keyMatch = /^ {2}(os|cpu|libc):\s*$/.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1];
      continue;
    }
    const itemMatch = /^ {4}-\s*(\S+)\s*$/.exec(line);
    if (itemMatch && currentKey) {
      result[currentKey].push(itemMatch[1]);
    }
  }
  return result;
}

/**
 * Assert release.yml keeps one native build row for every platform package.
 *
 * @param {string} workflow Release workflow contents.
 */
function assertReleaseMatrix(workflow) {
  for (const packageInfo of NATIVE_PLATFORM_PACKAGES) {
    assertTextIncludes(
      workflow,
      `target: ${packageInfo.triple}\n            platform: ${packageInfo.platformKey}`,
      "release native matrix target/platform pair",
    );
    assertTextIncludes(
      workflow,
      `platform: ${packageInfo.platformKey}`,
      "release native matrix",
    );
    assertTextIncludes(
      workflow,
      `target: ${packageInfo.triple}`,
      "release native matrix",
    );
    assertTextIncludes(
      workflow,
      `packages/core-\${{ matrix.platform }}/csszyx-core.\${{ matrix.platform }}.node`,
      "release native artifact path",
    );
  }
}

/**
 * Assert the public TypeScript package-name union matches the runtime platform
 * manifest. This keeps `getNativePackageName()` and the exported
 * `NativePlatformPackage` type from drifting apart when platforms are added or
 * renamed.
 *
 * @param {string} types Native declaration file contents.
 */
function assertNativeTypes(types) {
  const packageNames = new Set(
    [...types.matchAll(/['"](@csszyx\/core-[^'"]+)['"]/g)].map(
      (match) => match[1],
    ),
  );

  assertSetEqual(
    packageNames,
    nativePackageNames,
    "native/index.d.ts packages",
  );
}

/**
 * Assert the platform package docs table lists every runtime platform package
 * and target triple. The docs are release-operator material, so stale docs can
 * cause missed native artifacts even when code is correct.
 *
 * @param {string} docs Native transform docs contents.
 */
function assertNativeDocs(docs) {
  for (const packageInfo of NATIVE_PLATFORM_PACKAGES) {
    assertTextIncludes(docs, packageInfo.name, "native docs package table");
    assertTextIncludes(docs, packageInfo.triple, "native docs package table");
  }
}

/**
 * Assert an array contains a value.
 *
 * @param {unknown} actual Actual array.
 * @param {string} expected Expected value.
 * @param {string} label Assertion label.
 */
function assertIncludes(actual, expected, label) {
  if (!Array.isArray(actual) || !actual.includes(expected)) {
    fail(`${label}: expected to include ${JSON.stringify(expected)}`);
  }
}

/**
 * Assert two sets contain the same values.
 *
 * @param {Set<string>} actual Actual values.
 * @param {Set<string>} expected Expected values.
 * @param {string} label Assertion label.
 */
function assertSetEqual(actual, expected, label) {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      [
        `${label}: mismatch`,
        missing.length > 0 ? `missing ${missing.join(", ")}` : null,
        extra.length > 0 ? `extra ${extra.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

/**
 * Assert text contains a substring.
 *
 * @param {string} text Text to inspect.
 * @param {string} expected Expected substring.
 * @param {string} label Assertion label.
 */
function assertTextIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    fail(`${label}: expected to include ${JSON.stringify(expected)}`);
  }
}
