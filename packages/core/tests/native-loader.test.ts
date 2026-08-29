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

    it('defaults to the host platform package and the transform wording', () => {
        // Both defaults are part of the exported shape: callers inside this
        // module always pass them, so nothing else exercises what an omitted
        // argument resolves to.
        const error = new CsszyxNativeUnavailableError();

        expect(error.packageName).toBe(getNativePackageName());
        expect(error.code).toBe('CSSZYX_NATIVE_UNAVAILABLE');
        // Absent a purpose the error speaks for the transform, which is the
        // one that really can fall back to the wasm engine. One line per
        // thing the reader needs: what is missing, what to do, what holds.
        const [what, help, note] = error.message.split('\n');
        expect(what).toBe(
            error.packageName
                ? `csszyx native engine unavailable: ${error.packageName} is not installed`
                : 'csszyx native engine unavailable: no prebuilt package covers this platform',
        );
        expect(help).toMatch(/^help: .*build\.parser: "wasm"/);
        expect(note).toBe(
            'note: the wasm engine ships inside @csszyx/core and produces the same output',
        );
        // The wrapper in @csszyx/compiler re-prefixes the first line, so the
        // text after the prefix is exposed on its own.
        expect(error.detail).toBe(error.message.replace('csszyx native engine unavailable: ', ''));
    });

    it('says no prebuilt package covers the platform when told there is none', () => {
        const error = new CsszyxNativeUnavailableError(undefined, null);

        expect(error.packageName).toBeNull();
        expect(error.message.split('\n')).toEqual([
            'csszyx native engine unavailable: no prebuilt package covers this platform',
            'help: set build.parser: "wasm"; the wasm engine ships inside @csszyx/core',
            'note: the wasm engine ships inside @csszyx/core and produces the same output',
        ]);
    });

    it('throws that error when asked to load with no platform package', () => {
        expect(() => loadNativeBinding(null)).toThrow(CsszyxNativeUnavailableError);
        expect(() => loadNativeBinding(null)).toThrow('no prebuilt package covers this platform');
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
            expect((err as CsszyxNativeUnavailableError).message).toContain('build.parser: "wasm"');
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
        expect(() => loadNativeBinding(fixture)).toThrow(
            `csszyx native engine unavailable: ${fixture} does not export transformBatch()`,
        );
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
                cssVariableMap: [],
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
