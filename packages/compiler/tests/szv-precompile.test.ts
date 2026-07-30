/**
 * The szv per-key precompile: decision matrix, three-engine parity, and the
 * runtime oracle.
 *
 * `szr(F(selection))` pays a full object lowering per render; when `F` is a
 * file-local `szv(<literal config>)` whose branches share no canonical key,
 * the compiler collapses static selections to build-time strings and dynamic
 * ones to `__szvPick(TABLE, selection)`. Three invariants carry the suite:
 *
 * 1. **Decision parity** — a `build.parser` flip must not change the emitted
 *    module.
 * 2. **Conservative failure** — overlap, uses outside szr, extra references,
 *    non-literal configs: every uncertain shape keeps today's code.
 * 3. **The oracle** — a build-time string must equal what the runtime factory
 *    path would have produced for the same selection, to the byte.
 */
import { describe, expect, it } from 'vitest';
import {
    collectCanonicalLeafPaths,
    countWordOccurrences,
    leafPathsConflict,
    qualifyStaticSzvConfig,
    szvConfigFreeOfOverlap,
} from '../src/szv-precompile.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

type Engine = (source: string, filename?: string) => { code?: string; usesSzvPick?: boolean };

const LANES: ReadonlyArray<readonly [string, Engine]> = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc as Engine],
    ...(isRustTransformAvailable() ? ([['rust', transformRust as Engine]] as const) : []),
];

const IMPORTS = "import { szr } from '@csszyx/runtime';\nimport { szv } from '@csszyx/runtime';\n";

/** A well-formed factory used across the matrix. */
const FACTORY =
    "const cardSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } }, tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } } }, defaultVariants: { tone: 'blue' } });\n";

/**
 * Shape summary of one engine's output for parity comparison.
 *
 * @param engine - Engine entry under test.
 * @param source - Full module source.
 * @returns Static strings, pick presence, and normalized table content.
 */
