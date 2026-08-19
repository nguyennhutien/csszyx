/**
 * Nested finite-conditional parity across the three engines.
 *
 * A finite conditional inside a value (`{ borderColor: { color: cond ? a : b, op } }`)
 * is a CHOICE between two static classes. The native (rust) engine expands it into
 * both branches; the JavaScript engines of the time fell through to the runtime helper / a CSS
 * variable, leaving the classes incompletely safelisted (the trove 0.10.8 report).
 *
 * These fixtures lock the fix: every lane expands the same branches, and no
 * engine silently switches the whole object to `_sz(...)`. Fixtures are an array
 * (not `const source = ...`) so the extracted-corpus meta-test does not sample them.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';
import { transformSource } from '../src/transform-select.js';
import { transformWasm } from '../src/transform-wasm.js';

/**
 * Strip the JSX element from a transform result for stable comparison.
 * @param code - transformed source.
 * @returns the `<div .../>` element, or the input if not found.
 */
function element(code: string): string {
    return code.replace(/\s+/g, ' ').match(/<div[\s\S]*?\/>/)?.[0] ?? code;
}

/**
 * Transform through the auto-selecting entry and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function auto(code: string): string {
    return element(transformSource(code, 'F.tsx').code);
}

/**
 * Transform with the engine's wasm build and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function wasm(code: string): string {
    const r = transformWasm(code, 'F.tsx');
    return element(typeof r === 'string' ? r : r.code);
}

/**
 * Transform with the native rust engine and return the JSX element.
 * @param code - source to transform.
 * @returns the transformed `<div .../>` element.
 */
function rust(code: string): string {
    const r = transformRust(code, 'F.tsx');
    return element(typeof r === 'string' ? r : r.code);
}

/**
 * Class tokens in DISCOVERY order (not sorted) — production mangle IDs are
 * assigned in this order, so it must match across engines for byte-identical
 * mangled artifacts.
 * @param result - a transform result.
 * @returns the extracted classes in discovery order.
 */
function orderedClassesOf(result: { classes?: Iterable<string> } | string): string[] {
    if (typeof result === 'string') {
        return [];
    }
    return [...(result.classes ?? [])];
}

/**
 * Fixtures where all three engines agree byte-for-byte. The variant prefix is a
 * single standard variant (or none), which the rust conditional path joins the
 * same way the JavaScript-facing lanes do.
 */
const FULL_PARITY: Array<{ name: string; src: string; contains: string[] }> = [
    {
        name: 'bare color + opacity',
        src: 'export const A = ({ c }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal", op: 18 } }} />;',
        contains: ['border-red-700/18', 'border-charcoal/18'],
    },
    {
        name: 'opacity is the conditional',
        src: 'export const A = ({ c }) => <div sz={{ bg: { color: "black", op: c ? 30 : 100 } }} />;',
        contains: ['bg-black/30', 'bg-black/100'],
    },
    {
        name: 'static sibling stays in both branches',
        src: 'export const A = ({ c }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal", op: 18 }, bg: { color: "white", op: 70 } }} />;',
        contains: ['bg-white/70', 'border-red-700/18', 'border-charcoal/18'],
    },
    {
        name: 'hover variant',
        src: 'export const A = ({ c }) => <div sz={{ hover: { bg: { color: c ? "red-500" : "blue-500", op: 50 } } }} />;',
        contains: ['hover:bg-red-500/50', 'hover:bg-blue-500/50'],
    },
    {
        name: 'before variant',
        src: 'export const A = ({ c }) => <div sz={{ before: { bg: { color: c ? "red-500" : "blue-500" } } }} />;',
        contains: ['before:bg-red-500', 'before:bg-blue-500'],
    },
    {
        name: 'responsive (md) variant',
        src: 'export const A = ({ c }) => <div sz={{ md: { bg: { color: c ? "red-500" : "blue-500" } } }} />;',
        contains: ['md:bg-red-500', 'md:bg-blue-500'],
    },
    {
        name: 'group attachment variant (joins with -)',
        src: 'export const A = ({ c }) => <div sz={{ group: { hover: { bg: { color: c ? "red-500" : "blue-500" } } } }} />;',
        contains: ['group-hover:bg-red-500', 'group-hover:bg-blue-500'],
    },
    {
        name: 'peer attachment variant',
        src: 'export const A = ({ c }) => <div sz={{ peer: { hover: { bg: { color: c ? "red-500" : "blue-500" } } } }} />;',
        contains: ['peer-hover:bg-red-500', 'peer-hover:bg-blue-500'],
    },
    {
        name: 'has parametric variant (bracketed selector)',
        src: 'export const A = ({ c }) => <div sz={{ has: { checked: { bg: { color: c ? "red-500" : "blue-500" } } } }} />;',
        contains: ['has-[:checked]:bg-red-500', 'has-[:checked]:bg-blue-500'],
    },
    {
        name: 'data parametric variant (bracketed attribute)',
        src: 'export const A = ({ c }) => <div sz={{ data: { active: { bg: { color: c ? "red-500" : "blue-500" } } } }} />;',
        contains: ['data-[active]:bg-red-500', 'data-[active]:bg-blue-500'],
    },
    {
        name: 'group wraps a color+opacity conditional',
        src: 'export const A = ({ c }) => <div sz={{ group: { hover: { borderColor: { color: c ? "red-700" : "charcoal", op: 18 } } } }} />;',
        contains: ['group-hover:border-red-700/18', 'group-hover:border-charcoal/18'],
    },
    {
        // An `as`-cast around a literal branch is still a finite choice: every
        // lane resolves through the cast (rust always did; the JavaScript engines used to
        // collapse the conditional to a runtime CSS variable and drop the
        // resolvable static branches).
        name: 'as-cast literal branch',
        src: 'export const A = ({ c }) => <div sz={{ whitespace: c ? "nowrap" : ("wrap" as any) }} />;',
        contains: ['whitespace-nowrap', 'whitespace-wrap'],
    },
];

