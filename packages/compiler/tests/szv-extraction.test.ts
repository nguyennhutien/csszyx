import { describe, expect, it } from 'vitest';
import { transformSource, transformWasm } from '../src/index.js';

// szv catalog extraction lives in three engines (Babel `transformSource`,
// the wasm build via `transformWasm`, Rust — covered by its own cargo tests). These lock the
// build-time safelist behaviour for the two JS engines AND assert they agree, so
// a regression in one surfaces here instead of as silent dead classes in a
// consumer. The matrix is deliberately wide: it was a wide pass that found the
// `compoundVariants`/non-static-sibling gap and a Babel↔oxc divergence.

const IMPORT = "import { szv } from 'csszyx';";
const sorted = (classes: Set<string>) => [...classes].sort();
const babel = (src: string) => sorted(transformSource(`${IMPORT} ${src}`).classes);
const oxc = (src: string) => sorted(transformWasm(`${IMPORT} ${src}`).classes);

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

describe('szv extraction — transformed flag must not gate class collection', () => {
    // A szv-only file (no `sz=` to rewrite) extracts a catalog of classes but the
    // oxc/Rust engines report `transformed: false` (no source edit happened),
    // while Babel reports true. The unplugin prescan must collect the classes
    // regardless of the flag — gating on `transformed` alone silently drops every
    // szv class from the safelist on the oxc/Rust path (the real "szv standalone /
    // arbitrary value does not work" bug). This locks the invariant the fix needs.
    const szvOnly = `${IMPORT} const b = szv({ variants: { s: { x: { p: 4 } } } });`;

    it('oxc reports transformed=false but still extracts the catalog', () => {
        const r = transformWasm(szvOnly);
        expect(r.transformed).toBe(false);
        expect(r.classes.size).toBeGreaterThan(0);
    });

    it('the engine collects classes from an szv-only file regardless of the flag', () => {
        // The Babel lane rewrote the szv table in place and reported
        // transformed=true; the engine leaves an szv-only file's code alone
        // (transformed=false) — the CONTRACT this suite exists for is that
        // class collection is not gated on either answer.
        const r = transformSource(szvOnly);
        expect(r.transformed).toBe(false);
        expect(r.code).toBe(szvOnly);
        expect(r.classes.size).toBeGreaterThan(0);
    });
});

describe('szv extraction — TypeScript wrappers are looked through', () => {
    // `satisfies Record<Token, object>` is the natural way to keep a large
    // variant table complete against a union type; it (and `as`) used to
    // silently disable extraction (vui 0.10.10 field report item 3). The
    // wrappers are type-level only, so every engine unwraps them at every
    // position: the whole config, a variants/group value, and a leaf object.
    const wrapped: Array<[string, string]> = [
        [
            'satisfies on a variant group value',
            'import {szv} from "@csszyx/runtime"; export const t = szv({ variants: { c: { blue: { bg: "tag-blue" }, red: { bg: "tag-red" } } satisfies Record<string, object> } });',
        ],
        [
            'as on a variant group value',
            'import {szv} from "@csszyx/runtime"; export const t = szv({ variants: { c: { blue: { bg: "tag-blue" }, red: { bg: "tag-red" } } as Record<string, object> } });',
        ],
        [
            'satisfies on the whole config',
            'import {szv} from "@csszyx/runtime"; export const t = szv({ variants: { c: { blue: { bg: "tag-blue" }, red: { bg: "tag-red" } } } } satisfies object);',
        ],
        [
            'as on a leaf variant object',
            'import {szv} from "@csszyx/runtime"; export const t = szv({ variants: { c: { blue: ({ bg: "tag-blue" }) as object, red: { bg: "tag-red" } } } });',
        ],
        [
            'satisfies on a const-bound config',
            'import {szv} from "@csszyx/runtime"; const cfg = { variants: { c: { blue: { bg: "tag-blue" }, red: { bg: "tag-red" } } } } satisfies object; export const t = szv(cfg);',
        ],
    ];

    for (const [name, source] of wrapped) {
        it(`extracts through ${name} (both JS engines agree)`, () => {
            const babel = [...transformSource(source, 'F.tsx').classes].sort();
            const oxc = [...transformWasm(source, 'F.tsx').classes].sort();
            expect(babel, 'babel extracts the catalog').toContain('bg-tag-blue');
            expect(oxc, 'oxc extracts the catalog').toEqual(babel);
        });
    }
});

describe('szr literal-arg extraction', () => {
    // A bare static `szr({...})` type-checks and resolves correctly at runtime,
    // but contributed nothing to the safelist — a silently dead class under
    // Tailwind `source(none)` (vui 0.10.10 field report item 4). Literal args
    // (and const-bound / TS-wrapped ones) now extract exactly like dynamic().
    const shapes: Array<[string, string, string[]]> = [
        [
            'bare literal',
            'import {szr} from "@csszyx/runtime"; export const c = szr({ tracking: "widest" });',
            ['tracking-widest'],
        ],
        [
            'const-bound object',
            'import {szr} from "@csszyx/runtime"; const obj = { leading: "loose" }; export const c = szr(obj);',
            ['leading-loose'],
        ],
        [
            'satisfies-wrapped literal',
            'import {szr} from "@csszyx/runtime"; export const c = szr({ indent: 8 } satisfies object);',
            ['indent-8'],
        ],
    ];

    for (const [name, source, expected] of shapes) {
        it(`extracts a ${name} (both JS engines agree)`, () => {
            const babel = [...transformSource(source, 'F.tsx').classes].sort();
            const oxc = [...transformWasm(source, 'F.tsx').classes].sort();
            expect(babel).toEqual(expected);
            expect(oxc).toEqual(expected);
        });
    }

    it('a runtime-dependent szr arg extracts nothing (no false candidates)', () => {
        const source =
            'import {szr} from "@csszyx/runtime"; export const f = (x) => szr({ p: x });';
        expect([...transformSource(source, 'F.tsx').classes]).toEqual([]);
        expect([...transformWasm(source, 'F.tsx').classes]).toEqual([]);
    });
});
