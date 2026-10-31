/**
 * The stamp a long-lived caller keys the project's prefix by. An entry the
 * walk found can be gone by the time it is stat-ed; the call then stamps it
 * as gone, which differs from any stamp it had, rather than failing. A module
 * the config imports that has no file yet is stamped as missing, so creating
 * it is a change.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { projectPrefixStamp } from '../src/commands/check.js';

const gone = path.join(import.meta.dirname, 'no-such-dir', 'app.css');

vi.mock('@csszyx/tailwind-oracle', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/tailwind-oracle')>()),
    findTailwindCssEntries: async () => [gone],
}));

describe('projectPrefixStamp', () => {
    it('stamps an entry removed since the walk as gone', async () => {
        expect(await projectPrefixStamp(path.join(import.meta.dirname, 'no-such-dir'))).toBe(
            `${gone}\0gone`,
        );
    });

    it('stamps a module the config imports and that has no file as missing', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'csszyx-stamp-'));
        try {
            writeFileSync(
                path.join(root, 'csszyx.config.mjs'),
                'import rules from "./rules.mjs";\nexport default { diagnostics: { rules } };\n',
            );
            expect((await projectPrefixStamp(root)).split('\n')).toContain('rules.mjs\0missing');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
