/**
 * What the native transform says when this install cannot run it.
 *
 * On a machine with the platform package the unavailable path never runs,
 * so it is exercised here with a binding that fails the way a missing
 * package fails. The wrapper keeps the loader's code, args and words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCsszyxError } from '../src/errors.js';

/** The loader's message: the transform's words, which the wrapper keeps. */
const LOADER_MESSAGE =
    '[csszyx] native-engine-unavailable:\n  `@csszyx/core-darwin-arm64` is not installed, so the `rust` parser cannot run.';

class FakeUnavailable extends Error {
    packageName = '@csszyx/core-darwin-arm64';
    // A csszyx error, as the loader's is: its brand, code and args.
    [Symbol.for('csszyx.error')] = true;
    code = 'native-engine-unavailable';
    args = { form: 'not-installed', packageName: this.packageName };

    constructor() {
        super(LOADER_MESSAGE);
        this.name = 'CsszyxNativeUnavailableError';
    }
}

/**
 * Whether the fake binding loads and refuses only the result it would return:
 * a platform package older than `@csszyx/core` exports `transformBatch` and
 * fails only once it is handed a file.
 */
const stale = vi.hoisted(() => ({ current: false }));

/** Whether the fake binding answers every batch with no results at all. */
const empty = vi.hoisted(() => ({ current: false }));

/**
 * What the fake binding's transform throws as the engine itself, the way napi
 * hands a Rust error over: a plain `Error` carrying the engine's message.
 */
const engineFailure = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: (files: unknown[]) => {
        if (engineFailure.current !== undefined) throw new Error(engineFailure.current);
        if (empty.current || (stale.current && files.length === 0)) {
            return [];
        }
        throw new FakeUnavailable();
    },
    scanModuleLinks: () => {
        throw new FakeUnavailable();
    },
    scanGlobalVarUsages: () => {
        throw new FakeUnavailable();
    },
}));

type TransformRust = typeof import('../src/transform-rust.js');

/**
 * What a call throws.
 *
 * @param call - The call.
 * @returns The thrown value.
 */
function thrown(call: () => unknown): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }
    throw new Error('expected the call to throw');
}

describe('the native transform on an install without it', () => {
    beforeEach(() => {
        vi.resetModules();
        stale.current = false;
        empty.current = false;
        engineFailure.current = undefined;
    });

    it('reports an engine that refuses the batch as a csszyx bug, with its message', async () => {
        engineFailure.current = 'the native engine feature is not compiled in';
        const { transformRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        const error = thrown(() => transformRust('<div />', 'a.tsx'));
        expect(error).toBeInstanceOf(RustTransformUnavailableError);
        expect(error).toMatchObject({
            name: 'RustTransformUnavailableError',
            code: 'internal-error',
            args: {
                where: 'engine transform',
                detail: 'the native engine feature is not compiled in',
            },
        });
        expect(((error as Error).cause as Error).message).toBe(
            'the native engine feature is not compiled in',
        );
    });

    it('reports a binding that returns no result for the file as unavailable', async () => {
        empty.current = true;
        const { transformRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => transformRust('<div />', 'a.tsx')).toThrow(
            new RustTransformUnavailableError('the native transform returned no result'),
        );
        expect(() => transformRust('<div />', 'a.tsx')).toThrow(
            '[csszyx] internal-error:\n' +
                '  An internal check failed in `transformRust`, so csszyx stops.\n' +
                '  help: report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message, the csszyx version and the bundler or command you ran.\n' +
                '  note: the check that failed: the native transform returned no result.\n' +
                '  docs: https://csszyx.com/e/internal-error',
        );
    });

    it('reports no result as a csszyx bug, since only a broken binding answers so', async () => {
        empty.current = true;
        const { transformRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        const error = thrown(() => transformRust('<div />', 'a.tsx'));
        expect(error).toBeInstanceOf(RustTransformUnavailableError);
        // The module graph is reset per test, so the class is this test's copy.
        expect(error).toBeInstanceOf((await import('../src/errors.js')).CsszyxError);
        expect(error).toMatchObject({
            name: 'RustTransformUnavailableError',
            code: 'internal-error',
            args: { where: 'transformRust', detail: 'the native transform returned no result' },
        });
        expect((error as Error).cause).toBeUndefined();
    });

    it.each([
        ['transformRust', (m: TransformRust) => m.transformRust('<div />', 'a.tsx')],
        ['ensureRustTransformAvailable', (m: TransformRust) => m.ensureRustTransformAvailable()],
        [
            'scanModuleLinksRust',
            (m: TransformRust) => m.scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }]),
        ],
    ])(
        "%s keeps the loader's code and args, and the loader's error as its cause",
        async (_name, call) => {
            const module = await import('../src/transform-rust.js');
            const error = thrown(() => call(module));
            expect(error).toBeInstanceOf(module.RustTransformUnavailableError);
            expect(isCsszyxError(error)).toBe(true);
            const cause = (error as Error).cause as FakeUnavailable;
            expect(cause).toBeInstanceOf(FakeUnavailable);
            // Its own code is the loader's: the wrapper renames, it does not reclassify.
            expect(error).toMatchObject({ code: cause.code, args: cause.args });
            expect(cause.code).toBe('native-engine-unavailable');
        },
    );

    it('reports a binding that loads but cannot answer as unavailable', async () => {
        // The availability probe has to hand the binding a file: an empty batch
        // comes back empty from an old package too, and the auto lane would then
        // pick a binding whose first real result it cannot read.
        stale.current = true;
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable()).toBe(false);
    });

    it('reports itself unavailable without throwing', async () => {
        const { isRustTransformAvailable } = await import('../src/transform-rust.js');
        expect(isRustTransformAvailable()).toBe(false);
    });

    it.each([
        ['transformRust', (m: TransformRust) => m.transformRust('<div />', 'a.tsx')],
        [
            'scanModuleLinksRust',
            (m: TransformRust) => m.scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }]),
        ],
    ])("%s keeps the loader's words", async (_name, call) => {
        const module = await import('../src/transform-rust.js');
        const error = thrown(() => call(module));
        expect(error).toBeInstanceOf(module.RustTransformUnavailableError);
        expect((error as Error).message).toBe(LOADER_MESSAGE);
    });

    it('reports the global-var usage scan unavailable as the same error', async () => {
        const { scanGlobalVarUsagesRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );

        expect(() => scanGlobalVarUsagesRust([{ filename: '/p/a.ts', source: '' }])).toThrow(
            RustTransformUnavailableError,
        );
    });
});
