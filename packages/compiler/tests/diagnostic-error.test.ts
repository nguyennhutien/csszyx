/**
 * `szDiagnosticError` is what every Node package throws a registry id with:
 * the message is the root renderer's, and the error carries the code, the
 * args and what it wraps.
 */
import { describe, expect, it } from 'vitest';
import { isCsszyxError } from '../src/errors.js';
import { szDiagnosticError, szDiagnosticMessage } from '../src/index.js';

describe('szDiagnosticError', () => {
    it('words the error as the registry does, and carries its code, args and cause', () => {
        const cause = new Error('rename failed');
        const error = szDiagnosticError(
            'internal-error',
            { where: 'mapConcurrent', detail: 'concurrency must be a positive integer, got 0' },
            { cause },
        );
        expect(isCsszyxError(error)).toBe(true);
        expect(error).toMatchObject({
            code: 'internal-error',
            args: { where: 'mapConcurrent' },
            cause,
            message:
                '[csszyx] internal-error:\n' +
                '  An internal check failed in `mapConcurrent`, so csszyx stops.\n' +
                '  help: report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message, the csszyx version and the bundler or command you ran.\n' +
                '  note: the check that failed: concurrency must be a positive integer, got 0.\n' +
                '  docs: https://csszyx.com/e/internal-error',
        });
    });

    it('names the file of an id about one', () => {
        expect(
            szDiagnosticMessage('template-sz-invalid', { count: 1 }, 'src/App.vue').split('\n')[0],
        ).toBe('[csszyx] template-sz-invalid: src/App.vue');
        expect(szDiagnosticError('template-sz-invalid', { count: 1 }).message).toMatch(
            /^\[csszyx\] template-sz-invalid:\n/,
        );
    });
});
