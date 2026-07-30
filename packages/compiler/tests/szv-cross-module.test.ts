/**
 * Cross-module szv statics: registry extraction and the three-engine consumer.
 *
 * The design-system pattern — `export const cardSz = szv(<config>)` in one
 * module, `szr(cardSz(selection))` in another — was invisible to the per-file
 * engines. The bundler now builds a registry ONCE from its prescan (a single
 * extractor implementation, so cross-module knowledge cannot differ per
 * parser) and feeds each file the entries its relative imports resolve to;
 * every engine then runs the exact local-precompile machinery on the imported
 * factory, table compiled through its own lowering.
 *
 * These tests inject the registry through options directly — the consumer
 * contract is independent of how the bundler resolved the paths.
 */
import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { extractSzvRegistryEntries, transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type Engine = (
    source: string,
    filename?: string,
    options?: { crossModuleStatics?: Record<string, Record<string, unknown>> },
) => { code?: string; usesSzvPick?: boolean };

const LANES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode as Engine],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

const CARD_CONFIG = {
    base: { rounded: 'lg' },
    variants: {
        pad: { sm: { p: 2 }, lg: { p: 8 } },
        tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } },
    },
    defaultVariants: { tone: 'blue' },
};

const STATICS = { './styles': { cardSz: CARD_CONFIG } };

const IMPORTS = "import { szr } from '@csszyx/runtime';\nimport { cardSz } from './styles';\n";

describe.each(LANES)('%s lane', (_lane, engine) => {
    it('collapses a static selection on an imported factory', () => {
        const source = `${IMPORTS}export const cls = szr(cardSz({ pad: 'lg' }));`;
        const code = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS }).code ?? source;
        expect(code).toContain('"rounded-lg p-8 bg-blue-500 text-white"');
        expect(code).not.toContain('__szvPick');
    });

    it('turns a dynamic selection into a pick with the table after the import', () => {
        const source = `${IMPORTS}export const C = ({ s }) => szr(cardSz(s));`;
        const result = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS });
        const code = result.code ?? source;
        expect(result.usesSzvPick).toBe(true);
        expect(code).toContain('__szvPick(__szvT_cardSz, s)');
        expect(code).toContain('__szvT_cardSz');
    });

    it('composes with the szr import rewrite', () => {
        const source = `${IMPORTS}export const C = ({ s }) => szr(cardSz(s), cardSz({ pad: 'sm' }));`;
        const code = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS }).code ?? source;
        expect(code).toContain('@csszyx/runtime/core');
    });

    it('follows the LOCAL alias name', () => {
        const source =
            "import { szr } from '@csszyx/runtime';\n" +
            "import { cardSz as card } from './styles';\n" +
            "export const cls = szr(card({ pad: 'sm' }));";
        const code = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS }).code ?? source;
        expect(code).toContain('"rounded-lg p-2 bg-blue-500 text-white"');
    });

    it('bails when the imported factory leaks outside szr', () => {
        const source = `${IMPORTS}export const cls = szr(cardSz({ pad: 'sm' }));\nexport const leak = cardSz;`;
        const code = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS }).code ?? source;
        expect(code).not.toContain('__szvT_cardSz');
        expect(code).toContain('cardSz({');
    });

    it('changes nothing without registry entries', () => {
        const source = `${IMPORTS}export const cls = szr(cardSz({ pad: 'sm' }));`;
        const code = engine(source, '/p/t.tsx').code ?? source;
        expect(code).not.toContain('__szvT_cardSz');
        // The call survives (possibly reformatted); no build-time string did.
        expect(code).toContain('cardSz(');
        expect(code).not.toMatch(/szr\("/);
    });

    it('ignores entries for names the file does not import', () => {
        const source =
            "import { szr } from '@csszyx/runtime';\n" +
            "import { other } from './styles';\n" +
            'export const cls = szr(other());';
        const code = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS }).code ?? source;
        expect(code).not.toContain('__szvT_');
    });
});

describe('three-engine cross-module parity', () => {
    const sources = [
        `${IMPORTS}export const cls = szr(cardSz({ pad: 'lg' }));`,
        `${IMPORTS}export const C = ({ s }) => szr(cardSz(s));`,
        `${IMPORTS}export const cls = szr(cardSz({ pad: 'sm' }));\nexport const leak = cardSz;`,
    ];
    it.each(sources.map(source => [source.split('\n').pop() ?? '', source]))(
        'identical decisions for: %s',
        (_name, source) => {
            const shapes = LANES.map(([, engine]) => {
                const result = engine(source, '/p/t.tsx', { crossModuleStatics: STATICS });
                const code = result.code ?? source;
                return JSON.stringify({
                    pick: result.usesSzvPick === true,
                    table: code.includes('__szvT_cardSz'),
                    statics: [...code.matchAll(/szr\(("[^"]*")/g)].map(match => match[1]),
                });
            });
            expect(new Set(shapes).size).toBe(1);
        },
    );
});

describe('extractSzvRegistryEntries', () => {
    it('extracts exported literal factories, order preserved', () => {
        const source =
            "import { szv } from '@csszyx/runtime';\n" +
            'export const a = szv({ variants: { p1: { x: { p: 1 } } } });\n' +
            'const local = szv({ variants: { hidden: { y: { m: 1 } } } });\n' +
            'export const b = szv({ base: { flex: true } });\n';
        const entries = extractSzvRegistryEntries(source, '/p/styles.ts');
        expect(entries.map(entry => entry.exportName)).toEqual(['a', 'b']);
        expect(entries[0].config).toEqual({ variants: { p1: { x: { p: 1 } } } });
    });

    it('skips factories that fail qualification', () => {
        const source =
            "import { szv } from '@csszyx/runtime';\n" +
            // overlap: base and leaf touch the same canonical key
            'export const bad = szv({ base: { p: 4 }, variants: { pad: { lg: { p: 8 } } } });\n' +
            'export const dynamic2 = szv(cfg);\n';
        expect(extractSzvRegistryEntries(source, '/p/styles.ts')).toEqual([]);
    });

    it('returns nothing for unparseable or szv-free sources', () => {
        expect(extractSzvRegistryEntries('export const x = 1;', '/p/a.ts')).toEqual([]);
        expect(extractSzvRegistryEntries('const } broken szv(', '/p/b.ts')).toEqual([]);
    });
});
