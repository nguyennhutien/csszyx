/**
 * A native failure that is not the missing-addon kind reaches the caller as is.
 *
 * The Rust lane renames the loader's "not installed" error so every caller
 * reports it the same way. Anything else the native call throws is a real
 * engine or input failure, and renaming it would send the user to reinstall a
 * package that is installed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeUnavailable extends Error {}

const engineFailure = new TypeError('the engine could not read these files');

vi.mock('@csszyx/core/native', () => ({
    CsszyxNativeUnavailableError: FakeUnavailable,
    transformBatch: () => {
        throw engineFailure;
    },
    scanModuleLinks: () => {
        throw engineFailure;
    },
    scanGlobalVarUsages: () => {
        throw engineFailure;
    },
    encodeClassName: () => {
        throw engineFailure;
    },
    computeMangleChecksum: () => {
        throw engineFailure;
    },
    htmlClassNames: () => {
        throw engineFailure;
    },
    classAttributeReadings: () => {
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

    it('rethrows it from the class-name encoder, the checksum and the HTML readers unchanged', async () => {
        const {
            classAttributeReadingsRust,
            computeMangleChecksumRust,
            encodeClassNameRust,
            htmlClassNamesRust,
        } = await import('../src/transform-rust.js');

        expect(() => encodeClassNameRust(0)).toThrow(engineFailure);
        expect(() => computeMangleChecksumRust({ a: 'b' })).toThrow(engineFailure);
        expect(() => htmlClassNamesRust('<p class=a>')).toThrow(engineFailure);
        expect(() => classAttributeReadingsRust('a')).toThrow(engineFailure);
    });

    it('rethrows it from the global-var usage scan unchanged', async () => {
        const { scanGlobalVarUsagesRust } = await import('../src/transform-rust.js');

        expect(() => scanGlobalVarUsagesRust([{ filename: '/p/a.ts', source: '' }])).toThrow(
            engineFailure,
        );
    });
});
