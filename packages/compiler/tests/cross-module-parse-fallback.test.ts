/**
 * How the cross-module extractor reaches the parser.
 *
 * Reading the registry entries needs the AST, and oxc can hand it over through
 * a buffer (`experimentalRawTransfer`) at a quarter of the cost of the JSON
 * form - measured 54 against 215 microseconds per file. The flag is
 * experimental and the transfer is unsupported on some hosts (32-bit,
 * big-endian, Bun, a webcontainer whose WASI binding may not even export the
 * probe), so the extractor must answer from the JSON form whenever the fast
 * one is not there, and must never let the probe itself throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const SOURCE = "import { szv } from '@csszyx/runtime';\nexport const card = { p: 4 };\n";

interface ParserDouble {
    parseSync: ReturnType<typeof vi.fn>;
    rawTransferSupported?: () => boolean;
}

/**
 * Load the extractor against a parser double.
 *
 * @param shape - What the parser double reports.
 * @param shape.supported - What the raw-transfer probe answers, or `'missing'`
 *   for a binding that does not export it.
 * @param shape.rawThrows - Whether a parse asked for through the raw transfer throws.
 * @returns The freshly loaded extractor and the double it talks to.
 */
async function loadWith(shape: { supported: boolean | 'missing'; rawThrows?: boolean }) {
    vi.resetModules();
    const actual = await vi.importActual<typeof import('oxc-parser')>('oxc-parser');
    const parseSync = vi.fn(
        (filename: string, source: string, options?: Record<string, unknown>) => {
            if (options?.experimentalRawTransfer && shape.rawThrows) {
                throw new Error('raw transfer failed on this host');
            }
            // The JSON form answers every call: the double is about WHICH form
            // was asked for, not about the AST.
            const { experimentalRawTransfer: _flag, ...rest } = options ?? {};
            return actual.parseSync(filename, source, rest);
        },
    );
    const double: ParserDouble = { parseSync };
    // A binding that lacks the probe is spelled as the property being absent
    // from the module namespace, which is what `undefined` reads as here.
    double.rawTransferSupported =
        shape.supported === 'missing' ? undefined : () => shape.supported as boolean;
    vi.doMock('oxc-parser', () => ({ ...actual, ...double }));
    const extract = await import('../src/cross-module-extract.js');
    return { extract, parseSync };
}

afterEach(() => {
    vi.doUnmock('oxc-parser');
    vi.resetModules();
});

describe('reaching the parser for registry entries', () => {
    it('asks for the raw transfer when the host supports it', async () => {
        const { extract, parseSync } = await loadWith({ supported: true });

        const entries = extract.extractCrossModuleRegistryEntries(SOURCE, '/p/card.ts');

        expect(entries.map(entry => entry.exportName)).toEqual(['card']);
        expect(parseSync).toHaveBeenCalledTimes(1);
        expect(parseSync.mock.calls[0]?.[2]).toMatchObject({ experimentalRawTransfer: true });
    });

    it('falls back to the JSON form when a raw parse throws', async () => {
        const { extract, parseSync } = await loadWith({ supported: true, rawThrows: true });

        const entries = extract.extractCrossModuleRegistryEntries(SOURCE, '/p/card.ts');

        expect(entries.map(entry => entry.exportName)).toEqual(['card']);
        expect(parseSync).toHaveBeenCalledTimes(2);
        expect(parseSync.mock.calls[1]?.[2]).not.toHaveProperty('experimentalRawTransfer');
    });

    it('uses the JSON form when the host says raw transfer is unsupported', async () => {
        const { extract, parseSync } = await loadWith({ supported: false });

        extract.extractCrossModuleRegistryEntries(SOURCE, '/p/card.ts');

        expect(parseSync).toHaveBeenCalledTimes(1);
        expect(parseSync.mock.calls[0]?.[2]).not.toHaveProperty('experimentalRawTransfer');
    });

    it('uses the JSON form when the binding does not export the probe at all', async () => {
        const { extract, parseSync } = await loadWith({ supported: 'missing' });

        const entries = extract.extractCrossModuleRegistryEntries(SOURCE, '/p/card.ts');

        expect(entries.map(entry => entry.exportName)).toEqual(['card']);
        expect(parseSync.mock.calls[0]?.[2]).not.toHaveProperty('experimentalRawTransfer');
    });
});
