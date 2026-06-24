import { describe, expect, it } from 'vitest';
import { transformOxc, transformSourceCode } from '../src/index.js';

// szv catalog extraction lives in three engines (Babel `transformSourceCode`,
// oxc `transformOxc`, Rust — covered by its own cargo tests). These lock the
// build-time safelist behaviour for the two JS engines AND assert they agree, so
// a regression in one surfaces here instead of as silent dead classes in a
// consumer. The matrix is deliberately wide: it was a wide pass that found the
// `compoundVariants`/non-static-sibling gap and a Babel↔oxc divergence.

const IMPORT = "import { szv } from 'csszyx';";
const sorted = (classes: Set<string>) => [...classes].sort();
const babel = (src: string) => sorted(transformSourceCode(`${IMPORT} ${src}`).classes);
const oxc = (src: string) => sorted(transformOxc(`${IMPORT} ${src}`).classes);

describe('szv extraction — Babel engine', () => {
    it('extracts base + every variant value (no usage required)', () => {
        expect(
            babel(
                "const b = szv({ base: { rounded: 'md' }, variants: { tone: { ok: { bg: 'success' }, warn: { bg: 'warning' } } } });",
            ),
        ).toEqual(['bg-success', 'bg-warning', 'rounded-md']);
    });

    it('extracts variants-only configs', () => {
        expect(
            babel('const b = szv({ variants: { size: { sm: { px: 2 }, lg: { px: 4 } } } });'),
        ).toEqual(['px-2', 'px-4']);
    });

    it('keeps base + variant classes when a non-static sibling key is present (the gap)', () => {
        // A `compoundVariants` array used to null the WHOLE config and drop every
        // class. base + variants must still extract; the array is ignored.
        expect(
            babel(
                "const b = szv({ base: { rounded: 'md' }, variants: { v: { a: { bg: 'red-500' } } }, compoundVariants: [{ v: 'a', sz: { p: 4 } }] });",
            ),
        ).toEqual(['bg-red-500', 'rounded-md']);
    });

    it('ignores defaultVariants without dropping the catalog', () => {
        expect(
            babel(
                "const b = szv({ variants: { s: { x: { m: 4 } } }, defaultVariants: { s: 'x' } });",
            ),
        ).toEqual(['m-4']);
    });

    it('extracts nested responsive / state variant classes', () => {
        expect(
            babel(
                "const b = szv({ variants: { c: { blue: { bg: 'blue-50', hover: { bg: 'blue-100' }, md: { p: 8 } } } } });",
            ),
        ).toEqual(['bg-blue-50', 'hover:bg-blue-100', 'md:p-8']);
    });

    it('resolves a const-bound config or inner base/variants (Option C)', () => {
        // A same-scope `const` identifier bound to an object literal is followed —
        // for the whole config and for an inner base/variants value.
        expect(
            babel('const cfg = { variants: { s: { x: { p: 2 } } } }; const b = szv(cfg);'),
        ).toEqual(['p-2']);
        expect(babel('const V = { s: { x: { p: 2 } } }; const b = szv({ variants: V });')).toEqual([
            'p-2',
        ]);
    });

    it('does NOT follow a reassigned `let` binding (unsound)', () => {
        const src =
            'let cfg = { variants: { s: { x: { p: 2 } } } }; cfg = { variants: {} }; const b = szv(cfg);';
        expect(babel(src)).toEqual([]);
    });
});

describe('szv extraction — oxc engine', () => {
    it('extracts base + variants like Babel', () => {
        expect(
            oxc(
                "const b = szv({ base: { rounded: 'md' }, variants: { tone: { ok: { bg: 'success' } } } });",
            ),
        ).toEqual(['bg-success', 'rounded-md']);
    });

    it('keeps the catalog when a non-static sibling key is present', () => {
        expect(
            oxc(
                "const b = szv({ variants: { v: { a: { bg: 'red-500' } } }, compoundVariants: [{ v: 'a', sz: { p: 4 } }] });",
            ),
        ).toEqual(['bg-red-500']);
    });

    it('extracts an `export default szv(...)` call (visited at any position)', () => {
        expect(oxc('export default szv({ variants: { s: { x: { gap: 8 } } } });')).toEqual([
            'gap-8',
        ]);
    });
});

