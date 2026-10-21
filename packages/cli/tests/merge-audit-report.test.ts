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
    it('did not run, with the first line of a failure that is not an Error', async () => {
        const out = createReporter(false);
        const warn = vi.spyOn(out, 'runWarn');
        const failed = await reportMergeAudit(out, {
            cwd: '/nowhere',
            files: [],
            selected: ['merge-covered-class'],
            failOn: 'error',
        });
        expect(warn).toHaveBeenCalledWith('✖ Merge audit did not run: no stylesheet');
        expect(out.findings).toEqual([]);
        // Selected and could not run: the caller fails the run.
        expect(failed).toBe(true);
    });

    it('says it did not run on stderr in --json, where stdout is the document', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await reportMergeAudit(createReporter(true), {
            cwd: '/nowhere',
            files: [],
            selected: ['merge-covered-class'],
            failOn: 'error',
        });
        expect(log).not.toHaveBeenCalled();
        expect(error.mock.calls.flat().join('\n')).toContain(
            'Merge audit did not run: no stylesheet',
        );
        vi.restoreAllMocks();
    });
});