function outputShape(engine: Engine, source: string) {
    const result = engine(source, '/p/t.tsx');
    const code = result.code ?? source;
    const statics = [...code.matchAll(/szr\(("[^"]*")/g)].map(match => match[1]);
    const tableMatch = /__szvT_cardSz\s*=\s*(\{[\s\S]*?\});/.exec(code);
    // Babel regenerates identifier keys unquoted; normalize to compare content.
    const table = tableMatch ? tableMatch[1].replace(/\s+/g, '').replace(/"/g, '') : null;
    return {
        usesSzvPick: result.usesSzvPick === true,
        hasPick: code.includes('__szvPick('),
        statics,
        table,
    };
}

/** [name, module body, expectation] matrix rows. */
const MATRIX: ReadonlyArray<readonly [string, string, 'static' | 'dynamic' | 'bail']> = [
    [
        'static selection collapses to a string',
        `${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }));`,
        'static',
    ],
    [
        'no-argument call resolves from defaults',
        `${FACTORY}export const cls = szr(cardSz());`,
        'static',
    ],
    [
        'dynamic selection becomes a table pick',
        `${FACTORY}export const C = ({ sel }) => szr(cardSz(sel));`,
        'dynamic',
    ],
    [
        'member selection stays dynamic',
        `${FACTORY}export const C = ({ p }) => szr(cardSz(p.sel));`,
        'dynamic',
    ],
    [
        'null selection value takes the dynamic path',
        `${FACTORY}export const cls = szr(cardSz({ tone: null }));`,
        'dynamic',
    ],
    [
        'non-integral numeric selection stays dynamic',
        `${FACTORY}export const cls = szr(cardSz({ pad: 2.5 }));`,
        'dynamic',
    ],
    [
        'negated safe-integer selection is static',
        "const f = szv({ variants: { ind: { '-1': { ml: 4 } } } });\nexport const c = szr(f({ ind: -1 }));",
        'static',
    ],
    [
        'overlapping canonical keys bail',
        "const cardSz = szv({ base: { p: 4 }, variants: { pad: { lg: { p: 8 } } } });\nexport const cls = szr(cardSz({ pad: 'lg' }));",
        'bail',
    ],
    [
        'alias overlap bails too',
        "const cardSz = szv({ base: { lineHeight: 5 }, variants: { t: { a: { leading: 7 } } } });\nexport const cls = szr(cardSz({ t: 'a' }));",
        'bail',
    ],
    [
        'nested paths on different targets do not bail',
        "const cardSz = szv({ base: { p: 4 }, variants: { r: { md: { md: { p: 8 } } } } });\nexport const cls = szr(cardSz({ r: 'md' }));",
        'static',
    ],
    [
        'factory used outside szr bails',
        `${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }));\nexport const leak = cardSz({ pad: 'sm' });`,
        'bail',
    ],
    [
        'factory passed as a value bails',
        `${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }));\nexport const helper = cardSz;`,
        'bail',
    ],
    [
        'a second argument bails',
        `${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }, extra));`,
        'bail',
    ],
    [
        'non-literal config bails',
        "const cfg = { variants: { pad: { lg: { p: 8 } } } };\nconst cardSz = szv(cfg);\nexport const cls = szr(cardSz({ pad: 'lg' }));",
        'bail',
    ],
    [
        'spread in the config bails',
        "const cardSz = szv({ variants: { pad: { lg: { p: 8, ...rest } } } });\nexport const cls = szr(cardSz({ pad: 'lg' }));",
        'bail',
    ],
    [
        'a comment naming the factory bails',
        `${FACTORY}// cardSz resolves below\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'bail',
    ],
];

describe.each(LANES)('%s lane', (_lane, engine) => {
    it.each(MATRIX)('%s', (_name, body, expectation) => {
        const shape = outputShape(engine, IMPORTS + body);
        if (expectation === 'static') {
            expect(shape.statics.length).toBeGreaterThan(0);
            expect(shape.hasPick).toBe(false);
        } else if (expectation === 'dynamic') {
            expect(shape.hasPick).toBe(true);
            expect(shape.usesSzvPick).toBe(true);
            expect(shape.table).not.toBeNull();
        } else {
            expect(shape.statics).toEqual([]);
            expect(shape.hasPick).toBe(false);
            expect(shape.table).toBeNull();
        }
    });
});

describe('three-engine output parity', () => {
    it.each(MATRIX)('identical shape for: %s', (_name, body) => {
        const shapes = LANES.map(([, engine]) =>
            JSON.stringify(outputShape(engine, IMPORTS + body)),
        );
        expect(new Set(shapes).size).toBe(1);
    });
});

describe('the runtime oracle', () => {
    it('a build-time string equals the factory path, byte for byte', async () => {
        const { szv } = await import('@csszyx/runtime');
        const { szr } = await import('@csszyx/runtime');
        const config = {
            base: { rounded: 'lg' },
            variants: {
                pad: { sm: { p: 2 }, lg: { p: 8 } },
                tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } },
            },
            defaultVariants: { tone: 'blue' },
        } as Parameters<typeof szv>[0];
        const factory = szv(config);
        const source = `${IMPORTS}${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }));`;
        for (const [, engine] of LANES) {
            const shape = outputShape(engine, source);
            expect(shape.statics).toEqual([JSON.stringify(szr(factory({ pad: 'lg' } as never)))]);
        }
    });
});

describe('idempotency', () => {
    it.each(LANES)('re-transforming the output changes nothing (%s)', (_lane, engine) => {
        // Some loader chains apply a transform twice; the second pass must
        // recognize its own output — rewritten imports are off the target map,
        // replaced calls leave no factory references, and the catalog guard
        // refuses to stack a second copy.
        const source = `${IMPORTS}${FACTORY}export const C = ({ s }) => szr(cardSz({ pad: 'sm' }), cardSz(s));`;
        const once = engine(source, '/p/t.tsx').code ?? source;
        const twice = engine(once, '/p/t.tsx').code ?? once;
        expect(twice).toBe(once);
    });
});

describe('composition with the szr import rewrite', () => {
    it('precompiled arguments let the szr import move to the core entry', () => {
        // The full prize: object arguments became strings, so the szr proof
        // passes and the compiler leaves the bundle entirely.
        const source = `${IMPORTS}${FACTORY}export const C = ({ sel }) => szr(cardSz(sel), cardSz({ pad: 'sm' }));`;
        for (const [lane, engine] of LANES) {
            const code = engine(source, '/p/t.tsx').code ?? source;
            expect(code, lane).toContain('@csszyx/runtime/core');
        }
    });

    it('a bailed factory keeps the szr import on the barrel', () => {
        const source =
            `${IMPORTS}const cardSz = szv({ base: { p: 4 }, variants: { pad: { lg: { p: 8 } } } });\n` +
            "export const cls = szr(cardSz({ pad: 'lg' }));";
        for (const [lane, engine] of LANES) {
            const code = engine(source, '/p/t.tsx').code ?? source;
            expect(code, lane).not.toContain('@csszyx/runtime/core');
        }
    });
});

describe('shared spec units', () => {
    it('collects canonical leaf paths through nesting', () => {
        // NUL-joined: a space can appear inside an arbitrary key, NUL cannot.
        const out: string[] = [];
        collectCanonicalLeafPaths({ md: { p: 4 }, bg: 'red-500' }, '', out);
        expect(out).toEqual(['md\u0000p', 'bg']);
    });

    it('flags equal, prefix, and suffix conflicts only', () => {
        expect(leafPathsConflict(['p'], ['p'])).toBe(true);
        expect(leafPathsConflict(['md'], ['md\u0000p'])).toBe(true);
        expect(leafPathsConflict(['md\u0000p'], ['md'])).toBe(true);
        expect(leafPathsConflict(['md\u0000p'], ['md\u0000m'])).toBe(false);
        expect(leafPathsConflict(['p'], ['md\u0000p'])).toBe(false);
    });

    it('same-dimension leaves never conflict with each other', () => {
        expect(
            szvConfigFreeOfOverlap({
                variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } },
            }),
        ).toBe(true);
    });

    it('qualification rejects unknown config keys and non-record shapes', () => {
        expect(qualifyStaticSzvConfig({ variants: {}, compoundVariants: [] })).toBeNull();
        expect(qualifyStaticSzvConfig({ variants: { pad: { sm: 'p-2' } } })).toBeNull();
        expect(qualifyStaticSzvConfig({ defaultVariants: { pad: 2.5 } })).toBeNull();
        expect(qualifyStaticSzvConfig(null)).toBeNull();
    });

    it('counts words at identifier boundaries', () => {
        expect(countWordOccurrences('cardSz(cardSz2); myCardSz; "cardSz"', 'cardSz')).toBe(2);
        expect(countWordOccurrences('', 'cardSz')).toBe(0);
        expect(countWordOccurrences('x', '')).toBe(0);
    });
});
