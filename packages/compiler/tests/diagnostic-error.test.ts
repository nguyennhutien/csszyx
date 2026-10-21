/**
 * `szDiagnosticError` is what every Node package throws a registry id with:
 * the message is the root renderer's, and the error carries the code, the
 * args and what it wraps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Hand an id args its types refuse, as a value built at run time can: the
 * cast is the point of the test.
 *
 * @param code - The id.
 * @param args - The args.
 * @returns The message.
 */
function messageOf(code: string, args: object): string {
    return (szDiagnosticMessage as (code: string, args: object) => string)(code, args);
}

describe('a diagnostic its templates cannot word', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is refused outside production when a required arg is missing', () => {
        expect(() => messageOf('no-source-files', { pattern: 'src/**' })).toThrow(
            '[csszyx] `no-source-files` was reported without its `root` arg',
        );
    });

    it('is refused outside production when its form has no sentence', () => {
        expect(() => messageOf('cli-option-invalid', { form: 'speed', value: 'x' })).toThrow(
            '[csszyx] `cli-option-invalid` has no sentence for the form `speed`',
        );
        expect(() => messageOf('cli-option-invalid', { form: 3, value: 'x' })).toThrow(
            '[csszyx] `cli-option-invalid` has no sentence for the form `3`',
        );
        expect(() => messageOf('cli-option-invalid', { value: 'x' })).toThrow(
            '[csszyx] `cli-option-invalid` was reported without its `form` arg',
        );
    });

    it('still words an optional arg left out', () => {
        expect(messageOf('cli-option-invalid', { form: 'mode' })).toContain(
            '`--mode ` is not a mode this command takes',
        );
    });

    it('is filled with what it has in production, so a wording slip never stops a build', () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(messageOf('no-source-files', { pattern: 'src/**' })).toContain('src/**');
        expect(messageOf('cli-option-invalid', { form: 'speed', value: 'x' })).toMatch(
            /^\[csszyx\] cli-option-invalid:\n {2}\n/,
        );
    });
});
