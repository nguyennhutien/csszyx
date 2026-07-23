/**
 * szv catalog — per-key lenient extraction parity across the three engines.
 *
 * One unresolvable leaf (a runtime conditional, a call, a template, an array,
 * a computed key…) used to drop the ENTIRE szv catalog — every static sibling
 * key and every other variant included — which under Tailwind `source(none)`
 * is silently missing CSS. Worse, the engines disagreed on which leaves they
 * could resolve (rust followed const refs, oxc/babel did not), so flipping
 * `build.parser` changed the safelist (field-reported by a design-system
 * consumer as "rust drops tokens from a multi-key szv variant object").
 *
 * Contract locked here, identical in babel/oxc/rust:
 *   - unreadable KEYS are skipped individually; siblings and other variants
 *     always survive;
 *   - finite conditionals contribute BOTH branches (the runtime picks one at
 *     render time, so both classes must exist);
 *   - `null`/`undefined` mean "key unset";
 *   - const identifiers (scalar or object) resolve through their initializer,
 *     const-only, same file;
 *   - const object spreads resolve; unresolvable spreads are skipped alone.
 */

import { describe, expect, it } from 'vitest';

import {
    OxcRustNotImplementedError,
    transformOxc,
    transformRust,
    transformSourceCode,
} from '../src/index.js';

const IMPORT = "import { szv } from 'csszyx';";

/**
 * Run all three engines and assert their class sets are identical AND equal
 * to the expected list.
 * @param source TSX source containing an szv config.
 * @param expected Classes every engine must extract (order-insensitive).
 */
function expectCatalogParity(source: string, expected: string[]): void {
    const oxc = [...transformOxc(source, 'catalog.tsx').classes].sort();
    const babel = [...transformSourceCode(source, 'catalog.tsx').classes].sort();
    const wanted = [...expected].sort();
    expect(oxc, 'oxc classes').toEqual(wanted);
    expect(babel, 'babel classes').toEqual(wanted);
    try {
        const rust = [...transformRust(source, 'catalog.tsx').classes].sort();
        expect(rust, 'rust classes').toEqual(wanted);
    } catch (err) {
        // Native binary absent on this host — the JS parity above still holds.
        expect(err).toBeInstanceOf(OxcRustNotImplementedError);
    }
}

const CONTROL = `
const controlSz = szv({ variants: { layout: {
    panelSelect: { grow: 1, mx: 0, my: 4 },
    panel: { grow: 1, m: 4 },
} } });`;

