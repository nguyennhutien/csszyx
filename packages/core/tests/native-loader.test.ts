import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    CsszyxNativeUnavailableError,
    getNativePackageName,
    loadNativeBinding,
    transformBatch,
} from '../native/index.js';

describe('@csszyx/core/native loader', () => {
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

    it('loads the host binding when present or throws a stable unavailable error', () => {
        try {
            const binding = loadNativeBinding();
            expect(typeof binding.transformBatch).toBe('function');
        } catch (err) {
            expect(err).toBeInstanceOf(CsszyxNativeUnavailableError);
            expect((err as CsszyxNativeUnavailableError).code).toBe('CSSZYX_NATIVE_UNAVAILABLE');
            expect((err as CsszyxNativeUnavailableError).message).toContain(
                'build.parser: "oxc" or "babel"',
            );
            return;
        }
    });

    it('throws the same stable error for a missing explicit native package', () => {
        // Use a synthetic platform name guaranteed to be missing on every
        // runner. The previous fixture used `@csszyx/core-linux-x64-gnu`,
        // which became loadable once CI started building the host native
        // engine before unit tests, so the throw assertion regressed.
        const missingPackage = '@csszyx/core-test-missing-platform';
        expect(() => loadNativeBinding(missingPackage)).toThrow(CsszyxNativeUnavailableError);

        try {
            loadNativeBinding(missingPackage);
        } catch (err) {
            expect((err as CsszyxNativeUnavailableError).code).toBe('CSSZYX_NATIVE_UNAVAILABLE');
            expect((err as CsszyxNativeUnavailableError).packageName).toBe(missingPackage);
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
                    timings: {
                        triageNs: 0,
                        parseNs: 0,
                        scopeNs: 0,
                        irNs: 0,
                        lowerNs: 0,
                        recoveryNs: 0,
                        diagnosticsNs: 0,
                        rewriteNs: 0,
                        totalNs: 0,
                    },
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
