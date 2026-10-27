/**
 * The sz runtime-fallback matrix, and the parity it exists to guarantee.
 *
 * The engine ships as two artifacts, native and wasm, and a host runs whichever
 * loads. If the wording differs between them, the same source produces
 * different build logs depending on a detail the user never chose — so these
 * tests pin both the rendering rules and the fact that the two artifacts agree
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
    type SzFallbackConsequence,
    type SzFallbackKind,
    szFallbackConsequenceOf,
    szsUnsupportedDiagnostic,
} from '../src/sz-fallback-matrix.js';
import { transformWasm } from '../src/transform-wasm.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** Sources that drive each classification arm through a real transform. */
const FALLBACK_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['call', 'export const A = () => <div sz={makeSz()} />;'],
    ['call via member callee', 'export const A = () => <div sz={theme.build()} />;'],
    ['call via computed member callee', 'export const A = () => <div sz={table[key]()} />;'],
    ['call without a readable name', 'export const A = ({ c }) => <div sz={(c ? f : g)()} />;'],
    ['identifier', 'export const A = ({ v }) => <div sz={v} />;'],
    ['member', 'export const A = () => <div sz={cfg.card} />;'],
    // The removed Babel lane's AST had no parenthesized nodes; the engine
    // unwraps them to match. Diverged before that fix: other/ParenthesizedExpression at 1:33
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
            'function call `makeSz()` returns a value unknown at build time',
        );
        expect(describeSzFallback('identifier', 'cardSz').reason).toBe(
            'identifier `cardSz` could not be resolved to a static value',
        );
        expect(describeSzFallback('other', 'ConditionalExpression').reason).toBe(
            'expression of type `ConditionalExpression` cannot be read at build time',
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
            'function call `()` returns a value unknown at build time',
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
        expect(
            szFallbackConsequenceOf(formatSzFallbackDiagnostic('sz', '1:1', 'import', 'c')),
        ).toBe('missing-css');
        expect(szFallbackConsequenceOf(szsUnsupportedDiagnostic('/p/t.tsx'))).toBe('missing-css');
    });

    it('falls to the advisory side when the reason cannot be read at all', () => {
        // A message carrying the site label but no `": "` boundary — a wording
        // change upstream, a truncated line — leaves the kind unknown. That has
        // to read as advisory: a parsing miss must not be able to invent a
        // production error on a build whose own source is fine.
        // The position keeps its own colon, so the string still has one — what
        // it lacks is the colon-SPACE that separates position from reason.
        expect(szFallbackConsequenceOf('sz fallback at 1:1 malformed-with-no-boundary')).toBe(
            'nudge',
        );
    });

    it('splits the sz site by kind, on what the fallback actually cost', () => {
        // Only an IMPORT names a value the compiler tried to read and could
        // not: nothing collected it, here or anywhere, so the classes exist in
        // no output. That is the integrity failure `szr` and `szv` report.
        expect(
            szFallbackConsequenceOf(formatSzFallbackDiagnostic('sz', '1:1', 'import', 'cardSz')),
        ).toBe('missing-css');

        // Every other kind stays advisory, and the reason is the same one each
        // time: the classes were not lost. A bare identifier or a member access
        // is usually a prop the CALLER supplies, and the caller's literal is
        // collected where it is written — `<Card sz={{ p: 4 }} />`. Forwarding
        // `sz` is what the docs teach; a production error on it would fire on
        // working code, which is the one thing this channel may not do.
        for (const kind of ['identifier', 'member', 'call', 'other'] as const) {
            expect(
                szFallbackConsequenceOf(formatSzFallbackDiagnostic('sz', '1:1', kind, 'x')),
                kind,
            ).toBe('nudge');
        }
    });

    it('classifies a kind it cannot recover as advisory rather than as a failure', () => {
        // Recovering the kind means reading rendered text. If a future wording
        // change makes a message unreadable here, the safe reading is the one
        // that cannot invent a production error out of a parsing miss.
        expect(szFallbackConsequenceOf('sz fallback at 1:1: something new entirely.')).toBe(
            'nudge',
        );
    });

    it('leaves messages outside the matrix unclassified', () => {
        expect(
            szFallbackConsequenceOf('[csszyx] Unknown property "x" in sz prop.'),
        ).toBeUndefined();
        expect(szFallbackConsequenceOf('unresolvable sz spread at 1:1')).toBeUndefined();
    });
});

/**
 * Each artifact's diagnostics for one source.
 *
 * @param source - Module source.
 * @returns `[artifact name, diagnostics]` per engine artifact.
 */
