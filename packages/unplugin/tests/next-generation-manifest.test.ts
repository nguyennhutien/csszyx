import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    type NextGenerationManifest,
    readNextGenerationManifest,
    resolveNextGenerationManifestPath,
    validateNextGenerationManifest,
    writeNextGenerationManifest,
} from '../src/next-generation-manifest.js';

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Next generation manifest', () => {
    function tempRoot(): string {
        const dir = mkdtempSync(join(tmpdir(), 'csszyx-next-manifest-'));
        tempDirs.push(dir);
        return dir;
    }

    function manifest(
        root: string,
        overrides: Partial<NextGenerationManifest> = {},
    ): NextGenerationManifest {
        return {
            schema: 1,
            generation: 'sha256:generation',
            root,
            configHash: 'sha256:config',
            envHash: 'sha256:env',
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
            sourceCount: 2,
            completed: true,
            createdAt: '2026-06-04T00:00:00.000Z',
            ...overrides,
        };
    }

    it('resolves under the explicit app root cache directory', () => {
        const root = tempRoot();

        expect(resolveNextGenerationManifestPath(root)).toBe(
            join(root, '.csszyx/cache/generation-manifest.json'),
        );
    });

    it('round-trips and validates a completed manifest', () => {
        const root = tempRoot();
        const manifestPath = resolveNextGenerationManifestPath(root);

        writeNextGenerationManifest(manifestPath, manifest(root), { retryDelayMs: 0 });
        const parsed = readNextGenerationManifest(manifestPath);

        expect(parsed?.root).toBe(root);
        expect(
            validateNextGenerationManifest(parsed, {
                root,
                configHash: 'sha256:config',
                envHash: 'sha256:env',
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                nativeVersion: '0.9.0-linux-arm64-gnu',
                mode: 'development',
            }),
        ).toEqual({ ok: true });
    });

    it('rejects missing, corrupt, and incomplete manifests', () => {
        const root = tempRoot();
        const manifestPath = resolveNextGenerationManifestPath(root);
        const expected = {
            root,
            configHash: 'sha256:config',
            envHash: 'sha256:env',
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development' as const,
        };

        expect(
            validateNextGenerationManifest(readNextGenerationManifest(manifestPath), expected),
        ).toEqual({
            ok: false,
            reason: 'missing or unreadable generation manifest',
        });

        mkdirSync(join(root, '.csszyx/cache'), { recursive: true });
        writeFileSync(manifestPath, '{bad json', { encoding: 'utf8', flag: 'w' });
        expect(readNextGenerationManifest(manifestPath)).toBeNull();

        writeNextGenerationManifest(manifestPath, manifest(root, { completed: false }), {
            retryDelayMs: 0,
        });
        expect(
            validateNextGenerationManifest(readNextGenerationManifest(manifestPath), expected),
        ).toEqual({
            ok: false,
            reason: 'generation manifest is incomplete',
        });
    });

    it.each([
        ['root', { root: '/other/app' }, 'generation manifest root does not match this Next app'],
        ['configHash', { configHash: 'sha256:other' }, 'csszyx config hash changed'],
        ['envHash', { envHash: 'sha256:other' }, 'csszyx env hash changed'],
        ['nextVersion', { nextVersion: '16.3.0' }, 'Next.js version changed'],
        ['csszyxVersion', { csszyxVersion: '0.10.0' }, 'csszyx version changed'],
        [
            'nativeVersion',
            { nativeVersion: '0.9.0-linux-x64-gnu' },
            'csszyx native engine version changed',
        ],
        ['mode', { mode: 'production' }, 'generation manifest mode changed'],
    ] as const)('rejects stale %s identity', (_field, override, reason) => {
        const root = tempRoot();
        const parsed = manifest(root);
        const expected = {
            root,
            configHash: 'sha256:config',
            envHash: 'sha256:env',
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development' as const,
            ...override,
        };

        expect(validateNextGenerationManifest(parsed, expected)).toEqual({
            ok: false,
            reason,
        });
    });
});