describe('szv catalog — per-key leniency (3-engine parity)', () => {
    it('multi-key variant objects extract every side (the field-reported case)', () => {
        expectCatalogParity(`${IMPORT}${CONTROL}`, ['grow-1', 'mx-0', 'my-4', 'm-4']);
    });

    it('a conditional sibling keeps every static key and contributes both branches', () => {
        expectCatalogParity(
            `${IMPORT}
declare const dense: boolean;
const controlSz = szv({ variants: { layout: {
    panelSelect: { grow: 1, mx: 0, my: 4, p: dense ? 2 : 4 },
    panel: { grow: 1, m: 4 },
} } });`,
            ['grow-1', 'mx-0', 'my-4', 'p-2', 'p-4', 'm-4'],
        );
    });

    it('a conditional under a variant prefix keeps the prefix on both branches', () => {
        expectCatalogParity(
            `${IMPORT}
declare const dense: boolean;
const s = szv({ variants: { tone: {
    hot: { hover: { mx: dense ? 0 : 2 }, bg: 'red-500' },
} } });`,
            ['hover:mx-0', 'hover:mx-2', 'bg-red-500'],
        );
    });

    it.each([
        ['call', `w: calc()`],
        ['template', 'w: `${x}px`'],
        ['member', `w: SIZES.panel`],
        ['array', `mx: [0, 2]`],
        ['arrow function', `fn: () => 1`],
    ])('an unreadable %s value skips only its own key', (_kind, leaf) => {
        expectCatalogParity(
            `${IMPORT}
declare function calc(): number;
declare const x: number;
declare const SIZES: { panel: number };
const s = szv({ variants: { layout: {
    a: { grow: 1, ${leaf}, my: 4 },
    b: { m: 4 },
} } });`,
            ['grow-1', 'my-4', 'm-4'],
        );
    });

    it('a computed key is skipped without dropping siblings', () => {
        expectCatalogParity(
            `${IMPORT}
const s = szv({ variants: { layout: { a: { grow: 1, ['mx']: 0, my: 4 } } } });`,
            ['grow-1', 'my-4'],
        );
    });

    it('null and undefined mean "key unset"', () => {
        expectCatalogParity(
            `${IMPORT}
const s = szv({ variants: { layout: { a: { grow: 1, mx: null, my: undefined, m: 4 } } } });`,
            ['grow-1', 'm-4'],
        );
    });

    it('const scalar refs resolve in every engine', () => {
        expectCatalogParity(
            `${IMPORT}
const GUTTER = 0;
const s = szv({ variants: { layout: { a: { grow: 1, mx: GUTTER, my: 4 } } } });`,
            ['grow-1', 'mx-0', 'my-4'],
        );
    });

    it('a reassigned let ref is never followed', () => {
        expectCatalogParity(
            `${IMPORT}
let gutter = 0;
gutter = 2;
const s = szv({ variants: { layout: { a: { grow: 1, mx: gutter, my: 4 } } } });`,
            ['grow-1', 'my-4'],
        );
    });

    it('unary plus and negative numbers resolve', () => {
        expectCatalogParity(
            `${IMPORT}
const s = szv({ variants: { layout: { a: { mx: +0, mt: -2 } } } });`,
            ['mx-0', '-mt-2'],
        );
    });

    it('const object spreads resolve in every engine', () => {
        expectCatalogParity(
            `${IMPORT}
const shared = { grow: 1 };
const s = szv({ variants: { layout: {
    a: { ...shared, mx: 0, my: 4 },
    b: { ...shared, m: 4 },
} } });`,
            ['grow-1', 'mx-0', 'my-4', 'm-4'],
        );
    });

    it('an unresolvable spread is skipped without dropping literal keys', () => {
        expectCatalogParity(
            `${IMPORT}
declare const external: Record<string, number>;
const s = szv({ variants: { layout: { a: { ...external, mx: 0, my: 4 } } } });`,
            ['mx-0', 'my-4'],
        );
    });

    it('a whole variant value can be a conditional between two objects', () => {
        expectCatalogParity(
            `${IMPORT}
declare const dense: boolean;
const s = szv({ variants: { layout: {
    a: dense ? { mx: 0 } : { mx: 2 },
} } });`,
            ['mx-0', 'mx-2'],
        );
    });

    it('base is per-key lenient too and merges into variants', () => {
        expectCatalogParity(
            `${IMPORT}
declare function calc(): number;
const s = szv({ base: { rounded: 'md', w: calc() }, variants: { s: { x: { p: 4 } } } });`,
            ['rounded-md', 'p-4'],
        );
    });

    it('conditionals inside base contribute both branches', () => {
        expectCatalogParity(
            `${IMPORT}
declare const dense: boolean;
const s = szv({ base: { p: dense ? 2 : 4 }, variants: { s: { x: { m: 1 } } } });`,
            ['p-2', 'p-4', 'm-1'],
        );
    });

    it('nested conditional branches resolve recursively (cond of cond)', () => {
        expectCatalogParity(
            `${IMPORT}
declare const a: boolean;
declare const b: boolean;
const s = szv({ variants: { t: { x: { p: a ? 1 : b ? 2 : 3 } } } });`,
            ['p-1', 'p-2', 'p-3'],
        );
    });

    it('self-referential const chains do not loop', () => {
        // `const A = A` is a TDZ error at runtime but must not hang extraction.
        expectCatalogParity(
            `${IMPORT}
const s = szv({ variants: { t: { x: { p: P, m: 1 } } } });
const P = P;`,
            ['m-1'],
        );
    });

    it('a const-doubling DAG stays linear (exponential-walk guard)', { timeout: 30_000 }, () => {
        // Each shape re-resolves the SAME const from two positions per level —
        // through a conditional, a double spread, and sibling keys. Without
        // the initializer memo + paid alternate exploration, the walk ran 2^n
        // recursive calls (measured: ~10s at n=22, unfinishable at n=40) from
        // a ~40-line file. n=40 completing at all is the regression signal; a
        // wall-clock assertion would be flaky on CI — including vitest's
        // implicit 5s default, which a slow shared runner has breached
        // (~5.2s) on code that passes in ~0.2s locally. The explicit 30s
        // budget keeps the guard meaningful: an exponential walk at n=40
        // never finishes, so it still fails, while runner variance cannot.
        const lines = ['declare const c: boolean;', "const x0 = c ? 'red-500' : 'blue-500';"];
        for (let i = 1; i <= 40; i++) {
            lines.push(`const x${i} = c ? x${i - 1} : x${i - 1};`);
        }
        lines.push('const y0 = { p: 4 };');
        for (let i = 1; i <= 40; i++) {
            lines.push(`const y${i} = { ...y${i - 1}, ...y${i - 1} };`);
        }
        lines.push('const z0 = { m: 2 };');
        for (let i = 1; i <= 40; i++) {
            lines.push(`const z${i} = { hover: z${i - 1}, focus: z${i - 1} };`);
        }
        lines.push('const s = szv({ variants: { tone: { a: { color: x40 }, b: y40, c: z40 } } });');
        // Both branch colors of the leaf const survive (scalar hops don't
        // consume depth); the y/z object chains exceed MAX_CATALOG_DEPTH and
        // bottom out empty — they are here to prove the walk TERMINATES, and
        // the parity assertion proves all engines cap identically.
        const source = `${IMPORT}\n${lines.join('\n')}`;
        const oxc = [...transformOxc(source, 'catalog.tsx').classes];
        const babel = [...transformSourceCode(source, 'catalog.tsx').classes];
        for (const classes of [oxc, babel]) {
            expect(classes).toContain('text-red-500');
            expect(classes).toContain('text-blue-500');
        }
        expect([...oxc].sort()).toEqual([...babel].sort());
        try {
            const rust = [...transformRust(source, 'catalog.tsx').classes];
            expect(rust).toContain('text-red-500');
            expect(rust).toContain('text-blue-500');
            expect([...rust].sort()).toEqual([...oxc].sort());
        } catch (err) {
            expect(err).toBeInstanceOf(OxcRustNotImplementedError);
        }
    });
});

