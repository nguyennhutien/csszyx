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
        expect(() =>
            assertEngineIdentity({ expected, reported: { ...expected }, artifact: 'wasm' }),
        ).not.toThrow();
    });

    it('names both versions and the install for another release', () => {
        const check = () =>
            assertEngineIdentity({
                expected,
                reported: { version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' },
                artifact: 'native (@csszyx/core-linux-x64-gnu)',
                platformPackage: '@csszyx/core-linux-x64-gnu',
            });
        expect(check).toThrow(EngineVersionSkewError);
        expect(check).toThrow(
            '[csszyx] engine-version-skew: @csszyx/compiler 0.18.0 was built for engine source aaaaaaaaaaaaaaaa and found the native (@csszyx/core-linux-x64-gnu) engine 0.17.2 (source bbbbbbbbbbbbbbbb)\nhelp: install @csszyx/core@0.18.0; @csszyx/core-linux-x64-gnu must be 0.18.0 too, so reinstall it if your lockfile holds another version',
        );
    });

    it('asks for the install alone for the wasm build and for a host with no platform package', () => {
        for (const platformPackage of [undefined, null]) {
            expect(() =>
                assertEngineIdentity({
                    expected,
                    reported: { version: '0.17.2', digest: 'bbbbbbbbbbbbbbbb' },
                    artifact: 'wasm',
                    platformPackage,
                }),
            ).toThrow(
                /help: install @csszyx\/core@0\.18\.0; it installs its platform package at the same version$/,
            );
        }
    });

    it('names the rebuild when only the source differs', () => {
        const check = (platformPackage?: string) => () =>
            assertEngineIdentity({
                expected,
                reported: { version: '0.18.0', digest: 'cccccccccccccccc' },
                artifact: platformPackage ? `native (${platformPackage})` : 'wasm',
                platformPackage,
            });
        expect(check()).toThrow(
            /help: rebuild the engine from this checkout with `pnpm --filter @csszyx\/core build` after changing its source$/,
        );
        expect(check('@csszyx/core-linux-x64-gnu')).toThrow(/core native:build`/);
    });

    it('names an engine too old to report itself', () => {
        expect(() => assertEngineIdentity({ expected, reported: null, artifact: 'wasm' })).toThrow(
            'found the wasm engine, from a release before 0.18 that does not report its version',
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
                artifact: 'native (@csszyx/core-linux-x64-gnu)',
                platformPackage: '@csszyx/core-linux-x64-gnu',
            },
            {
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
            { reported: null, artifact: 'wasm' },
            { artifact: 'wasm', expectedVersion: '0.18.0', expectedDigest: 'aaaaaaaaaaaaaaaa' },
        ],
        [
            'a host no platform package covers',
            { reported: null, artifact: 'native', platformPackage: null },
            { artifact: 'native', expectedVersion: '0.18.0', expectedDigest: 'aaaaaaaaaaaaaaaa' },
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
        expect(() =>
            assertEngineIdentity({ expected: null, reported: null, artifact: 'wasm' }),
        ).not.toThrow();
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
