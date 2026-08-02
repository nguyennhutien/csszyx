/**
 * `__szvPick` equivalence: the compiled-table path must be indistinguishable
 * from the object path it replaces.
 *
 * The compiler will rewrite `szr(F(selection))` into `__szvPick(TABLE, …)`
 * only when the config qualifies; the rewrite is sound exactly when the two
 * paths agree on EVERY reachable selection. The selection space is finite, so
 * this suite enumerates it exhaustively — per dimension: absent, every
 * declared value, `undefined`, `null`, and an unknown value — and compares the
 * full className STRINGS (order included, not just the class set: class order
 * fixes production mangle IDs).
 *
 * It also pins the one case that must NOT be rewritten: overlapping canonical
 * keys across branches, where object merge (last wins, ONE class) and string
 * concat (BOTH classes) genuinely differ. That case failing equivalence here
 * is the reason the compiler's overlap detector bails.
 */
import { type SzObject, transform } from '@csszyx/compiler/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { szr } from '../src/concatenate.js';
import { setSzLowering } from '../src/lowering-slot.js';
import { __szvPick, __szvPick1, type SzvCompiledTable } from '../src/szv-pick.js';
import { szv } from '../src/variants.js';

afterEach(() => {
    setSzLowering(null);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

/** One szv config under test, in the runtime's own shape. */
interface TestConfig {
    base?: SzObject;
    variants?: Record<string, Record<string, SzObject>>;
    defaultVariants?: Record<string, string>;
}

/**
 * Compile a config into the table the build will emit: every branch lowered
 * through the real transform.
 *
 * @param config - szv config with static branches.
 * @returns The compiled per-key table.
 */
function compileTable(config: TestConfig): SzvCompiledTable {
    const d: Record<string, Record<string, string>> = {};
    for (const [dimension, values] of Object.entries(config.variants ?? {})) {
        d[dimension] = {};
        for (const [value, leaf] of Object.entries(values)) {
            d[dimension][value] = transform(leaf).className;
        }
    }
    return {
        base: config.base ? transform(config.base).className : '',
        d,
        defaults: config.defaultVariants,
    };
}

/**
 * Enumerate the full selection space of a config.
 *
 * @param config - szv config under test.
 * @returns Every selection worth distinguishing, absent-selection included.
 */
function enumerateSelections(config: TestConfig): Array<Record<string, unknown> | undefined> {
    const dimensions = Object.keys(config.variants ?? {});
    let combos: Array<Record<string, unknown>> = [{}];
    for (const dimension of dimensions) {
        const values = Object.keys(config.variants?.[dimension] ?? {});
        const options: Array<unknown | typeof ABSENT> = [
            ABSENT,
            ...values,
            undefined,
            null,
            'no-such-value',
        ];
        const next: Array<Record<string, unknown>> = [];
        for (const combo of combos) {
            for (const option of options) {
                next.push(option === ABSENT ? combo : { ...combo, [dimension]: option });
            }
        }
        combos = next;
    }
    return [undefined, ...combos];
}

/** Marker for "dimension not present in the selection object at all". */
const ABSENT = Symbol('absent');

/**
 * Assert full equivalence over the enumerated selection space.
 *
 * @param name - Config label for failure messages.
 * @param config - szv config under test.
 * @returns Number of selections compared.
 */
function expectEquivalence(name: string, config: TestConfig): number {
    const factory = szv(config as Parameters<typeof szv>[0]);
    const table = compileTable(config);
    const selections = enumerateSelections(config);
    for (const selection of selections) {
        const viaObjects = szr(factory(selection as Parameters<typeof factory>[0]));
        const viaTable = __szvPick(table, selection);
        expect(viaTable, `${name} — selection ${JSON.stringify(selection)}`).toBe(viaObjects);
    }
    return selections.length;
}

describe('__szvPick equivalence (exhaustive)', () => {
    it('base + two dimensions', () => {
        const compared = expectEquivalence('base+2dims', {
            base: { rounded: 'lg', shadow: 'md' },
            variants: {
                pad: { sm: { p: 2 }, lg: { p: 8 } },
                tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } },
            },
        });
        // 1 undefined + (1 absent + 2 values + undefined + null + unknown)^2
        expect(compared).toBe(37);
    });

    it('no base at all', () => {
        expectEquivalence('no-base', {
            variants: { size: { sm: { text: 'sm' }, lg: { text: 'lg' } } },
        });
    });

    it('defaultVariants fill absent and nullish selections', () => {
        expectEquivalence('defaults', {
            base: { flex: true },
            variants: {
                pad: { sm: { p: 2 }, lg: { p: 8 } },
                tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500' } },
            },
            defaultVariants: { pad: 'sm', tone: 'blue' },
        });
    });

    it('variant leaves with nesting, negatives and arbitrary values', () => {
        expectEquivalence('rich-leaves', {
            base: { p: 4 },
            variants: {
                motion: {
                    off: { translateX: 0 },
                    slide: { translateX: '-full', hover: { translateX: 0 } },
                },
                width: { fluid: { w: '[72ch]' }, fixed: { w: 64, md: { w: 96 } } },
            },
        });
    });

    it('numeric and boolean-like value names', () => {
        // Property access coerces `2`/`true` to '2'/'true' on both paths.
        const config: TestConfig = {
            variants: { cols: { '2': { gridCols: 2 }, '3': { gridCols: 3 } } },
        };
        const factory = szv(config as Parameters<typeof szv>[0]);
        const table = compileTable(config);
        expect(__szvPick(table, { cols: 2 })).toBe(szr(factory({ cols: 2 } as never)));
        expect(__szvPick(table, { cols: '3' })).toBe(szr(factory({ cols: '3' } as never)));
    });

    it('empty config degrades identically', () => {
        expectEquivalence('empty', {});
    });
});

