#!/usr/bin/env node

import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getHostNativePackage } from '../packages/core/scripts/native-platforms.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');

/**
 * Remove only the current host's generated native package outputs.
 *
 * @param {string} repositoryRoot absolute repository root
 * @param {(filePath: string, options: { force: boolean }) => void} [removeFile] file remover
 * @returns {{ platformKey: string; removedPaths: string[] }} cleanup result
 */
export function cleanHostNativeOutputs(
    repositoryRoot,
    removeFile = (filePath, options) => rmSync(filePath, options),
) {
    const { platformKey, packageDir, nodePath } = getHostNativePackage(repositoryRoot);
    if (!packageDir || !nodePath) {
        return { platformKey, removedPaths: [] };
    }

    const removedPaths = [nodePath, path.join(packageDir, 'index.d.ts')];
    for (const filePath of removedPaths) {
        removeFile(filePath, { force: true });
    }
    return { platformKey, removedPaths };
}

function main() {
    const result = cleanHostNativeOutputs(defaultRepositoryRoot);
    if (result.removedPaths.length === 0) {
        console.log(`[clean-host-native] No native package for ${result.platformKey}; skipped.`);
        return;
    }

    console.log(
        `[clean-host-native] Cleaned ${result.platformKey} outputs without touching other platforms.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