function diagnosticsPerEngine(source: string): Array<readonly [string, string[]]> {
    return ENGINES.map(
        ([name, transform]) =>
            [name, transform(source, { filename: '/p/t.tsx' }).diagnostics ?? []] as const,
    );
}

// The Rust integration suite (sz_fallback_parity.rs) pins the same wording
// against goldens; this block compares the two artifacts LIVE, so a wording
// change on either side fails without regenerating a snapshot.
describe('engine parity for sz fallback diagnostics', () => {
    for (const [label, source] of FALLBACK_SOURCES) {
        it(`every artifact agrees on ${label}`, () => {
            const wasm = transformWasm(source, { filename: '/p/t.tsx' }).diagnostics ?? [];
            expect(wasm.length).toBeGreaterThan(0);

            // Both artifacts must report the same thing, in the same words:
            // this is the whole reason the matrix is shared rather than copied.
            for (const [name, diagnostics] of diagnosticsPerEngine(source)) {
                expect(diagnostics, name).toEqual(wasm);
            }
        });
    }

    it('names the callee when the call has a readable name', () => {
        const tsx = 'export const A = () => <div sz={makeSz()} />;';
        for (const [name, diagnostics] of diagnosticsPerEngine(tsx)) {
            expect(diagnostics[0], name).toContain('function call `makeSz()`');
        }
    });

    it('falls back to the stand-in name for an unreadable callee', () => {
        const tsx = 'export const A = ({ c }) => <div sz={(c ? f : g)()} />;';
        for (const [name, diagnostics] of diagnosticsPerEngine(tsx)) {
            expect(diagnostics[0], name).toContain(
                `function call \`${SZ_FALLBACK_UNKNOWN_CALLEE}()\` returns a value unknown`,
            );
        }
    });

    it('prints the index variable for a computed member callee', () => {
        // `table[key]()` names `key` even though that is the index, not a
        // method. The engine reads the property node without checking
        // `computed` — recorded here so the behaviour is deliberate rather
        // than rediscovered as a surprise.
        const source = 'export const A = () => <div sz={table[key]()} />;';
        for (const [name, diagnostics] of diagnosticsPerEngine(source)) {
            expect(diagnostics[0], name).toContain('function call `key()`');
        }
    });

    it('reports no fallback for a statically resolvable sz prop', () => {
        const source = 'export const A = () => <div sz={{ p: 4 }} />;';
        for (const [name, diagnostics] of diagnosticsPerEngine(source)) {
            expect(diagnostics, name).toEqual([]);
        }
    });
});

// The consequence of an engine fallback is its code (`fallback-missing-css` or
// `fallback-nudge`), which is what `csszyx check` and the bundler route on. The
// classifier above still reads the runtime lane's text. These run the real
// transforms, so an artifact that gives a different code is caught by the
// routing that depends on it.
describe('engine parity for the sz consequence split', () => {
    const CONSEQUENCE_SOURCES: ReadonlyArray<readonly [string, string, SzFallbackConsequence]> = [
        // An imported binding: a module-level value the compiler tried to read
        // and could not. Nothing collected its classes, so the CSS is absent.
        [
            'named import',
            "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;",
            'missing-css',
        ],
        [
            'default import',
            "import cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;",
            'missing-css',
        ],
        [
            'namespace import member',
            "import * as S from './styles';\nexport const A = () => <div sz={S.cardSz} />;",
            'missing-css',
        ],
        // A forwarded prop. The value belongs to the CALLER, whose literal is
        // collected where it is written, and forwarding `sz` is the documented
        // wrapper pattern — advisory, never a build error.
        ['forwarded prop', 'export const A = ({ sz }) => <div sz={sz} />;', 'nudge'],
        ['forwarded props member', 'export const A = props => <div sz={props.sz} />;', 'nudge'],
        ['unbound member', 'export const A = () => <div sz={cfg.card} />;', 'nudge'],
        ['call', 'export const A = () => <div sz={makeSz()} />;', 'nudge'],
        ['other', 'export const A = ({ v }) => <div sz={`${v}`} />;', 'nudge'],
    ];

    for (const [label, source, expected] of CONSEQUENCE_SOURCES) {
        for (const [name, engine] of ENGINES) {
            it(`${name} routes a ${label} fallback to ${expected}`, () => {
                const { result } = captureWarnings(engine, source);
                const fallbacks = (result.issues ?? []).filter(issue =>
                    issue.code.startsWith('fallback-'),
                );
                expect(fallbacks.length).toBeGreaterThan(0);
                for (const issue of fallbacks) {
                    expect(issue.code).toBe(`fallback-${expected}`);
                    expect(issue.args).toMatchObject({ site: 'sz' });
                }
            });
        }
    }
});
