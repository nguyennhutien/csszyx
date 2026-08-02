/**
 * The sz runtime-fallback matrix, and the parity it exists to guarantee.
 *
 * A build can switch engines with `build.parser`. If the wording differs
 * between them, the same source produces different build logs depending on a
 * setting that is supposed to be a pure implementation detail — so these tests
 * pin both the rendering rules and the fact that the two TypeScript lanes agree
 * character for character.
 */
import { describe, expect, it } from 'vitest';
import {
    describeSzFallback,
    formatSzFallbackDiagnostic,
    SZ_FALLBACK_DETAIL_PLACEHOLDER,
    SZ_FALLBACK_KINDS,
    SZ_FALLBACK_MATRIX,
    SZ_FALLBACK_UNKNOWN_CALLEE,
    type SzFallbackKind,
    szFallbackConsequenceOf,
    szsUnsupportedDiagnostic,
} from '../src/sz-fallback-matrix.js';
import { transformSourceCode } from '../src/transform.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

/** Sources that drive each classification arm through a real transform. */
const FALLBACK_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['call', 'export const A = () => <div sz={makeSz()} />;'],
    ['call via member callee', 'export const A = () => <div sz={theme.build()} />;'],
    ['call via computed member callee', 'export const A = () => <div sz={table[key]()} />;'],
    ['call without a readable name', 'export const A = ({ c }) => <div sz={(c ? f : g)()} />;'],
    ['identifier', 'export const A = ({ v }) => <div sz={v} />;'],
    ['member', 'export const A = () => <div sz={cfg.card} />;'],
    // Babel's AST has no parenthesized nodes; the oxc lane unwraps them to
    // match. Diverged before that fix: other/ParenthesizedExpression at 1:33
    // versus member at 1:34.
    ['member behind parentheses', 'export const A = () => <div sz={(cfg.card)} />;'],
    [
        'member + TS as (classified as other)',
        'export const A = () => <div sz={cfg.card as object} />;',
    ],
    ['other (conditional)', 'export const A = ({ c }) => <div sz={c ? p : q} />;'],
    ['other (await)', 'export const A = async ({ p }) => <div sz={await p} />;'],
    ['other (template)', 'export const A = ({ v }) => <div sz={`${v}`} />;'],
];

describe('describeSzFallback', () => {
    it('substitutes the detail into every reason that asks for one', () => {
        expect(describeSzFallback('call', 'makeSz').reason).toBe(
            'function call `makeSz()` result is unknown at build time',
        );
        expect(describeSzFallback('identifier', 'cardSz').reason).toBe(
            'identifier `cardSz` could not be resolved to a static value',
        );
        expect(describeSzFallback('other', 'ConditionalExpression').reason).toBe(
            'expression of type `ConditionalExpression` is not statically analyzable',
        );
    });

    it('ignores the detail for a reason that carries no placeholder', () => {
        expect(describeSzFallback('member', 'ignored').reason).toBe(
            'member expression is not statically resolvable',
        );
    });

    it('never leaks the placeholder, for any kind', () => {
        for (const kind of SZ_FALLBACK_KINDS) {
            const { reason, suggestion } = describeSzFallback(kind, 'x');
            expect(reason).not.toContain(SZ_FALLBACK_DETAIL_PLACEHOLDER);
            expect(suggestion).not.toContain(SZ_FALLBACK_DETAIL_PLACEHOLDER);
        }
    });

    it('leaves an empty detail rather than inventing one', () => {
        // The caller decides what to print when a name is unreadable; the
        // matrix must not silently substitute a fallback of its own.
        expect(describeSzFallback('call').reason).toBe(
            'function call `()` result is unknown at build time',
        );
    });

    it('points every kind at a concrete next step', () => {
        for (const kind of SZ_FALLBACK_KINDS) {
            const { suggestion } = describeSzFallback(kind);
            // A diagnostic the reader cannot act on is noise; every arm names
            // at least one of the two supported escape hatches.
            expect(suggestion).toMatch(/szv\(\)|dynamic\(\)/);
        }
    });

    it('covers exactly the kinds the matrix declares', () => {
        expect([...SZ_FALLBACK_KINDS].sort()).toEqual(Object.keys(SZ_FALLBACK_MATRIX).sort());
    });

    it('rejects nothing at the type level that the matrix accepts', () => {
        // Guards against a kind being added to the union but not the table.
        for (const kind of SZ_FALLBACK_KINDS) {
            expect(SZ_FALLBACK_MATRIX[kind as SzFallbackKind]).toBeDefined();
        }
    });
});

