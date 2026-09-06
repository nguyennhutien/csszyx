/**
 * The szv per-key precompile: decision matrix, lane parity, and the
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
import type { MaybeSpan } from '../src/szv-precompile.js';
import {
    coerceParitySafeSelectionValue,
    collectCanonicalLeafPaths,
    computeStaticSzvPick,
    countWordOccurrences,
    countWordOccurrencesOutsideComments,
    leafPathsConflict,
    qualifyStaticSzvConfig,
    recordCrossModuleSzvFactoryImports,
    recordSzvTypeQueryByName,
    szvConfigFreeOfOverlap,
    szvFactoryAccountingHolds,
} from '../src/szv-precompile.js';
import { ENGINES } from './engine-parity-harness.js';

type Engine = (source: string, filename?: string) => { code?: string; usesSzvPick?: boolean };

/**
 * Both artifacts of the one engine. The shared list drops the `auto`
 * selector — `transform-select.test.ts` owns that — and refuses to run in CI
 * with the native artifact missing, which a hand-rolled list here could not
 * notice.
 */
const LANES = ENGINES;

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
        'integer-like keys follow JS iteration order on every engine',
        // JS iterates '2' before 'pad' regardless of declaration order; the
        // Rust mirror must agree or the emitted class order flips per parser.
        "const f = szv({ variants: { pad: { sm: { p: 2 } }, '2': { on: { m: 4 } } } });\nexport const c = szr(f({ pad: 'sm', '2': 'on' }));",
        'static',
    ],
    [
        'overlapping canonical keys bail',
        "const cardSz = szv({ base: { p: 4 }, variants: { pad: { lg: { p: 8 } } } });\nexport const cls = szr(cardSz({ pad: 'lg' }));",
        'bail',
    ],
    [
        'cross-branch text and leading fuse at lowering — bails',
        // Merged objects lower to the text-lg/7 COMPOSITE; separate branch
        // strings cannot. The runtime oracle is the byte proof.
        "const f = szv({ base: { text: 'lg' }, variants: { l: { a: { leading: 7 } } } });\nexport const c = szr(f({ l: 'a' }));",
        'bail',
    ],
    [
        'same-leaf text and leading fuse inside ONE branch — fine',
        "const f = szv({ variants: { s: { a: { text: 'lg', leading: 7 } } } });\nexport const c = szr(f({ s: 'a' }));",
        'static',
    ],
    [
        'cross-branch color-opacity nesting bails',
        "const f = szv({ base: { bg: { color: 'red-500' } }, variants: { o: { dim: { bg: { op: 50 } } } } });\nexport const c = szr(f({ o: 'dim' }));",
        'bail',
    ],
    [
        'an op modifier leaf bails outright',
        "const f = szv({ variants: { o: { dim: { op: 50 } } } });\nexport const c = szr(f({ o: 'dim' }));",
        'bail',
    ],
    [
        // `op` beside a colour key cannot be compiled per key, which is why a
        // bare `op` leaf bails. Inside one, it is the fusion form itself —
        // `borderColor: { color, op }` lowers to a single composite class, and
        // the leaf-path walk already folds the whole subtree onto `borderColor`.
        // The vocabulary check used to descend anyway and judge that `op` as if
        // it sat beside its parent.
        'a colour-fusion op inside one property compiles',
        "const f = szv({ variants: { c: { blue: { color: 'blue-500', border: true, borderColor: { color: 'blue-500', op: 35 } } } } });\nexport const c = szr(f({ c: 'blue' }));",
        'static',
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
        // Comments are parser-classified and erased at runtime; a doc mention
        // must not veto the precompile — design systems document factories.
        'a comment naming the factory does not bail',
        `${FACTORY}// cardSz resolves below\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'static',
    ],
    [
        'a type query naming the factory is erased and does not bail',
        `${FACTORY}type Selection = Parameters<typeof cardSz>[0];\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'static',
    ],
    [
        'a qualified type query still counts as an outside reference',
        `${FACTORY}type Selection = typeof ns.cardSz;\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'bail',
    ],
    [
        'an unrelated member-callee declaration is ignored',
        `${FACTORY}const other = ns.szv({});\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'static',
    ],
    [
        'a reserved factory binding is never precompiled',
        "const dynamic = szv({ variants: { pad: { lg: { p: 8 } } } });\nexport const cls = szr(dynamic({ pad: 'lg' }));",
        'bail',
    ],
    [
        'duplicate local factory names bail conservatively',
        `${FACTORY}{ const cardSz = szv({ variants: { pad: { sm: { p: 2 } } } }); }\nexport const cls = szr(cardSz({ pad: 'lg' }));`,
        'bail',
    ],
    [
        'a bigint config key is not a static object key',
        "const f = szv({ variants: { 1n: { yes: { p: 1 } } } });\nexport const cls = szr(f({ 1n: 'yes' }));",
        'bail',
    ],
    [
        'a negated dynamic config value is not static',
        'const f = szv({ base: { p: -space } });\nexport const cls = szr(f({}));',
        'bail',
    ],
    [
        'a negated string config value is not static',
        "const f = szv({ base: { p: -'space' } });\nexport const cls = szr(f({}));",
        'bail',
    ],
    [
        'a parenthesized factory declaration still precompiles',
        "const f = (szv({ variants: { pad: { sm: { p: 2 } } } }));\nexport const cls = szr(f({ pad: 'sm' }));",
        'static',
    ],
    [
        'a parenthesized static selection still precompiles',
        `${FACTORY}export const cls = szr(cardSz(({ pad: 'lg' })));`,
        'static',
    ],
    [
        'a STRING naming the factory still bails',
        `${FACTORY}export const cls = szr(cardSz({ pad: 'lg' }));\nexport const doc = 'cardSz';`,
        'bail',
    ],
    // Nested-argument shapes: the analysis walks &&/ternary/array around the
    // factory call, so guard patterns keep the precompile (vui's Flex shape).
    [
        'factory under a && guard becomes a pick',
        `${FACTORY}export const C = ({ on, sel }) => szr(on && cardSz(sel));`,
        'dynamic',
    ],
    [
        'factory with a dynamic selection VALUE under a guard picks',
        `${FACTORY}export const C = ({ pad }) => szr((pad === 0 || pad) && cardSz({ pad }));`,
        'dynamic',
    ],
    [
        'factories in both ternary branches pick',
        `${FACTORY}export const C = ({ on, a, b }) => szr(on ? cardSz(a) : cardSz(b));`,
        'dynamic',
    ],
    [
        // The spread breaks the ARGUMENT proof (import keeps the barrel), but
        // replacing the factory call is behavior-preserving regardless — the
        // pick still lands.
        'factory beside a spread element still picks',
        `${FACTORY}export const C = ({ sel }) => szr([cardSz(sel), ...rest]);`,
        'dynamic',
    ],
    [
        'factory under a truthy-boolean guard picks',
        `${FACTORY}export const C = ({ sel }) => szr(true && cardSz(sel));`,
        'dynamic',
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

describe('output parity across the lanes', () => {
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

    it('guarded factory arguments still move the szr import to the core entry', () => {
        // vui's Flex shape: every factory call sits under a && guard with a
        // dynamic selection. Proven guards + rewritten factories = core entry.
        const source =
            `${IMPORTS}${FACTORY}export const C = ({ d, j }) =>\n` +
            '    szr(d && cardSz({ pad: d }), j && cardSz({ tone: j }));';
        for (const [lane, engine] of LANES) {
            const code = engine(source, '/p/t.tsx').code ?? source;
            expect(code, lane).toContain('@csszyx/runtime/core');
            expect(code, lane).toContain('__szvPick(');
            expect(code, lane).not.toContain('cardSz(');
        }
    });

    it('an unproven factory call keeps the barrel and warns once', () => {
        // mk() is analyzable as a factory candidate but never qualifies, so
        // the argument stays unproven: no rewrite, one deferred fallback.
        const source = `${IMPORTS}export const C = () => szr(mk());`;
        for (const [lane, engine] of LANES) {
            const result = engine(source, '/p/t.tsx') as {
                code?: string;
                diagnostics?: string[];
            };
            expect(result.code ?? source, lane).not.toContain('@csszyx/runtime/core');
            expect((result.diagnostics ?? []).length, lane).toBe(1);
        }
    });

    it('a proven string argument stays silent', () => {
        const source = `${IMPORTS}export const cls = szr('p-4');`;
        for (const [lane, engine] of LANES) {
            const result = engine(source, '/p/t.tsx') as { diagnostics?: string[] };
            expect(result.diagnostics ?? [], lane).toEqual([]);
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

    it('folds property-object children into one canonical fusion path', () => {
        const out: string[] = [];
        collectCanonicalLeafPaths({ bg: { color: 'red-500', op: 50 } }, '', out);
        expect(out).toEqual(['bg']);
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

    it('rejects overlap between separate dimensions and nested css declarations', () => {
        expect(
            szvConfigFreeOfOverlap({
                variants: {
                    pad: { sm: { p: 2 } },
                    density: { compact: { p: 1 } },
                },
            }),
        ).toBe(false);
        expect(
            qualifyStaticSzvConfig({ base: { css: { color: { nested: 'invalid' } } } }),
        ).toBeNull();
        expect(
            qualifyStaticSzvConfig({
                base: { css: { color: 'red', '--card-gap': '1rem' } },
            }),
        ).not.toBeNull();
    });

    it('qualification rejects unknown config keys and non-record shapes', () => {
        expect(qualifyStaticSzvConfig({ variants: {}, compoundVariants: [] })).toBeNull();
        expect(qualifyStaticSzvConfig({ variants: { pad: { sm: 'p-2' } } })).toBeNull();
        expect(qualifyStaticSzvConfig({ defaultVariants: { pad: 2.5 } })).toBeNull();
        expect(qualifyStaticSzvConfig({ base: 'p-2' })).toBeNull();
        expect(qualifyStaticSzvConfig({ variants: 'bad' })).toBeNull();
        expect(qualifyStaticSzvConfig({ defaultVariants: 'bad' })).toBeNull();
        expect(qualifyStaticSzvConfig(null)).toBeNull();
    });

    it('keeps an empty variant branch as an empty compiled class', () => {
        expect(qualifyStaticSzvConfig({ variants: { pad: { empty: {} } } })?.d.pad.empty).toBe('');
    });

    it('counts words at identifier boundaries', () => {
        expect(countWordOccurrences('cardSz(cardSz2); myCardSz; "cardSz"', 'cardSz')).toBe(2);
        expect(countWordOccurrences('', 'cardSz')).toBe(0);
        expect(countWordOccurrences('x', '')).toBe(0);
        expect(countWordOccurrencesOutsideComments('factory()', '', [])).toBe(0);
        expect(countWordOccurrences('cardSz', 'cardSz')).toBe(1);
        expect(countWordOccurrencesOutsideComments('cardSz', 'cardSz', [])).toBe(1);
    });

    it('records only enabled named type queries', () => {
        const typeQueryCounts = new Map<string, number>();
        const state = { enabled: true, typeQueryCounts };
        recordSzvTypeQueryByName('factory', state);
        recordSzvTypeQueryByName('factory', state);
        recordSzvTypeQueryByName(null, state);
        recordSzvTypeQueryByName('disabled', { enabled: false, typeQueryCounts });
        expect([...typeQueryCounts]).toEqual([['factory', 2]]);
    });

    it('records only resolvable cross-module factory imports', () => {
        const candidates = new Map<string, { localName: string; config: unknown }>();
        const state = {
            crossModuleStatics: { './factory': { card: { variants: {} } } },
            candidates,
        };
        recordCrossModuleSzvFactoryImports(
            './factory',
            false,
            [
                { importedName: 'card', localName: 'localCard', typeOnly: false },
                { importedName: 'missing', localName: 'missing', typeOnly: false },
                { importedName: 'card', localName: null, typeOnly: false },
                { importedName: 'card', localName: 'szv', typeOnly: false },
                { importedName: 'card', localName: 'typed', typeOnly: true },
                { importedName: 'card', localName: 'localCard', typeOnly: false },
            ],
            state,
            (localName, config) => ({ localName, config }),
        );
        recordCrossModuleSzvFactoryImports(null, false, [], state, (localName, config) => ({
            localName,
            config,
        }));
        recordCrossModuleSzvFactoryImports('./factory', true, [], state, (localName, config) => ({
            localName,
            config,
        }));
        expect([...candidates.keys()]).toEqual(['localCard']);
    });

    it('accounts for type queries and rejects an occupied table identifier', () => {
        const call = { arguments: [] as unknown[] };
        const calls = [call];
        const callSet = new Set<unknown>(calls);
        const typeQueries = new Map([['factory', 1]]);
        expect(
            szvFactoryAccountingHolds(
                'factory',
                calls,
                callSet,
                'const factory = factory(); type T = typeof factory;',
                [],
                typeQueries,
                [],
            ),
        ).toBe(true);
        expect(
            szvFactoryAccountingHolds(
                'factory',
                calls,
                callSet,
                'const factory = factory(); type T = typeof factory; const __szvT_factory = {};',
                [],
                typeQueries,
                [],
            ),
        ).toBe(false);
    });

    it('rejects a call the sz rewrite will replace wholesale', () => {
        const source = 'const factory = factory();';
        const call = { arguments: [] as unknown[], start: 16, end: 25 };
        const calls = [call];
        const callSet = new Set<unknown>(calls);
        const holds = (rewritten: readonly MaybeSpan[]): boolean =>
            szvFactoryAccountingHolds('factory', calls, callSet, source, [], new Map(), rewritten);
        expect(holds([])).toBe(true);
        // Disjoint, then overlapping only one edge: neither encloses the call.
        expect(holds([{ start: 0, end: 10 }])).toBe(true);
        expect(holds([{ start: 17, end: 26 }])).toBe(true);
        expect(holds([{ start: 16, end: 25 }])).toBe(false);
        expect(holds([{ start: 10, end: 26 }])).toBe(false);
        // An unknown offset on either side is not evidence of an overlap.
        expect(holds([{ start: null, end: 26 }])).toBe(true);
        expect(holds([{ start: 10, end: undefined }])).toBe(true);
    });

    it('leaves a call without source offsets accounted for', () => {
        // Babel types `start`/`end` as nullable; a synthesized node has no
        // offsets to compare, and losing the precompile for it would be a
        // silent regression rather than a safety property.
        const call = { arguments: [] as unknown[], start: null, end: null };
        const calls = [call];
        expect(
            szvFactoryAccountingHolds(
                'factory',
                calls,
                new Set<unknown>(calls),
                'const factory = factory();',
                [],
                new Map(),
                [{ start: 0, end: 100 }],
            ),
        ).toBe(true);
    });

    it('coerces only parity-safe primitive selection values', () => {
        expect(coerceParitySafeSelectionValue('sm')).toBe('sm');
        expect(coerceParitySafeSelectionValue(true)).toBe(true);
        expect(coerceParitySafeSelectionValue(2)).toBe(2);
        expect(coerceParitySafeSelectionValue({})).toBeNull();
        expect(coerceParitySafeSelectionValue(null)).toBeNull();
    });
});

describe('the single-dimension picker', () => {
    /**
     * `F({ dim: value })` — one statically named dimension, dynamic value — is
     * the shape a design system writes constantly, and the one where the full
     * picker's walk over every OTHER dimension can only miss. It collapses to
     * `__szvPick1(TABLE, "dim", value)`, which skips both the selection object
     * and that walk.
     *
     * The rewrite is legal only when omitting the other dimensions cannot
     * change the output — i.e. the table carries no `defaultVariants` — and
     * when the named key is a real dimension, so an unknown one keeps flowing
     * through the full picker that warns about it.
     */
    const PLAIN =
        "const plainSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } }, tone: { red: { bg: 'red-500' } } } });\n";

    /**
     * Which picker a module emitted, plus its normalized argument text.
     *
     * @param engine - Engine entry under test.
     * @param source - Full module source.
     * @returns The emitted helper, its arguments, and the usage flags.
     */
    function pickShape(engine: Engine, source: string) {
        const result = engine(source, '/p/t.tsx') as {
            code?: string;
            usesSzvPick?: boolean;
            usesSzvPick1?: boolean;
        };
        const code = result.code ?? source;
        const single = /__szvPick1\(([^)]*)\)/.exec(code);
        const full = /__szvPick\(([^)]*)\)/.exec(code);
        const matched = single ?? full;
        const helper = single ? 'pick1' : 'pick';
        return {
            helper: matched ? helper : 'none',
            args: ((single ?? full)?.[1] ?? '').replace(/\s+/g, ''),
            usesSzvPick: result.usesSzvPick === true,
            usesSzvPick1: result.usesSzvPick1 === true,
        };
    }

    const CASES: ReadonlyArray<readonly [string, string, 'pick1' | 'pick']> = [
        [
            'one dynamic value under a known dimension',
            `${PLAIN}export const C = ({ p }) => szr(plainSz({ pad: p }));`,
            'pick1',
        ],
        [
            'shorthand property',
            `${PLAIN}export const C = ({ pad }) => szr(plainSz({ pad }));`,
            'pick1',
        ],
        [
            'string-literal key',
            `${PLAIN}export const C = ({ p }) => szr(plainSz({ 'pad': p }));`,
            'pick1',
        ],
        [
            'member-expression value',
            `${PLAIN}export const C = props => szr(plainSz({ tone: props.tone }));`,
            'pick1',
        ],
        [
            'under a guard, like the layered-component shape',
            `${PLAIN}export const C = ({ on, p }) => szr(on && plainSz({ pad: p }));`,
            'pick1',
        ],
        // Everything below must keep the FULL picker.
        [
            'two dimensions selected at once',
            `${PLAIN}export const C = ({ p, t }) => szr(plainSz({ pad: p, tone: t }));`,
            'pick',
        ],
        [
            'a selection that is not an object literal',
            `${PLAIN}export const C = ({ sel }) => szr(plainSz(sel));`,
            'pick',
        ],
        [
            'a computed key',
            `${PLAIN}export const C = ({ k, v }) => szr(plainSz({ [k]: v }));`,
            'pick',
        ],
        ['a numeric key', `${PLAIN}export const C = ({ v }) => szr(plainSz({ 0: v }));`, 'pick'],
        [
            'a spread selection',
            `${PLAIN}export const C = ({ rest }) => szr(plainSz({ ...rest }));`,
            'pick',
        ],
        [
            'a key that is not a declared dimension',
            `${PLAIN}export const C = ({ v }) => szr(plainSz({ nope: v }));`,
            'pick',
        ],
        [
            // `{ __proto__: v }` sets the PROTOTYPE, so the full picker's
            // own-property probe selects nothing; indexing the table by it
            // would not.
            'a __proto__ key',
            `${PLAIN}export const C = ({ v }) => szr(plainSz({ __proto__: v }));`,
            'pick',
        ],
        [
            // A default makes the OMITTED dimensions contribute classes.
            'a table carrying defaultVariants',
            `${FACTORY}export const C = ({ p }) => szr(cardSz({ pad: p }));`,
            'pick',
        ],
    ];

    describe.each(LANES)('%s lane', (_lane, engine) => {
        it.each(CASES)('%s', (_name, body, expected) => {
            const shape = pickShape(engine, IMPORTS + body);
            expect(shape.helper).toBe(expected);
            expect(shape.usesSzvPick1).toBe(expected === 'pick1');
            expect(shape.usesSzvPick).toBe(expected === 'pick');
        });
    });

    it.each(CASES)('both artifacts agree on: %s', (_name, body) => {
        const shapes = LANES.map(([, engine]) => JSON.stringify(pickShape(engine, IMPORTS + body)));
        expect(new Set(shapes).size).toBe(1);
    });

    it('emits the dimension as a literal and the value verbatim', () => {
        const source = `${IMPORTS}${PLAIN}export const C = ({ p }) => szr(plainSz({ pad: p }));`;
        for (const [lane, engine] of LANES) {
            const shape = pickShape(engine, source);
            expect(shape.args, lane).toBe('__szvT_plainSz,"pad",p');
        }
    });
});

describe('computeStaticSzvPick', () => {
    it('ignores a selected value absent from a qualified dimension table', () => {
        expect(
            computeStaticSzvPick(
                { base: 'base', d: { tone: { quiet: 'text-muted' } } },
                { tone: 'missing' },
            ),
        ).toBe('base');
    });
});
