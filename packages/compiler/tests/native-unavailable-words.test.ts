/**
 * `@csszyx/core/native` words `native-engine-unavailable` itself: it cannot
 * import the compiler, which imports it. Its message must still be the
 * registry's, laid out as the compiler lays out a thrown diagnostic, so every
 * form it throws is rendered here and compared.
 */
import { CsszyxNativeUnavailableError } from '@csszyx/core/native';
import { describe, expect, it } from 'vitest';

import { SZ_DIAGNOSTIC_COMPUTED_VALUES } from '../src/diagnostic-render-helpers.js';
import { renderSzDiagnostic } from '../src/diagnostic-render-root.js';
import { isCsszyxError } from '../src/errors.js';

const CASES = [
    { form: 'no-platform-package', platform: 'freebsd-x64' },
    { form: 'not-installed', packageName: '@csszyx/core-linux-x64-gnu' },
    {
        form: 'missing-export',
        packageName: '@csszyx/core-linux-x64-gnu',
        exportName: 'transformBatch',
    },
    { form: 'stale-binding', packageName: '@csszyx/core-linux-x64-gnu' },
    {
        form: 'stale-binding-versions',
        packageName: '@csszyx/core-linux-x64-gnu',
        nativeVersion: '0.17.0',
        coreVersion: '0.18.0',
    },
] as const;

describe('CsszyxNativeUnavailableError words', () => {
    it.each(CASES)('prints the registry words for $form', args => {
        const error = new CsszyxNativeUnavailableError(args);
        expect(isCsszyxError(error)).toBe(true);
        expect(error.message).toBe(
            renderSzDiagnostic({
                diagnostic: { code: 'native-engine-unavailable', args },
                file: '',
                computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
            }),
        );
    });

    it('says only that the core cannot read the results, with or without versions', () => {
        expect(new CsszyxNativeUnavailableError(CASES[3]).message).toContain(
            '`@csszyx/core-linux-x64-gnu` returns results the installed `@csszyx/core` cannot read, so the `rust` parser cannot run.',
        );
    });

    it('names the two versions without ranking them', () => {
        // Either package can be the newer one, so the line says only that
        // they do not read each other.
        const error = new CsszyxNativeUnavailableError(CASES[4]);
        expect(error.message).toContain(
            '`@csszyx/core-linux-x64-gnu` 0.17.0 returns results the installed `@csszyx/core` 0.18.0 cannot read, so the `rust` parser cannot run.',
        );
    });
});