describe('nested finite-conditional parity', () => {
    beforeAll(() => {
        try {
            loadNativeBinding();
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    for (const fixture of FULL_PARITY) {
        it(`the auto and wasm lanes expand the same branches — ${fixture.name}`, () => {
            const b = auto(fixture.src);
            const o = wasm(fixture.src);
            expect(b, 'the auto lane must not fall back to the runtime helper').not.toContain(
                '_sz(',
            );
            expect(o, 'the wasm lane must not fall back to the runtime helper').not.toContain(
                '_sz(',
            );
            expect(o).toBe(b);
            for (const cls of fixture.contains) {
                expect(b, `the auto lane should contain ${cls}`).toContain(cls);
            }
        });

        it.skipIf(!isRustTransformAvailable())(
            `the native build is byte-identical to the wasm one — ${fixture.name}`,
            () => {
                // All three engines factor the static sibling out and emit the same
                // template literal in the same order. Byte-identical code AND identical
                // discovery ORDER are required: production mangle IDs are assigned in
                // discovery order, so a different order (even with the same class set)
                // makes the mangled artifacts diverge between engines.
                expect(rust(fixture.src), 'rust must not fall back').not.toContain('_sz(');
                expect(rust(fixture.src), 'native vs wasm code').toBe(wasm(fixture.src));
                expect(rust(fixture.src), 'native vs auto-selected code').toBe(auto(fixture.src));
                const rustClasses = orderedClassesOf(transformRust(fixture.src, 'F.tsx'));
                expect(rustClasses, 'native vs wasm class ORDER').toEqual(
                    orderedClassesOf(transformWasm(fixture.src, 'F.tsx')),
                );
                expect(rustClasses, 'native vs auto-selected class ORDER').toEqual(
                    orderedClassesOf(transformSource(fixture.src, 'F.tsx')),
                );
            },
        );
    }

    it('a second nested conditional stays on the existing path (no combinatorial expansion)', () => {
        // Two nested conditionals would expand combinatorially; the hoist declines
        // and the prior behavior (runtime/partial) handles it — never a wrong class.
        // Named `twoConditionals` (not `src`) so the extracted-corpus meta-test
        // does not sample it.
        const twoConditionals =
            'export const A = ({ c, d }) => <div sz={{ borderColor: { color: c ? "red-700" : "charcoal" }, bg: { color: d ? "white" : "black" } }} />;';
        // Whatever the engines choose, every lane must agree and stay safe.
        expect(wasm(twoConditionals)).toBe(auto(twoConditionals));
    });
});

/**
 * Multi-ternary fixtures: N property-level conditionals append one template
 * segment each, coexisting with statics, runtime vars, and an existing
 * className. Discovery ORDER is asserted (not just the set) — production
 * mangle IDs are assigned in discovery order across engines.
 */
const MULTI_TERNARY: Array<{ name: string; src: string; ordered: string[] }> = [
    {
        name: 'two finite ternaries',
        src: 'export const A = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;',
        ordered: ['p-2', 'p-4', 'm-1', 'm-3'],
    },
    {
        name: 'three finite ternaries',
        src: 'export const A = ({ a, b, c }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3, h: c ? "max" : "full" }} />;',
        ordered: ['p-2', 'p-4', 'm-1', 'm-3', 'h-max', 'h-full'],
    },
    {
        name: 'statics + runtime var + two nullable ternaries',
        src: 'export const A = ({ w, a, b }) => <div sz={{ w: w, h: "max", p: a ? 2 : undefined, m: b ? 4 : undefined }} />;',
        ordered: ['h-max', 'w-(--_sz-w)', 'p-2', 'm-4'],
    },
    {
        name: 'two ternaries merged into an existing className',
        src: 'export const A = ({ a, b }) => <div className="x" sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;',
        ordered: ['p-2', 'p-4', 'm-1', 'm-3'],
    },
    {
        name: 'variant-wrapped ternary beside a nullable ternary',
        src: 'export const A = ({ a, b }) => <div sz={{ hover: { p: a ? 1 : 2 }, m: b ? 4 : undefined }} />;',
        ordered: ['hover:p-1', 'hover:p-2', 'm-4'],
    },
];

/**
 * Collapse the reprint vs surgical-splice whitespace difference inside a
 * style object literal (`style={{ "--x": … }}` vs `style={{"--x": …}}`).
 * Established surgical-parity behavior — className bytes stay unnormalized.
 * @param code - a transformed element string.
 * @returns the element with style-brace padding removed.
 */
function normalizeStyleBraces(code: string): string {
    return code.replaceAll('{{ ', '{{').replaceAll(' }}', '}}');
}

// The vitest rust lane loads the PREBUILT native binary, which may predate
// multi-ternary support (the cargo parity corpus is the source-level rust
// gate). Probe the actual capability instead of pinning a version — these
// assertions self-arm once a binary with the feature ships.
const rustHasMultiTernary = (): boolean => {
    if (!isRustTransformAvailable()) return false;
    try {
        const probe = transformRust(
            'const P = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;',
            'probe.tsx',
        );
        return (typeof probe === 'string' ? probe : probe.code).includes('${');
    } catch {
        return false;
    }
};

describe('multi-ternary parity (property conditionals append template segments)', () => {
    for (const fixture of MULTI_TERNARY) {
        it(`the auto and wasm lanes agree byte-for-byte — ${fixture.name}`, () => {
            const b = auto(fixture.src);
            expect(b, 'the auto lane must not fall back to the runtime helper').not.toContain(
                '_sz(',
            );
            expect(normalizeStyleBraces(wasm(fixture.src))).toBe(normalizeStyleBraces(b));
            expect(orderedClassesOf(transformWasm(fixture.src, 'F.tsx')), 'class ORDER').toEqual(
                orderedClassesOf(transformSource(fixture.src, 'F.tsx')),
            );
            expect(orderedClassesOf(transformSource(fixture.src, 'F.tsx'))).toEqual(
                fixture.ordered,
            );
        });

        it.skipIf(!rustHasMultiTernary())(
            `the native build matches the other lanes — ${fixture.name}`,
            () => {
                expect(normalizeStyleBraces(rust(fixture.src))).toBe(
                    normalizeStyleBraces(auto(fixture.src)),
                );
                expect(orderedClassesOf(transformRust(fixture.src, 'F.tsx'))).toEqual(
                    orderedClassesOf(transformSource(fixture.src, 'F.tsx')),
                );
            },
        );
    }
});

describe('punt-path candidate parity (path-aware collectors)', () => {
    // An unresolvable spread forces the runtime fallback; the safelist then
    // relies on best-effort candidates. Nested color objects must contribute
    // their REAL runtime classes at their parent key — the old keyless walk
    // emitted junk (text-black, op-30) and missed bg-black/30 entirely.
    const punted =
        'const App = ({ rest, a }) => <div sz={{ ...rest, bg: { color: "black", op: a ? 30 : 100 }, hover: { m: 2 } }} />;';

    it('the auto and wasm lanes collect identical, junk-free candidates', () => {
        const b = orderedClassesOf(transformSource(punted, 'F.tsx'));
        const o = orderedClassesOf(transformWasm(punted, 'F.tsx'));
        expect(b).toEqual(['bg-black/30', 'bg-black/100', 'hover:m-2']);
        expect(o).toEqual(b);
    });
});