describe('the overlap case the compiler must bail on', () => {
    it('object merge and string concat genuinely differ when branches share a key', () => {
        // base p-4, variant p-8: the object path merges (last wins, ONE class),
        // the table path concatenates (BOTH classes, CSS order decides). This
        // difference is not a picker bug — it is the reason the rewrite's
        // overlap detector must keep the object path for configs like this.
        const config: TestConfig = {
            base: { p: 4 },
            variants: { pad: { lg: { p: 8 } } },
        };
        const factory = szv(config as Parameters<typeof szv>[0]);
        const table = compileTable(config);
        expect(szr(factory({ pad: 'lg' } as never))).toBe('p-8');
        expect(__szvPick(table, { pad: 'lg' })).toBe('p-4 p-8');
    });
});

describe('dev warning parity', () => {
    it('warns through the same devWarn with the same message shapes', () => {
        // Both paths share ONE devWarn, which de-duplicates messages
        // process-wide — so byte parity is structural, and repeating the
        // factory's exact bad selection through the picker is deliberately
        // silent. Distinct bad keys per path prove the picker produces the
        // same shapes through the same channel.
        const config: TestConfig = {
            variants: { pad: { sm: { p: 2 } }, tone: { red: { bg: 'red-500' } } },
        };
        const factory = szv(config as Parameters<typeof szv>[0]);
        const table = compileTable(config);
        const seen: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            seen.push(args.map(String).join(' '));
        });

        szr(factory({ ghostA: 'x', pad: 'nopeA' } as never));
        const fromFactory = seen.splice(0);
        expect(fromFactory.join('\n')).toContain('unknown variant "ghostA"');
        expect(fromFactory.join('\n')).toContain('"nopeA" is not a value of variant "pad"');

        __szvPick(table, { ghostB: 'x', tone: 'nopeB' });
        const fromPicker = seen.splice(0);
        expect(fromPicker.join('\n')).toContain('unknown variant "ghostB"');
        expect(fromPicker.join('\n')).toContain('"nopeB" is not a value of variant "tone"');

        // Identical templates modulo the differing names.
        const normalize = (messages: string[]): string[] =>
            messages.map(m => m.replace(/"[^"]*"/g, '"·"')).sort();
        expect(normalize(fromPicker)).toEqual(normalize(fromFactory));

        // And the dedup itself: repeating an already-warned selection through
        // the OTHER path stays silent, because the channel is shared.
        __szvPick(table, { ghostA: 'x' });
        expect(seen).toEqual([]);
    });
});

