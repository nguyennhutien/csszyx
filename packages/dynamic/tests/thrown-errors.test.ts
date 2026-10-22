/**
 * The errors `@csszyx/dynamic` throws carry their registry code (ADR 0031 §5).
 *
 * `purifySz` rejects hostile nesting with the compiler's `SzDepthError`, which
 * now is a csszyx error with the `sz-object-depth` code. An unreachable
 * manifest is a `dynamic-manifest-unreachable` error, caught inside
 * `ensureManifest` as before: the page renders with every class injected.
 */
import { SzDepthError } from '@csszyx/compiler/browser';
import { isCsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it } from 'vitest';
import { productionMessage, runtimeMessage } from '../../compiler/tests/engine-message.js';
import type { SzObject } from '../src/index.js';
import { manifestUnreachable } from '../src/manifest.js';
import { purifySz } from '../src/purify.js';

afterEach(() => {
    process.env.NODE_ENV = 'test';
});

/**
 * What a call threw.
 *
 * @param run - The call.
 * @returns The thrown value.
 */
function thrown(run: () => unknown): unknown {
    try {
        run();
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to throw');
}

describe('purifySz on hostile nesting', () => {
    // Both depth checks: the value walk (`>=`) and the object walk (`>`).
    it.each([
        [
            'nested sz objects',
            () => {
                let deep: SzObject = { bg: 'red' };
                for (let i = 0; i < 100; i++) deep = { hover: deep };
                return deep;
            },
        ],
        [
            'nested arrays under a key',
            () => {
                let deep: unknown = ['red'];
                for (let i = 0; i < 100; i++) deep = [deep];
                return { bg: deep } as SzObject;
            },
        ],
    ])('throws an SzDepthError with the sz-object-depth code for %s', (_name, build) => {
        const error = thrown(() => purifySz(build()));
        expect(error).toBeInstanceOf(SzDepthError);
        expect(isCsszyxError(error)).toBe(true);
        expect((error as SzDepthError).code).toBe('sz-object-depth');
        expect((error as SzDepthError).args).toEqual({ form: 'value', maxDepth: 32 });
    });
});

describe('an unreachable manifest', () => {
    const args = { status: 404 };

    it('is a dynamic-manifest-unreachable error in development', () => {
        process.env.NODE_ENV = 'development';
        const error = manifestUnreachable(404);
        expect(error).toBeInstanceOf(Error);
        expect(isCsszyxError(error)).toBe(true);
        expect(error.code).toBe('dynamic-manifest-unreachable');
        expect(error.args).toEqual(args);
        expect(error.message).toBe(
            runtimeMessage(
                'dynamic-manifest-unreachable',
                'The `dynamic()` manifest could not be fetched (HTTP status 404), so every class is treated as new and injected at runtime.',
                'help: serve the manifest at the URL `setManifestUrl` names, or turn `build.emitManifest` on.',
                'note: the error is caught and nothing is printed; csszyx does not fetch it again this session until you call `resetManifest`.',
            ),
        );
    });

    it('is the compact line in production', () => {
        process.env.NODE_ENV = 'production';
        expect(manifestUnreachable(404).message).toBe(
            productionMessage('dynamic-manifest-unreachable', args),
        );
    });
});
