import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNextStateContext } from '../src/next-state-context.js';
import { runNextWatcherCycle } from '../src/next-watcher-cycle.js';
import { internalErrorMessage } from './helpers/internal-error.js';

// A manifest that reads back invalid right after it was written is a state
// no user can cause; the mock stands in for the broken write it would take.
vi.mock('../src/next-generation-manifest.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../src/next-generation-manifest.js')>()),
    validateNextGenerationManifest: () => ({ ok: false, reason: 'generation mismatch' }),
}));

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Next watcher cycle', () => {
    it('stops on a generation manifest that reads back invalid', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-next-cycle-invalid-'));
        tempDirs.push(root);
        const ctx = createNextStateContext({
            explicitRoot: root,
            config: { mangleVars: false },
            nextVersion: '16.2.7',
            csszyxVersion: '0.9.0',
            nativeVersion: '0.9.0-linux-arm64-gnu',
            mode: 'development',
        });

        expect(() =>
            runNextWatcherCycle(ctx, {
                createdAt: '2026-06-04T00:00:00.000Z',
                lockOptions: { pid: 123, token: 't', now: Date.parse('2026-06-04T00:00:00.000Z') },
                writeOptions: { retryDelayMs: 0 },
            }),
        ).toThrow(
            expect.objectContaining({
                code: 'internal-error',
                message: internalErrorMessage(
                    'runNextWatcherCycle',
                    'the manifest the watcher wrote reads back invalid (generation mismatch)',
                ),
            }),
        );
    });
});
