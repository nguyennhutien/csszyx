import { describe, expect, it } from 'vitest';

import {
    CsszyxNativeUnavailableError,
    getNativePackageName,
    loadNativeBinding,
    transformBatch,
} from '../native/index.js';

describe('@csszyx/core/native scaffold', () => {
    it('can be imported without loading a native binary', () => {
        expect(typeof getNativePackageName).toBe('function');
        expect(typeof transformBatch).toBe('function');
    });

    it('reports the expected optional package name for supported platforms', () => {
        const packageName = getNativePackageName();

        if (packageName) {
            expect(packageName).toMatch(/^@csszyx\/core-/);
        }
    });

    it('throws a stable error contract until native packages exist', () => {
        expect(() => loadNativeBinding()).toThrow(CsszyxNativeUnavailableError);

        try {
            transformBatch([{ filename: '/repo/src/App.tsx', source: 'const App = () => null;' }]);
        } catch (err) {
            expect(err).toBeInstanceOf(CsszyxNativeUnavailableError);
            expect((err as CsszyxNativeUnavailableError).code).toBe('CSSZYX_NATIVE_UNAVAILABLE');
            expect((err as CsszyxNativeUnavailableError).message).toContain(
                'build.parser: "oxc" or "babel"',
            );
            return;
        }

        throw new Error('transformBatch unexpectedly returned a result');
    });

    it('throws the same stable error for a missing explicit native package', () => {
        expect(() => loadNativeBinding('@csszyx/core-linux-x64-gnu')).toThrow(
            CsszyxNativeUnavailableError,
        );

        try {
            loadNativeBinding('@csszyx/core-linux-x64-gnu');
        } catch (err) {
            expect((err as CsszyxNativeUnavailableError).code).toBe('CSSZYX_NATIVE_UNAVAILABLE');
            expect((err as CsszyxNativeUnavailableError).packageName).toBe(
                '@csszyx/core-linux-x64-gnu',
            );
            return;
        }

        throw new Error('loadNativeBinding unexpectedly returned a binding');
    });
});
