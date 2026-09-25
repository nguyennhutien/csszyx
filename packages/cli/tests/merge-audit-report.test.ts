/**
 * The merge audit when the project's stylesheets cannot be opened.
 *
 * The audit reads the model the build reads; when that fails it says why and
 * stops, whatever the failure threw.
 */
import { describe, expect, it, vi } from 'vitest';

import { createReporter } from '../src/scanner/check-report.js';
import { reportMergeAudit } from '../src/scanner/merge-audit-report.js';

vi.mock('@csszyx/unplugin/next-prebuild', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/unplugin/next-prebuild')>()),
    openStylesheetModel: () => Promise.reject('no stylesheet\nsecond line'),
}));

describe('the merge audit', () => {
    it('is skipped with the first line of a failure that is not an Error', async () => {
        const out = createReporter(false);
        const warn = vi.spyOn(out, 'warn');
        await reportMergeAudit(out, {
            cwd: '/nowhere',
            files: [],
            rules: ['merge-covered-class'],
        });
        expect(warn).toHaveBeenCalledWith('Merge audit skipped: no stylesheet');
        expect(out.findings).toEqual([]);
    });
});
