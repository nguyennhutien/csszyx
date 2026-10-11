/**
 * A module the config imports that is gone by the time it is stamped.
 *
 * The import graph is read first and each file stamped after, so a file
 * removed in between has no stamp. It is recorded as missing, as it now is,
 * rather than with a time it never had or not at all: its return is then a
 * change like its creation. Only a race reaches this, so `statSync` is made
 * to lose it.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

/** How many stats of each path succeed before it is gone. */
const statsBeforeGone = new Map<string, number>();

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        statSync: ((file: string, options?: object) => {
            const left = statsBeforeGone.get(String(file));
            if (left === 0) return undefined;
            if (left !== undefined) statsBeforeGone.set(String(file), left - 1);
            return actual.statSync(file, options as never);
        }) as typeof actual.statSync,
    };
});

const { diagnosticPolicyInputs } = await import('../src/diagnostic-policy-inputs.js');

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    statsBeforeGone.clear();
});

describe('a config import removed while its inputs are stamped', () => {
    it('is recorded as missing', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-policy-race-')));
        roots.push(root);
        writeFileSync(join(root, 'csszyx.config.mjs'), "import './a.mjs';\nexport default {};\n");
        writeFileSync(join(root, 'a.mjs'), 'export {};\n');
        // Resolved by `isFile`, then gone when it is stamped: the second stat.
        statsBeforeGone.set(join(root, 'a.mjs'), 1);
        expect(diagnosticPolicyInputs(root).slice(1)).toEqual([
            { file: 'a.mjs', mtimeMs: 0, size: 0, missing: true },
        ]);
    });
});
