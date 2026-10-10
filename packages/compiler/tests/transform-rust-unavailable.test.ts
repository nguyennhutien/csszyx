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

const LOADER_LINES = [
    'csszyx native engine unavailable: @csszyx/core-darwin-arm64 is not installed',
    'help: it is an optional dependency of @csszyx/core; reinstall without skipping optional packages, or set build.parser: "wasm"',
    'note: the wasm engine ships inside @csszyx/core and produces the same output',
];

class FakeUnavailable extends Error {
    packageName = '@csszyx/core-darwin-arm64';
    detail = LOADER_LINES.join('\n').replace('csszyx native engine unavailable: ', '');

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

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: (files: unknown[]) => {
        if (stale.current && files.length === 0) {
            return [];
        }
        throw new FakeUnavailable();
    },
    scanModuleLinks: () => {
        throw new FakeUnavailable();
    },
}));

describe('the native transform on an install without it', () => {
    beforeEach(() => {
        vi.resetModules();
        stale.current = false;
    });

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
        const { transformRust, OxcRustNotImplementedError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => transformRust('<div />', 'a.tsx')).toThrow(OxcRustNotImplementedError);
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
        const { scanModuleLinksRust, OxcRustNotImplementedError } = await import(
            '../src/transform-rust.js'
        );
        expect(() => scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }])).toThrow(
            OxcRustNotImplementedError,
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
});
