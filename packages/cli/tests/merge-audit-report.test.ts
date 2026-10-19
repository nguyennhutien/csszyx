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
        const warn = vi.spyOn(out, 'runWarn');
        await reportMergeAudit(out, {
            cwd: '/nowhere',
            files: [],
            selected: ['merge-covered-class'],
        });
        expect(warn).toHaveBeenCalledWith('Merge audit skipped: no stylesheet');
        expect(out.findings).toEqual([]);
    });

    it('says it was skipped on stderr in --json, where stdout is the document', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await reportMergeAudit(createReporter(true), {
            cwd: '/nowhere',
            files: [],
            selected: ['merge-covered-class'],
        });
        expect(log).not.toHaveBeenCalled();
        expect(error.mock.calls.flat().join('\n')).toContain('Merge audit skipped: no stylesheet');
        vi.restoreAllMocks();
    });
});
