/**
 * The style model when a stylesheet fails somewhere the ordinary fixtures do
 * not reach: a file that vanished between the walk and the read, and a root
 * whose design system will not load after its compile succeeded.
 *
 * The second is Tailwind's two entry points disagreeing about one
 * stylesheet, which no release does today; the model still reports it as a
 * failure rather than a root with no facts.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, realpathSync: vi.fn(actual.realpathSync) };
});

vi.mock('@csszyx/tailwind-oracle', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/tailwind-oracle')>();
    return { ...actual, createEmittedClassOracle: vi.fn(actual.createEmittedClassOracle) };
});

const { realpathSync } = await import('node:fs');
const { createEmittedClassOracle } = await import('@csszyx/tailwind-oracle');
const { openProjectStyleModel } = await import('../src/project-style-model.js');

const REPO = path.resolve(import.meta.dirname, '../../..');

const made: string[] = [];
afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

describe('openProjectStyleModel failures', () => {
    it('accounts for a stylesheet that can no longer be read as not a root', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-style-model-gone-'));
        made.push(dir);
        const gone = path.join(dir, 'gone.css');

        const model = await openProjectStyleModel(REPO, [gone]);

        expect(model.entries).toEqual([{ file: gone, role: 'not-root' }]);
        expect(model.facts).toBeNull();
    });

    it('reports a root whose design system will not load as a failure with the reason', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-style-model-ds-'));
        made.push(dir);
        const app = path.join(dir, 'app.css');
        fs.writeFileSync(app, '@import "tailwindcss";\n');
        vi.mocked(createEmittedClassOracle).mockResolvedValueOnce({
            ok: false,
            kind: 'environment',
            reason: 'tailwindcss no longer reports an unservable class as null',
        });

        const model = await openProjectStyleModel(REPO, [app]);

        expect(model.entries).toEqual([
            {
                file: app,
                role: 'failed',
                failure: {
                    kind: 'environment',
                    reason: 'tailwindcss no longer reports an unservable class as null',
                    // It compiled as a root first, so it had reached Tailwind.
                    reachedTailwind: true,
                },
            },
        ]);
        expect(model.facts).toBeNull();
        expect(model.unserved(['p-4'])).toEqual([]);
    });

    it('compares a stylesheet path as written when it cannot be resolved on disk', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-style-model-realpath-'));
        made.push(dir);
        const app = path.join(dir, 'app.css');
        fs.writeFileSync(app, '@import "tailwindcss";\n');
        vi.mocked(realpathSync).mockImplementation(() => {
            throw new Error('ENOENT: removed between the read and the compare');
        });

        try {
            const model = await openProjectStyleModel(REPO, [app]);

            expect(model.entries).toEqual([
                { file: app, role: 'root', facts: { prefix: null, important: false } },
            ]);
        } finally {
            vi.mocked(realpathSync).mockRestore();
        }
    });
});
