/**
 * A native failure that is not the missing-addon kind reaches the caller as is.
 *
 * The Rust lane renames the loader's "not installed" error so every caller
 * reports it the same way. Anything else the native call throws is a real
 * engine or input failure, and renaming it would send the user to reinstall a
 * package that is installed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeUnavailable extends Error {
    detail = 'not installed';
}

const engineFailure = new TypeError('the engine could not read these files');

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: () => {
        throw engineFailure;
    },
    scanModuleLinks: () => {
        throw engineFailure;
    },
}));

describe('the Rust lane and a native failure that is not a missing addon', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('rethrows it from the module-link scan unchanged', async () => {
        const { scanModuleLinksRust } = await import('../src/transform-rust.js');

        expect(() => scanModuleLinksRust([{ filename: '/p/a.ts', source: '' }])).toThrow(
            engineFailure,
        );
    });
});
