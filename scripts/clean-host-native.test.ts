import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    getHostNativePackage,
    NATIVE_PLATFORM_PACKAGES,
} from '../packages/core/scripts/native-platforms.mjs';
import { cleanHostNativeOutputs } from './clean-host-native.mjs';

const temporaryDirectories: string[] = [];
const sourceRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('cleanHostNativeOutputs', () => {
    it('removes current-host outputs while preserving another platform', () => {
        const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'csszyx-native-clean-'));
        temporaryDirectories.push(repositoryRoot);

        const host = getHostNativePackage(repositoryRoot);
        assert.ok(host.packageInfo && host.packageDir && host.nodePath);
        const foreign = NATIVE_PLATFORM_PACKAGES.find(
            packageInfo => packageInfo.platformKey !== host.platformKey,
        );
        assert.ok(foreign);

        const hostTypesPath = path.join(host.packageDir, 'index.d.ts');
        const foreignBinaryPath = path.join(repositoryRoot, foreign.dir, foreign.node);
        mkdirSync(host.packageDir, { recursive: true });
        mkdirSync(path.dirname(foreignBinaryPath), { recursive: true });
        writeFileSync(host.nodePath, 'host binary');
        writeFileSync(hostTypesPath, 'host types');
        writeFileSync(foreignBinaryPath, 'foreign binary');

        const result = cleanHostNativeOutputs(repositoryRoot);

        assert.equal(result.platformKey, host.platformKey);
        assert.deepEqual(result.removedPaths, [host.nodePath, hostTypesPath]);
        assert.equal(existsSync(host.nodePath), false);
        assert.equal(existsSync(hostTypesPath), false);
        assert.equal(existsSync(foreignBinaryPath), true);
    });

    it('keeps every cleanup entrypoint platform-scoped', () => {
        const packageJson = JSON.parse(
            readFileSync(path.join(sourceRepositoryRoot, 'package.json'), 'utf8'),
        ) as { scripts: { clean: string } };
        const verifyScript = readFileSync(
            path.join(sourceRepositoryRoot, 'scripts/verify-like-ci.sh'),
            'utf8',
        );

        assert.match(packageJson.scripts.clean, /^node scripts\/clean-host-native\.mjs\b/);
        assert.doesNotMatch(packageJson.scripts.clean, /packages\/core-\*\/\*\.node/);
        assert.match(verifyScript, /native:build -- --clean --native-engine/);
        assert.doesNotMatch(verifyScript, /packages\/core-(?:darwin|linux|win32)-/);
    });
});
