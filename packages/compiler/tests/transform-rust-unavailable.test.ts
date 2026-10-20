/**
 * What the native transform says when this install cannot run it.
 *
 * On a machine with the platform package the unavailable path never runs,
 * so it is exercised here with a binding that fails the way a missing
 * package fails. The fake speaks the loader's words: the wrapper must keep
 * them as they are, re-prefixed once, and must not name the package a
 * second time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCsszyxError } from '../src/errors.js';

const LOADER_LINES = [
    '[csszyx] native-engine-unavailable: @csszyx/core-darwin-arm64 is not installed',
    'help: it is an optional dependency of @csszyx/core; reinstall without skipping optional packages, or set build.parser: "wasm"',
    'note: the wasm engine ships inside @csszyx/core and produces the same output',
];

class FakeUnavailable extends Error {
    packageName = '@csszyx/core-darwin-arm64';
    detail = LOADER_LINES.join('\n').replace('[csszyx] native-engine-unavailable: ', '');
    // A csszyx error, as the loader's is: its brand, code and args.
    [Symbol.for('csszyx.error')] = true;
    code = 'native-engine-unavailable';
    args = { form: 'not-installed', packageName: this.packageName, detail: this.detail };

    constructor() {
        super(LOADER_LINES.join('\n'));
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

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: (files: unknown[]) => {
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
    });

    it('reports a binding that returns no result for the file as unavailable', async () => {
        empty.current = true;
        const { transformRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => transformRust('<div />', 'a.tsx')).toThrow(
            new RustTransformUnavailableError('native transform returned no result'),
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
            args: { where: 'transformRust' },
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

    it("keeps the loader's three lines under the transform prefix", async () => {
        const { transformRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => transformRust('<div />', 'a.tsx')).toThrow(RustTransformUnavailableError);
        try {
            transformRust('<div />', 'a.tsx');
        } catch (error) {
            const { message } = error as Error;
            expect(message.split('\n')).toEqual([
                'transformRust: native engine unavailable: @csszyx/core-darwin-arm64 is not installed',
                LOADER_LINES[1],
                LOADER_LINES[2],
            ]);
            // Named once. The wrapper used to append "; native package: ..."
            // after a message that had already named it.
            expect(message.match(/@csszyx\/core-darwin-arm64/g)).toHaveLength(1);
        }
    });

    it('reports the module-link scan unavailable in the same words', async () => {
        const { scanModuleLinksRust, RustTransformUnavailableError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }])).toThrow(
            RustTransformUnavailableError,
        );
        try {
            scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }]);
        } catch (error) {
            expect((error as Error).message.split('\n')).toEqual([
                'transformRust: native engine unavailable: @csszyx/core-darwin-arm64 is not installed',
                LOADER_LINES[1],
                LOADER_LINES[2],
            ]);
        }
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