describe('szFallbackConsequenceOf', () => {
    it('classifies every rendered site through the renderer itself', () => {
        // Built FROM the renderer on purpose: a wording change flows through
        // both sides of the assertion, so the classifier cannot strand the
        // routing the way an inlined substring match in the bundler did.
        expect(szFallbackConsequenceOf(formatSzFallbackDiagnostic('szr', '1:1', 'call', 'f'))).toBe(
            'missing-css',
        );
        expect(szFallbackConsequenceOf(formatSzFallbackDiagnostic('szv', '1:1', 'call', 'f'))).toBe(
            'missing-css',
        );
        expect(szFallbackConsequenceOf(formatSzFallbackDiagnostic('sz', '1:1', 'member'))).toBe(
            'nudge',
        );
        expect(szFallbackConsequenceOf(szsUnsupportedDiagnostic('/p/t.tsx'))).toBe('missing-css');
    });

    it('leaves messages outside the matrix unclassified', () => {
        expect(szFallbackConsequenceOf('[csszyx] Unknown property "x" in sz prop.')).toBe(
            undefined,
        );
        expect(szFallbackConsequenceOf('unresolvable sz spread at 1:1')).toBe(undefined);
    });
});

describe('engine parity for sz fallback diagnostics', () => {
    for (const [label, source] of FALLBACK_SOURCES) {
        it(`babel and oxc agree on ${label}`, () => {
            const babel = transformSourceCode(source, '/p/t.tsx').diagnostics ?? [];
            const oxc = transformOxc(source, '/p/t.tsx').diagnostics ?? [];

            // Both lanes must report the same thing, in the same words: this is
            // the whole reason the matrix is shared rather than copied.
            expect(oxc).toEqual(babel);
            expect(babel.length).toBeGreaterThan(0);
        });
    }

    it('names the callee when the call has a readable name', () => {
        const diagnostics = transformSourceCode(
            'export const A = () => <div sz={makeSz()} />;',
            '/p/t.tsx',
        ).diagnostics;
        expect(diagnostics?.[0]).toContain('function call `makeSz()`');
    });

    it('falls back to the stand-in name for an unreadable callee', () => {
        const diagnostics = transformSourceCode(
            'export const A = ({ c }) => <div sz={(c ? f : g)()} />;',
            '/p/t.tsx',
        ).diagnostics;
        expect(diagnostics?.[0]).toContain(
            `function call \`${SZ_FALLBACK_UNKNOWN_CALLEE}()\` result is unknown`,
        );
    });

    it('prints the index variable for a computed member callee', () => {
        // `table[key]()` names `key` even though that is the index, not a
        // method. Both engines read the property node without checking
        // `computed`, so they agree — recorded here so the shared behaviour is
        // deliberate rather than rediscovered as a parity surprise.
        const source = 'export const A = () => <div sz={table[key]()} />;';
        const babel = transformSourceCode(source, '/p/t.tsx').diagnostics ?? [];
        expect(babel[0]).toContain('function call `key()`');
        expect(transformOxc(source, '/p/t.tsx').diagnostics ?? []).toEqual(babel);
    });

    it('reports no fallback for a statically resolvable sz prop', () => {
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        expect(transformSourceCode(source, '/p/t.tsx').diagnostics ?? []).toEqual([]);
        expect(transformOxc(source, '/p/t.tsx').diagnostics ?? []).toEqual([]);
    });
});

// The Rust integration suite (sz_fallback_parity.rs) pins the same wording
// against hand-captured Babel output; this block compares the two lanes LIVE,
// so a wording change on either side fails without regenerating a snapshot.
describe.skipIf(!isRustTransformAvailable())('rust lane parity for sz fallback diagnostics', () => {
    for (const [label, source] of FALLBACK_SOURCES) {
        it(`rust and babel agree on ${label}`, () => {
            const babel = transformSourceCode(source, '/p/t.tsx').diagnostics ?? [];
            const rust = transformRust(source, '/p/t.tsx').diagnostics ?? [];
            expect(rust).toEqual(babel);
            expect(babel.length).toBeGreaterThan(0);
        });
    }
});