describe('picker hardening', () => {
    it('skips advisory validation in production for both picker shapes', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const warn = vi.spyOn(console, 'warn');
        const table = compileTable({ variants: { pad: { sm: { p: 2 } } } });

        expect(__szvPick(table, { pad: 'sm' })).toBe('p-2');
        expect(__szvPick1(table, 'pad', 'sm')).toBe('p-2');
        expect(warn).not.toHaveBeenCalled();
    });

    it('ignores inherited selection properties, like the factory does', () => {
        const table = compileTable({ variants: { pad: { sm: { p: 2 } } } });
        const selection = Object.create({ pad: 'sm' }) as Record<string, unknown>;
        expect(__szvPick(table, selection)).toBe('');
    });

    it('a null/undefined selection value falls back to the default', () => {
        const table = compileTable({
            variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } },
            defaultVariants: { pad: 'lg' },
        });
        expect(__szvPick(table, { pad: null })).toBe('p-8');
        expect(__szvPick(table, { pad: undefined })).toBe('p-8');
    });

    it('describes structurally invalid selection values without coercing them', () => {
        const table = compileTable({ variants: { pad: { sm: { p: 2 } } } });
        const seen: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            seen.push(args.map(String).join(' '));
        });

        __szvPick(table, { pad: [] });
        __szvPick(table, { pad: { value: 'sm' } });

        expect(seen.join('\n')).toContain('"an array" is not a value of variant "pad"');
        expect(seen.join('\n')).toContain('"object" is not a value of variant "pad"');
    });
});

describe('__szvPick1 equivalence (exhaustive)', () => {
    /**
     * The single-dimension picker must be indistinguishable from the full one
     * called with a one-key selection — that equality is the whole licence for
     * the compiler to emit it. Enumerated per dimension over every declared
     * value plus `undefined`, `null` and an unknown value.
     *
     * Only defaults-free configs appear here: a `defaultVariants` entry makes
     * the OMITTED dimensions contribute classes the single-dimension picker
     * never walks, which is exactly why the compiler refuses those tables.
     */
    const CONFIGS: ReadonlyArray<readonly [string, TestConfig]> = [
        [
            'base + two dimensions',
            {
                base: { rounded: 'lg', shadow: 'md' },
                variants: {
                    pad: { sm: { p: 2 }, lg: { p: 8 } },
                    tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } },
                },
            },
        ],
        ['no base', { variants: { dir: { row: { flexDir: 'row' }, col: { flexDir: 'col' } } } }],
        [
            'five dimensions (the shape the fast path exists for)',
            {
                base: { flex: true },
                variants: {
                    a: { on: { p: 1 } },
                    b: { on: { m: 2 } },
                    c: { on: { gap: 3 } },
                    d: { on: { w: 4 } },
                    e: { on: { h: 5 } },
                },
            },
        ],
    ];

    it.each(CONFIGS)('%s', (_name, config) => {
        const table = compileTable(config);
        for (const dimension of Object.keys(config.variants ?? {})) {
            const values: unknown[] = [
                ...Object.keys(config.variants?.[dimension] ?? {}),
                undefined,
                null,
                'no-such-value',
                true,
                7,
            ];
            for (const value of values) {
                expect(__szvPick1(table, dimension, value), `${dimension}=${String(value)}`).toBe(
                    __szvPick(table, { [dimension]: value }),
                );
            }
        }
    });

    it('warns exactly like the full picker for an unknown value', () => {
        const seen: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
            seen.push(args.map(String).join(' '));
        });
        const table = compileTable({ variants: { pad: { sm: { p: 2 } } } });

        __szvPick1(table, 'pad', 'nopeSingle');
        const fromSingle = seen.splice(0);
        __szvPick(table, { pad: 'nopeFull' });
        const fromFull = seen.splice(0);

        expect(fromSingle.join('\n')).toContain('"nopeSingle" is not a value of variant "pad"');
        const normalize = (messages: string[]): string[] =>
            messages.map(m => m.replace(/"[^"]*"/g, '"·"'));
        expect(normalize(fromSingle)).toEqual(normalize(fromFull));
    });
});
