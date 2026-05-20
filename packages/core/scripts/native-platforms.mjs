import path from "node:path";

export const NATIVE_PLATFORM_PACKAGES = [
  {
    platformKey: "linux-x64-gnu",
    dirName: "core-linux-x64-gnu",
    name: "@csszyx/core-linux-x64-gnu",
    triple: "x86_64-unknown-linux-gnu",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
  },
  {
    platformKey: "linux-x64-musl",
    dirName: "core-linux-x64-musl",
    name: "@csszyx/core-linux-x64-musl",
    triple: "x86_64-unknown-linux-musl",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["musl"],
  },
  {
    platformKey: "linux-arm64-gnu",
    dirName: "core-linux-arm64-gnu",
    name: "@csszyx/core-linux-arm64-gnu",
    triple: "aarch64-unknown-linux-gnu",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["glibc"],
  },
  {
    platformKey: "linux-arm64-musl",
    dirName: "core-linux-arm64-musl",
    name: "@csszyx/core-linux-arm64-musl",
    triple: "aarch64-unknown-linux-musl",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["musl"],
  },
  {
    platformKey: "darwin-x64",
    dirName: "core-darwin-x64",
    name: "@csszyx/core-darwin-x64",
    triple: "x86_64-apple-darwin",
    os: ["darwin"],
    cpu: ["x64"],
  },
  {
    platformKey: "darwin-arm64",
    dirName: "core-darwin-arm64",
    name: "@csszyx/core-darwin-arm64",
    triple: "aarch64-apple-darwin",
    os: ["darwin"],
    cpu: ["arm64"],
  },
  {
    platformKey: "win32-x64-msvc",
    dirName: "core-win32-x64-msvc",
    name: "@csszyx/core-win32-x64-msvc",
    triple: "x86_64-pc-windows-msvc",
    os: ["win32"],
    cpu: ["x64"],
  },
  {
    platformKey: "win32-arm64-msvc",
    dirName: "core-win32-arm64-msvc",
    name: "@csszyx/core-win32-arm64-msvc",
    triple: "aarch64-pc-windows-msvc",
    os: ["win32"],
    cpu: ["arm64"],
  },
].map((pkg) => ({
  ...pkg,
  dir: `packages/${pkg.dirName}`,
  node: `csszyx-core.${pkg.platformKey}.node`,
}));

export const NATIVE_PLATFORM_PACKAGE_BY_KEY = new Map(
  NATIVE_PLATFORM_PACKAGES.map((pkg) => [pkg.platformKey, pkg]),
);

export function getHostNativePackage(repoRoot) {
  const platformKey = getPlatformKey();
  const packageInfo = NATIVE_PLATFORM_PACKAGE_BY_KEY.get(platformKey);

  if (!packageInfo) {
    return { platformKey, packageInfo: null, packageDir: null, nodePath: null };
  }

  const packageDir = path.join(repoRoot, packageInfo.dir);
  return {
    platformKey,
    packageInfo,
    packageDir,
    nodePath: path.join(packageDir, packageInfo.node),
  };
}

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

function isMusl() {
  if (typeof process.report?.getReport !== "function") {
    return false;
  }

  const report = process.report.getReport();
  return !report.header?.glibcVersionRuntime;
}
