/**
 * The compiler refuses an engine it was not built against: another release
 * ignores options it does not know (the 0.17 engine dropped the Tailwind
 * prefix with no word), and another build of the same release lowers with
 * other tables. There is no switch to turn the check off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertEngineIdentity,
    EngineVersionSkewError,
    EXPECTED_ENGINE,
    wasmEngineIdentity,
} from '../src/engine-identity.js';
import { CsszyxError } from '../src/errors.js';

const expected = { version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' };

describe('assertEngineIdentity', () => {
    it('passes the engine it was built against', () => {
        expect(() => assertEngineIdentity({ expected, reported: { ...expected } })).not.toThrow();
    });

    /**
     * The message for a skew, as the registry words each form.
     *
     * @param text - The sentence of the form.
     * @param help - The help of the form.
     * @returns The whole printed message.
     */
    const message = (text: string, help: string): string =>
        `[csszyx] engine-version-skew:\n  ${text}\n  help: ${help}\n  docs: https://csszyx.com/e/engine-version-skew`;

    it('names the platform package for another native release', () => {
        const check = () =>
            assertEngineIdentity({
                expected,
                reported: { version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' },
                platformPackage: '@csszyx/core-linux-x64-gnu',
            });
        expect(check).toThrow(EngineVersionSkewError);
        expect(check).toThrow(
            message(
                '`@csszyx/compiler` 0.18.0 loaded the native engine 0.17.2 from `@csszyx/core-linux-x64-gnu`, and the two must come from the same release, so csszyx stops.',
                'install `@csszyx/core@0.18.0`, and reinstall `@csszyx/core-linux-x64-gnu` if your lockfile holds it at another version.',
            ),
        );
    });

    it('asks for the install alone for the wasm build and for a host with no platform package', () => {
        for (const [platformPackage, artifact] of [
            [undefined, 'wasm'],
            [null, 'native'],
        ] as const) {
            expect(() =>
                assertEngineIdentity({
                    expected,
                    reported: { version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' },
                    platformPackage,
                }),
            ).toThrow(
                message(
                    `\`@csszyx/compiler\` 0.18.0 loaded the ${artifact} engine 0.17.2, and the two must come from the same release, so csszyx stops.`,
                    'install `@csszyx/core@0.18.0`; it installs its platform package at the same version.',
                ),
            );
        }
    });

    it('names the rebuild when only the source differs', () => {
        const check = (platformPackage?: string) => () =>
            assertEngineIdentity({
                expected,
                reported: { version: '0.18.0', digest: 'cccccccccccccccc' },
                platformPackage,
            });
        const rebuild =
            'rebuild the engine from this checkout: `pnpm --filter @csszyx/core native:build` for native, `pnpm --filter @csszyx/core build` for wasm.';
        expect(check()).toThrow(
            message(
                'The wasm engine was built from source `cccccccccccccccc`, and `@csszyx/compiler` 0.18.0 expects `aaaaaaaaaaaaaaaa`, so csszyx stops.',
                rebuild,
            ),
        );
        expect(check('@csszyx/core-linux-x64-gnu')).toThrow(
            message(
                'The native engine was built from source `cccccccccccccccc`, and `@csszyx/compiler` 0.18.0 expects `aaaaaaaaaaaaaaaa`, so csszyx stops.',
                rebuild,
            ),
        );
    });

    it('names an engine too old to report itself', () => {
        expect(() => assertEngineIdentity({ expected, reported: null })).toThrow(
            message(
                '`@csszyx/compiler` 0.18.0 loaded a wasm engine from a release before 0.18, and the two must come from the same release, so csszyx stops.',
                'install `@csszyx/core@0.18.0`; it installs its platform package at the same version.',
            ),
        );
    });

    it('carries its code', () => {
        expect(new EngineVersionSkewError('x')).toMatchObject({
            code: 'engine-version-skew',
            name: 'EngineVersionSkewError',
        });
    });

    it.each([
        [
            'another native release',
            {
                reported: { version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' },
                platformPackage: '@csszyx/core-linux-x64-gnu',
            },
            {
                form: 'platform-package',
                artifact: 'native',
                expectedVersion: '0.18.0',
                expectedDigest: 'aaaaaaaaaaaaaaaa',
                foundVersion: '0.17.2',
                foundDigest: 'bbbbbbbbbbbbbbbb',
                platformPackage: '@csszyx/core-linux-x64-gnu',
            },
        ],
        [
            'a wasm engine too old to report itself',
            { reported: null },
            {
                form: 'unreported',
                artifact: 'wasm',
                expectedVersion: '0.18.0',
                expectedDigest: 'aaaaaaaaaaaaaaaa',
            },
        ],
        [
            'a host no platform package covers',
            { reported: null, platformPackage: null },
            {
                form: 'unreported',
                artifact: 'native',
                expectedVersion: '0.18.0',
                expectedDigest: 'aaaaaaaaaaaaaaaa',
            },
        ],
    ])('is a csszyx error whose args name %s', (_name, input, args) => {
        let error: unknown;
        try {
            assertEngineIdentity({ expected, ...input });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(EngineVersionSkewError);
        expect(error).toBeInstanceOf(CsszyxError);
        // Exactly these: an optional arg it has nothing for is absent.
        expect((error as EngineVersionSkewError).args).toEqual(args);
        expect(error).toMatchObject({ code: 'engine-version-skew' });
    });

    it('checks nothing when run from source, where no build set an expectation', () => {
        expect(EXPECTED_ENGINE).toBeNull();
        expect(() => assertEngineIdentity({ expected: null, reported: null })).not.toThrow();
    });
});

describe('wasmEngineIdentity', () => {
    it('reads the version and the digest', () => {
        expect(wasmEngineIdentity({ version: () => '0.18.0', engine_digest: () => 'd' })).toEqual({
            version: '0.18.0',
            digest: 'd',
        });
    });

    it('answers null for a build that predates the digest', () => {
        expect(wasmEngineIdentity({ version: () => '0.0.0' })).toBeNull();
    });
});

describe('the expectation a build puts in', () => {
    afterEach(() => {
        Reflect.deleteProperty(globalThis, '__CSSZYX_ENGINE_VERSION__');
        Reflect.deleteProperty(globalThis, '__CSSZYX_ENGINE_DIGEST__');
        vi.resetModules();
    });

    it('is read from the two constants tsdown defines', async () => {
        Object.assign(globalThis, {
            __CSSZYX_ENGINE_VERSION__: '0.18.0',
            __CSSZYX_ENGINE_DIGEST__: 'aaaaaaaaaaaaaaaa',
        });
        vi.resetModules();
        const identity = await import('../src/engine-identity.js');
        expect(identity.EXPECTED_ENGINE).toEqual({ version: '0.18.0', digest: 'aaaaaaaaaaaaaaaa' });
    });
});
