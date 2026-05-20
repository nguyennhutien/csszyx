#!/usr/bin/env node
// Build, load, and clean the current host's native-engine addon.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const nodePath = path.join(packageDir, `csszyx-core.${platformKey}.node`);
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

  assertNativeEngineTransform(binding);
  console.log(
    `[native-engine-smoke] Loaded ${path.relative(repoRoot, nodePath)}`,
  );
} finally {
  rmSync(nodePath, { force: true });
  rmSync(generatedDtsPath, { force: true });
}

function runBuild() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "build-native.mjs"),
      "--release",
      "--clean",
      "--native-engine",
    ],
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

function assertNativeEngineTransform(binding) {
  const results = binding.transformBatch([
    {
      filename: path.join(repoRoot, "fixtures", "native-engine-smoke.tsx"),
      source:
        'const App = () => <><div sz={{ p: 4 }} /><span className="x" sz={{ m: 2 }} /></>;',
    },
    {
      filename: path.join(repoRoot, "fixtures", "plain.tsx"),
      source: 'const Plain = () => <div className="x" />;',
    },
    {
      filename: path.join(repoRoot, "fixtures", "string-sz.tsx"),
      source: 'const StringSz = () => <div sz="px-4 py-2" />;',
    },
    {
      filename: path.join(repoRoot, "fixtures", "array-sz.tsx"),
      source:
        "const ArraySz = () => <div sz={[{ flex: true }, false, null, { p: 4 }]} />;",
    },
    {
      filename: path.join(repoRoot, "fixtures", "spread-sz.tsx"),
      source: "const SpreadSz = () => <div sz={{ ...{ p: 4 }, m: 2 }} />;",
    },
    {
      filename: path.join(repoRoot, "fixtures", "empty-array-sz.tsx"),
      source:
        "const EmptyArraySz = () => <div sz={[false, null, undefined]} />;",
    },
    {
      filename: path.join(repoRoot, "fixtures", "dynamic-sz.tsx"),
      source:
        "const DynamicSz = ({ styles }) => <><div sz={{ p: 4 }} /><span sz={styles} /></>;",
    },
    {
      filename: path.join(repoRoot, "fixtures", "merge-runtime-sz.tsx"),
      source:
        'const MergeRuntimeSz = ({ styles }) => <div className="existing" sz={styles} />;',
    },
    {
      filename: path.join(repoRoot, "fixtures", "merge-dynamic-class.tsx"),
      source:
        "const MergeDynamicClass = ({ styles }) => <div className={getClass()} sz={styles} />;",
    },
    {
      filename: path.join(repoRoot, "fixtures", "recover.tsx"),
      source: 'const Recover = () => <div szRecover="csr">x</div>;',
    },
  ]);

  const [
    rewritten,
    noop,
    stringSz,
    arraySz,
    spreadSz,
    emptyArraySz,
    dynamicSz,
    mergeRuntimeSz,
    mergeDynamicClass,
    recover,
  ] = results;
  if (
    results.length !== 10 ||
    !rewritten ||
    !noop ||
    !stringSz ||
    !arraySz ||
    !spreadSz ||
    !emptyArraySz ||
    !dynamicSz ||
    !mergeRuntimeSz ||
    !mergeDynamicClass ||
    !recover
  ) {
    fail(`Expected 10 transform results, received ${results.length}.`);
  }

  if (
    rewritten.code !==
    'const App = () => <><div className="p-4" /><span className="x m-2" /></>;'
  ) {
    fail(`Unexpected rewritten code: ${rewritten.code}`);
  }
  if (rewritten.metadata?.transformed !== true) {
    fail("Expected first result to be marked transformed.");
  }
  if (!rewritten.metadata?.timings || rewritten.metadata.timings.totalNs <= 0) {
    fail(
      `Expected native timing metadata, received ${JSON.stringify(rewritten.metadata?.timings)}`,
    );
  }
  if (rewritten.parserPath !== "static") {
    fail(`Expected static parserPath, received ${rewritten.parserPath}.`);
  }
  if (JSON.stringify(rewritten.classes) !== JSON.stringify(["p-4", "m-2"])) {
    fail(`Unexpected classes: ${JSON.stringify(rewritten.classes)}`);
  }
  if (JSON.stringify(rewritten.rawClassNames) !== JSON.stringify(["x"])) {
    fail(
      `Unexpected rawClassNames: ${JSON.stringify(rewritten.rawClassNames)}`,
    );
  }

  if (noop.code !== 'const Plain = () => <div className="x" />;') {
    fail(`Unexpected no-op code: ${noop.code}`);
  }
  if (noop.metadata?.transformed !== false) {
    fail("Expected no-op result to stay untransformed.");
  }
  if (noop.parserPath !== "fastRegex") {
    fail(`Expected fastRegex parserPath, received ${noop.parserPath}.`);
  }

  if (
    stringSz.code !== 'const StringSz = () => <div className="px-4 py-2" />;'
  ) {
    fail(`Unexpected string sz code: ${stringSz.code}`);
  }
  if (JSON.stringify(stringSz.classes) !== JSON.stringify(["px-4", "py-2"])) {
    fail(`Unexpected string sz classes: ${JSON.stringify(stringSz.classes)}`);
  }

  if (arraySz.code !== 'const ArraySz = () => <div className="flex p-4" />;') {
    fail(`Unexpected array sz code: ${arraySz.code}`);
  }
  if (JSON.stringify(arraySz.classes) !== JSON.stringify(["flex", "p-4"])) {
    fail(`Unexpected array sz classes: ${JSON.stringify(arraySz.classes)}`);
  }

  if (spreadSz.code !== 'const SpreadSz = () => <div className="p-4 m-2" />;') {
    fail(`Unexpected spread sz code: ${spreadSz.code}`);
  }
  if (JSON.stringify(spreadSz.classes) !== JSON.stringify(["p-4", "m-2"])) {
    fail(`Unexpected spread sz classes: ${JSON.stringify(spreadSz.classes)}`);
  }

  if (
    emptyArraySz.code !== 'const EmptyArraySz = () => <div className="" />;'
  ) {
    fail(`Unexpected empty array sz code: ${emptyArraySz.code}`);
  }
  if (JSON.stringify(emptyArraySz.classes) !== JSON.stringify([])) {
    fail(
      `Unexpected empty array sz classes: ${JSON.stringify(emptyArraySz.classes)}`,
    );
  }

  if (
    dynamicSz.code !==
    'const DynamicSz = ({ styles }) => <><div className="p-4" /><span className={_sz(styles)} /></>;'
  ) {
    fail(`Unexpected dynamic sz code: ${dynamicSz.code}`);
  }
  if (dynamicSz.metadata?.transformed !== true) {
    fail("Expected dynamic sz result to be marked transformed.");
  }
  if (dynamicSz.metadata?.usesRuntime !== true) {
    fail("Expected dynamic sz result to require the _sz runtime helper.");
  }
  if (JSON.stringify(dynamicSz.classes) !== JSON.stringify(["p-4"])) {
    fail(`Unexpected dynamic sz classes: ${JSON.stringify(dynamicSz.classes)}`);
  }
  if (dynamicSz.diagnostics?.length !== 0) {
    fail(`Expected no dynamic sz diagnostics: ${dynamicSz.diagnostics}`);
  }

  if (
    mergeRuntimeSz.code !==
    'const MergeRuntimeSz = ({ styles }) => <div className={_szMerge("existing", _sz(styles))} />;'
  ) {
    fail(`Unexpected merge runtime sz code: ${mergeRuntimeSz.code}`);
  }
  if (mergeRuntimeSz.metadata?.transformed !== true) {
    fail("Expected merge runtime sz result to be marked transformed.");
  }
  if (
    mergeRuntimeSz.metadata?.usesRuntime !== true ||
    mergeRuntimeSz.metadata?.usesMerge !== true
  ) {
    fail(
      `Expected merge runtime sz to require _sz and _szMerge: ${JSON.stringify(mergeRuntimeSz.metadata)}`,
    );
  }
  if (
    JSON.stringify(mergeRuntimeSz.rawClassNames) !==
    JSON.stringify(["existing"])
  ) {
    fail(
      `Unexpected merge runtime rawClassNames: ${JSON.stringify(mergeRuntimeSz.rawClassNames)}`,
    );
  }
  if (mergeRuntimeSz.diagnostics?.length !== 0) {
    fail(
      `Expected no merge runtime sz diagnostics: ${mergeRuntimeSz.diagnostics}`,
    );
  }

  if (
    mergeDynamicClass.code !==
    "const MergeDynamicClass = ({ styles }) => <div className={_szMerge(getClass(), _sz(styles))} />;"
  ) {
    fail(`Unexpected merge dynamic class code: ${mergeDynamicClass.code}`);
  }
  if (
    mergeDynamicClass.metadata?.usesRuntime !== true ||
    mergeDynamicClass.metadata?.usesMerge !== true
  ) {
    fail(
      `Expected merge dynamic class to require _sz and _szMerge: ${JSON.stringify(mergeDynamicClass.metadata)}`,
    );
  }
  if (mergeDynamicClass.rawClassNames?.length !== 0) {
    fail(
      `Unexpected merge dynamic class rawClassNames: ${JSON.stringify(mergeDynamicClass.rawClassNames)}`,
    );
  }

  if (!recover.code.includes('szRecover="csr" data-sz-recovery-token="')) {
    fail(`Unexpected recovery code: ${recover.code}`);
  }
  if (recover.metadata?.transformed !== true) {
    fail("Expected recovery result to be marked transformed.");
  }
  if (recover.recoveryTokens?.length !== 1) {
    fail(
      `Expected one recovery token, received ${recover.recoveryTokens?.length}`,
    );
  }
  const [recoveryToken] = recover.recoveryTokens;
  if (!/^[0-9a-f]{12}$/.test(recoveryToken.token)) {
    fail(`Unexpected recovery token: ${recoveryToken.token}`);
  }
  if (
    recoveryToken.mode !== "csr" ||
    recoveryToken.component !== "div" ||
    !recoveryToken.path.endsWith("fixtures/recover.tsx:1:27")
  ) {
    fail(`Unexpected recovery token data: ${JSON.stringify(recoveryToken)}`);
  }
}

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
 * Print a smoke failure and exit.
 *
 * @param {string} message Failure message.
 * @returns {never}
 */
function fail(message) {
  console.error(`[native-engine-smoke] ${message}`);
  process.exit(1);
}
