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
});
