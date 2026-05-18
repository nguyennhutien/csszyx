import { fileURLToPath } from 'node:url';

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

    it('rejects a native package with the wrong export shape', () => {
        const fixture = fixturePath('fixtures/native-binding-invalid.cjs');

        expect(() => loadNativeBinding(fixture)).toThrow(CsszyxNativeUnavailableError);
    });

    it('loads and caches a valid native package binding', () => {
        const fixture = fixturePath('fixtures/native-binding.cjs');
        const binding = loadNativeBinding(fixture);

        expect(loadNativeBinding(fixture)).toBe(binding);
        expect(
            binding.transformBatch([
                { filename: '/repo/src/App.tsx', source: '<div sz={{ p: 4 }} />' },
            ]),
        ).toEqual([
            {
                code: '<div className="p-4" />',
                map: null,
                classes: ['p-4'],
                rawClassNames: [],
                diagnostics: [],
                recoveryTokens: [],
                metadata: {
                    transformed: true,
                    usesRuntime: false,
                    usesMerge: false,
                    usesColorVar: false,
                    producer: 'rust',
                    astBudgetExceeded: false,
                },
                parserPath: 'fastRegex',
            },
        ]);
    });
});

/**
 * Resolve a fixture relative to this test file.
 *
 * @param path Relative fixture path.
 * @returns Absolute fixture path.
 */
function fixturePath(path: string): string {
    return fileURLToPath(new URL(path, import.meta.url));
}
