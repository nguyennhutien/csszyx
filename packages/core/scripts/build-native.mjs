#!/usr/bin/env node
// Build the current host's native platform package.
//
// `@napi-rs/cli` is pinned EXACTLY, and 3.8.x is held back on purpose. That
// line added a filesystem-transaction layer — undocumented; the 3.8.0 notes
// mention only WASI targets, while `cli.js` grows from 594 KB to 1.9 MB — that
// writes each output to a temp file and then re-reads it to verify the hash
// before swapping it in. On a Docker Desktop bind mount (`fakeowner`, magic
// 0x6a656a63) the re-read does not see the settled contents, so every build
// aborts with "replacement changed while it was prepared" and leaves the
// addon deleted, because the smoke script removes it in a `finally`.
//
// Measured, not assumed: the same command with the same 3.8.6 succeeds when
// `--output-dir` points at container-local overlayfs and fails when it points
// at the mount. 3.8.6 is the latest release and is affected, so upgrading is
// not the way out, and the CLI exposes no flag or environment variable that
// turns the layer off. Upstream napi-rs#3444 reports the same machinery
// misbehaving from 3.7.3 → 3.8.2 and is unanswered.
//
// CI is unaffected — runner filesystems are ordinary — so the pin exists to
// keep local builds and `verify:ci:fast` working. Re-test before raising it.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getHostNativePackage,
  getTargetNativePackage,
} from "./native-platforms.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(coreDir, "../..");

const target = readArgValue("--target");
const resolved = target
  ? {
      platformKey: target,
      ...getTargetNativePackage(repoRoot, target),
    }
  : getHostNativePackage(repoRoot);
const { platformKey, packageInfo, packageDir, nodePath } = resolved;

if (!packageInfo || !packageDir || !nodePath) {
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

if (target) {
  args.push("--target", target);
}

if (process.argv.includes("--cross-compile")) {
  args.push("--cross-compile");
}

if (process.argv.includes("--release")) {
  args.push("--release");
}

const result = spawnSync("napi", args, {
  cwd: coreDir,
  env: nativeBuildEnv(),
  stdio: "inherit",
  shell: process.platform === "win32",
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
 * Read a CLI argument value.
 *
 * @param {string} name Argument name.
 * @returns {string | null} Argument value.
 */
function readArgValue(name) {
  const equalPrefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(equalPrefix));
  if (equalArg) {
    return equalArg.slice(equalPrefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }

  return null;
}

/**
 * Build native binaries with the repository-pinned Rust toolchain.
 *
 * Some devcontainer shells may still export an older RUSTUP_TOOLCHAIN from a
 * previous session. Leaving it in place overrides rust-toolchain.toml and can
 * make oxc fail its rustc-version check, so native builds intentionally defer
 * to the repo config.
 *
 * @returns {NodeJS.ProcessEnv} Child process environment.
 */
function nativeBuildEnv() {
  const env = { ...process.env };
  delete env.RUSTUP_TOOLCHAIN;
  return env;
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
