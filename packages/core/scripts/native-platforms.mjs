import path from "node:path";

import {
  NATIVE_PLATFORM_PACKAGE_BY_KEY,
  NATIVE_PLATFORM_PACKAGES,
  getNativePlatformKey,
} from "../native/platforms.js";

export { NATIVE_PLATFORM_PACKAGE_BY_KEY, NATIVE_PLATFORM_PACKAGES };

export function getHostNativePackage(repoRoot) {
  const platformKey = getNativePlatformKey();
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

export function getTargetNativePackage(repoRoot, targetTriple) {
  const packageInfo =
    NATIVE_PLATFORM_PACKAGES.find((pkg) => pkg.triple === targetTriple) ?? null;

  if (!packageInfo) {
    return { packageInfo: null, packageDir: null, nodePath: null };
  }

  const packageDir = path.join(repoRoot, packageInfo.dir);
  return {
    packageInfo,
    packageDir,
    nodePath: path.join(packageDir, packageInfo.node),
  };
}