describe('szv extraction — Babel/oxc parity', () => {
    const CASES: Array<[string, string]> = [
        [
            'base + variants + defaultVariants',
            "const b = szv({ base: { p: 2 }, variants: { s: { x: { m: 4 } } }, defaultVariants: { s: 'x' } });",
        ],
        [
            'compoundVariants (non-static sibling)',
            "const b = szv({ base: { rounded: 'md' }, variants: { v: { a: { bg: 'red-500' } } }, compoundVariants: [{ v: 'a', sz: { p: 4 } }] });",
        ],
        [
            'variants only',
            'const b = szv({ variants: { size: { sm: { px: 2 }, lg: { px: 4 } } } });',
        ],
        [
            'object color value with opacity',
            "const b = szv({ variants: { s: { x: { bg: { color: 'warning', op: 10 } } } } });",
        ],
        [
            'const-bound whole config (both resolve)',
            'const cfg = { base: { rounded: "md" }, variants: { s: { x: { p: 2 } } } }; const b = szv(cfg);',
        ],
        [
            'const-bound inner variants (both resolve)',
            'const V = { s: { x: { p: 2 } } }; const b = szv({ base: { m: 2 }, variants: V });',
        ],
        [
            'const-bound inner base (both resolve)',
            'const B = { p: 4 }; const b = szv({ base: B, variants: { s: { x: { m: 2 } } } });',
        ],
        [
            'reassigned let (both skip — unsound to follow)',
            'let cfg = { variants: { s: { x: { p: 2 } } } }; cfg = { variants: {} }; const b = szv(cfg);',
        ],
        [
            'value from const (both skip — primitive folding out of scope)',
            'const T = "red-500"; const b = szv({ variants: { s: { x: { bg: T } } } });',
        ],
    ];

    it.each(CASES)('Babel and oxc agree: %s', (_label, src) => {
        expect(babel(src)).toEqual(oxc(src));
    });
});

describe('szv extraction — "dị" value cases lower to the right TW class', () => {
    // szv now lowers variant props / important / negative / arbitrary / css-var
    // VALUES inside the catalog directly. Lock the exact emitted classes (Babel)
    // and assert oxc agrees, so the catalog matches what `sz={fn(...)}` renders.
    const C: Array<[string, string, string[]]> = [
        [
            'state variant inside a variant value',
            "const b = szv({ variants: { s: { x: { hover: { bg: 'red-500' } } } } });",
            ['hover:bg-red-500'],
        ],
        [
            'responsive variant inside a variant value',
            'const b = szv({ variants: { s: { x: { md: { p: 8 } } } } });',
            ['md:p-8'],
        ],
        [
            'group-hover nested variant',
            'const b = szv({ variants: { s: { x: { group: { hover: { gap: 8 } } } } } });',
            ['group-hover:gap-8'],
        ],
        [
            'arbitrary data variant with inner =',
            "const b = szv({ variants: { s: { x: { data: { 'state=open': { gap: 8 } } } } } });",
            ['data-[state=open]:gap-8'],
        ],
        [
            'trailing-important value',
            "const b = szv({ variants: { s: { x: { p: '8!' } } } });",
            ['p-8!'],
        ],
        ['negative value', 'const b = szv({ variants: { s: { x: { mt: -2 } } } });', ['-mt-2']],
        [
            'arbitrary bracket value',
            "const b = szv({ variants: { s: { x: { w: '[400px]' } } } });",
            ['w-[400px]'],
        ],
        [
            'color + opacity object value',
            "const b = szv({ variants: { s: { x: { bg: { color: 'warning', op: 10 } } } } });",
            ['bg-warning/10'],
        ],
        [
            'numeric variant keys',
            'const b = szv({ variants: { idx: { 0: { opacity: 50 }, 1: { opacity: 70 } } } });',
            ['opacity-50', 'opacity-70'],
        ],
        [
            'css-variable value',
            "const b = szv({ variants: { s: { x: { color: '--ds-primary' } } } });",
            ['text-(--ds-primary)'],
        ],
    ];

    it.each(C)('Babel emits the expected class(es): %s', (_label, src, expected) => {
        expect(babel(src)).toEqual([...expected].sort());
    });

    it.each(C)('oxc agrees with Babel: %s', (_label, src) => {
        expect(oxc(src)).toEqual(babel(src));
    });
});