describe('szv catalog + a coexisting static sz attribute (fast-path parity)', () => {
    // Regression: a file with a plain static `sz={{ … }}` AND an szv catalog
    // used to fast-path in the native engine — the AST-free path handled the
    // `sz=` attribute and silently DROPPED the whole szv catalog, so `rust`
    // safelisted fewer classes than `oxc`/`babel` for identical source (a
    // `build.parser` flip changed the produced CSS). Every case here pairs an
    // szv catalog with a static `sz={{ p: 4 }}` so the static-sz path is live,
    // and asserts all three engines agree.
    const STATIC = 'export const App = () => <div sz={{ p: 4 }} />;';

    it('the reported mx-0 multi-key variant survives on every engine', () => {
        expectCatalogParity(
            `${IMPORT}
const controlSz = szv({ variants: { layout: { x: { grow: 1, mx: 0, my: 4 } } } });
${STATIC}`,
            ['p-4', 'grow-1', 'mx-0', 'my-4'],
        );
    });

    // Directional spacing shorthands are where a per-key lowering bug would
    // hide (`mx` mis-lowering to `ml`, logical `ms`/`me` vs physical, etc.).
    // Each token sits in an szv variant next to the static sz; all engines must
    // agree on the emitted class.
    it.each([
        ['mx: 0', 'mx-0'],
        ['my: 0', 'my-0'],
        ['ml: 0', 'ml-0'],
        ['mr: 0', 'mr-0'],
        ['mt: 0', 'mt-0'],
        ['mb: 0', 'mb-0'],
        ['ms: 0', 'ms-0'],
        ['me: 0', 'me-0'],
        ['m: 0', 'm-0'],
        ['px: 0', 'px-0'],
        ['py: 0', 'py-0'],
        ['pl: 0', 'pl-0'],
        ['pr: 0', 'pr-0'],
        ['ps: 0', 'ps-0'],
        ['pe: 0', 'pe-0'],
        ['pt: 0', 'pt-0'],
        ['pb: 0', 'pb-0'],
        ['p: 0', 'p-0'],
        ['px: 2', 'px-2'],
        ['py: 2', 'py-2'],
        ['pl: 2', 'pl-2'],
        ['pr: 2', 'pr-2'],
        ['ps: 2', 'ps-2'],
        ['pe: 2', 'pe-2'],
        ['p: 2', 'p-2'],
        ['grow: 1', 'grow-1'],
        ['w: 4', 'w-4'],
        ['h: 4', 'h-4'],
        ['gap: 2', 'gap-2'],
        ["bg: 'red-500'", 'bg-red-500'],
        ["color: 'red-500'", 'text-red-500'],
        ["rounded: 'lg'", 'rounded-lg'],
        ['inset: 0', 'inset-0'],
    ])(
        'szv variant key `%s` safelists `%s` on every engine (with static sz present)',
        (leaf, cls) => {
            expectCatalogParity(
                `${IMPORT}
const s = szv({ variants: { layout: { x: { ${leaf} } } } });
${STATIC}`,
                ['p-4', cls],
            );
        },
    );

    it('a full multi-key variant keeps every side next to the static sz', () => {
        expectCatalogParity(
            `${IMPORT}
const s = szv({ variants: { layout: {
    panelSelect: { grow: 1, mx: 0, my: 4 },
    panel: { grow: 1, m: 4 },
} } });
${STATIC}`,
            ['p-4', 'grow-1', 'mx-0', 'my-4', 'm-4'],
        );
    });

    it('szr static args also survive next to a static sz (same fast-path bail)', () => {
        expectCatalogParity(
            `import { szr } from '@csszyx/runtime';
const c = szr({ mx: 0, my: 4 });
export const App = () => <div sz={{ p: 4 }}>{c}</div>;`,
            ['p-4', 'mx-0', 'my-4'],
        );
    });
});
