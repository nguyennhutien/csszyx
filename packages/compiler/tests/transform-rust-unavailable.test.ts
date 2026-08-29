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

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: () => {
        throw new FakeUnavailable();
    },
}));

describe('the native transform on an install without it', () => {
    beforeEach(() => {
        vi.resetModules();
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
});
