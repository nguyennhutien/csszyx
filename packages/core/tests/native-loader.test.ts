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

    it('defaults to the host platform package', () => {
        // The default is part of the exported shape: callers inside this
        // module always pass args, so nothing else exercises it.
        const error = new CsszyxNativeUnavailableError();
        const packageName = getNativePackageName();

        expect(error.packageName).toBe(packageName);
        expect(error.code).toBe('native-engine-unavailable');
        expect(error.args).toEqual(
            packageName
                ? { form: 'not-installed', packageName }
                : { form: 'no-platform-package', platform: `${process.platform}-${process.arch}` },
        );
    });

    // `@csszyx/compiler/errors` recognises a csszyx error by this brand; the
    // compiler's own suite checks its guard accepts this error, and that the
    // words below are the registry's, since this module cannot import the
    // compiler.
    it('carries the csszyx error brand, the code and its args', () => {
        const brand = Symbol.for('csszyx.error');
        const missing = new CsszyxNativeUnavailableError({
            form: 'not-installed',
            packageName: '@csszyx/core-test-x',
        });
        expect((missing as unknown as Record<symbol, unknown>)[brand]).toBe(true);
        expect(missing.args).toEqual({ form: 'not-installed', packageName: '@csszyx/core-test-x' });
        expect(missing.packageName).toBe('@csszyx/core-test-x');
    });

    it('names the export a package lacks', () => {
        const fixture = fixturePath('fixtures/native-binding-invalid.cjs');
        try {
            loadNativeBinding(fixture);
        } catch (err) {
            expect((err as CsszyxNativeUnavailableError).args).toEqual({
                form: 'missing-export',
                packageName: fixture,
                exportName: 'transformBatch',
            });
            return;
        }
        throw new Error('loadNativeBinding unexpectedly returned a binding');
    });

    it('names the platform no prebuilt package covers', () => {
        const error = new CsszyxNativeUnavailableError({
            form: 'no-platform-package',
            platform: 'freebsd-x64',
        });

        expect(error.packageName).toBeNull();
        expect(error.message).toBe(
            '[csszyx] native-engine-unavailable:\n' +
                '  No prebuilt native engine covers `freebsd-x64`, so the `rust` parser cannot run.\n' +
                "  help: set the parser to `wasm` (`build.parser: 'wasm'` in the plugin options, `parserMode: 'wasm'` in `csszyxTurbopack`, or `--parser-mode wasm` on `csszyx next`); the wasm engine ships inside `@csszyx/core`.\n" +
                '  note: the wasm engine produces the same output; only parsing is slower.\n' +
                '  docs: https://csszyx.com/e/native-engine-unavailable',
        );
    });

    it('throws that error when asked to load with no platform package', () => {
        expect(() => loadNativeBinding(null)).toThrow(CsszyxNativeUnavailableError);
        expect(() => loadNativeBinding(null)).toThrow(
            `No prebuilt native engine covers \`${process.platform}-${process.arch}\``,
        );
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
            expect((err as CsszyxNativeUnavailableError).code).toBe('native-engine-unavailable');
            expect((err as CsszyxNativeUnavailableError).message).toContain(
                "`build.parser: 'wasm'`",
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
            expect((err as CsszyxNativeUnavailableError).code).toBe('native-engine-unavailable');
            expect((err as CsszyxNativeUnavailableError).packageName).toBe(missingPackage);
            return;
        }

        throw new Error('loadNativeBinding unexpectedly returned a binding');
    });

    it('rejects a native package with the wrong export shape', () => {
        const fixture = fixturePath('fixtures/native-binding-invalid.cjs');

        expect(() => loadNativeBinding(fixture)).toThrow(CsszyxNativeUnavailableError);
        expect(() => loadNativeBinding(fixture)).toThrow(
            '[csszyx] native-engine-unavailable:\n' +
                `  \`${fixture}\` does not export \`transformBatch()\`, which the installed \`@csszyx/core\` calls, so the \`rust\` parser cannot run.\n` +
                `  help: update \`@csszyx/core\` and \`${fixture}\` together, to the same version, or set the parser to \`wasm\``,
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
