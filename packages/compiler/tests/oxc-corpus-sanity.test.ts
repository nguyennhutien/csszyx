/**
 * Phase D3 corpus sanity set.
 *
 * This is deliberately smaller than the final full-corpus parity suite. It
 * samples behaviour from the existing compiler tests and records the current
 * Babel-vs-oxc category for each case so D3 can expand from known data instead
 * of assumptions.
 */

import { describe, expect, it } from 'vitest';

import { compareImpls, type ParityComparison } from './oxc-parity-harness.js';

type CorpusCategory =
    | 'parity'
    | 'surgical-parity'
    | 'oxc-throws'
    | 'class-divergence'
    | 'diagnostics-divergence'
    | 'metadata-divergence';

interface CorpusFixture {
    name: string;
    source: string;
    expected: CorpusCategory;
    note: string;
}

const fixtures: readonly CorpusFixture[] = [
    {
        name: 'static object literal',
        source: 'const A = () => <div sz={{ p: 4, bg: "blue-500" }} />;',
        expected: 'parity',
        note: 'D2 static object path',
    },
    {
        name: 'nested hover variant',
        source: 'const A = () => <div sz={{ hover: { bg: "blue-600" }, md: { p: 8 } }} />;',
        expected: 'parity',
        note: 'nested object properties compile through transform-core',
    },
    {
        name: 'existing static className merge',
        source: 'const A = () => <div className="card" sz={{ p: 4 }} />;',
        expected: 'parity',
        note: 'element-level visitor can see className + sz together',
    },
    {
        name: 'multiple static elements',
        source: [
            'const A = () => (',
            '  <section sz={{ p: 4 }}>',
            '    <span sz={{ m: 2 }} />',
            '  </section>',
            ');',
        ].join('\n'),
        expected: 'surgical-parity',
        note: 'classes match; magic-string preserves formatting vs Babel codegen',
    },
    {
        name: 'szRecover only',
        source: 'const A = () => <div szRecover="csr">x</div>;',
        expected: 'parity',
        note: 'token generation does not require sz prop',
    },
    {
        name: 'szRecover invalid mode',
        source: 'const A = () => <div szRecover="ssr">x</div>;',
        expected: 'parity',
        note: 'invalid-mode diagnostics already match Babel',
    },
    {
        name: 'string sz attribute',
        source: 'const A = () => <div sz="p-4 bg-blue-500" />;',
        expected: 'parity',
        note: 'string-literal sz rewrites directly to className',
    },
    {
        name: 'array sz attribute',
        source: 'const A = () => <div sz={[{ flex: true }, { p: 4 }]} />;',
        expected: 'parity',
        note: 'fully static arrays compile without runtime',
    },
    {
        name: 'dynamic css var value',
        source: 'const A = () => <div sz={{ p: padVal }} />;',
        expected: 'surgical-parity',
        note: 'oxc emits CSS variable helper classes for dynamic object values',
    },
    {
        name: 'dynamic value plus existing expression className',
        source: 'const A = () => <div className={getClasses()} sz={{ p: padVal }} />;',
        expected: 'oxc-throws',
        note: 'existing class expression + runtime fallback is not ported',
    },
    {
        name: 'local object direct variable',
        source: 'const base = { p: 4 }; const A = () => <div sz={base} />;',
        expected: 'surgical-parity',
        note: 'minimal D5 local object binding resolves direct identifiers',
    },
    {
        name: 'local object spread',
        source: 'const base = { p: 4 }; const A = () => <div sz={{ ...base }} />;',
        expected: 'surgical-parity',
        note: 'minimal D5 local object binding resolves spread identifiers',
    },
    {
        name: 'local spread plus dynamic value',
        source: [
            "const base = { rounded: 'lg', p: 4 };",
            'const A = ({ color }) => <div sz={{ ...base, bg: color }} />;',
        ].join('\n'),
        expected: 'surgical-parity',
        note: 'partial CSS-variable compile can merge local static spreads first',
    },
    {
        name: 'conditional object spread',
        source: [
            "const active = { bg: 'blue-500', color: 'white' };",
            "const inactive = { bg: 'gray-100', color: 'gray-600' };",
            'const A = ({ isActive }) => <div sz={{ ...(isActive ? active : inactive), p: 4 }} />;',
        ].join('\n'),
        expected: 'class-divergence',
        note: 'conditional object-spread hoisting is still a later D5 slice',
    },
    {
        name: 'conditional object value',
        source: 'const A = ({ big }) => <div sz={{ p: big ? 8 : 4 }} />;',
        expected: 'surgical-parity',
        note: 'oxc emits static branch classes for literal property ternaries',
    },
    {
        name: 'direct ternary variable branches',
        source: [
            'const ON = { opacity: 100 };',
            'const OFF = { opacity: 0 };',
            'const A = ({ on }) => <div sz={on ? ON : OFF} />;',
        ].join('\n'),
        expected: 'surgical-parity',
        note: 'minimal D5 scope resolver emits static ternary class branches',
    },
    {
        name: 'inert runtime helper in className',
        source: [
            "import { _sz } from '@csszyx/runtime';",
            'const A = ({ active }) => <div className={_sz("base", active && "on")} />;',
        ].join('\n'),
        expected: 'surgical-parity',
        note: 'D2 marks runtime helper calls inert when not coming from sz prop',
    },
];

describe('Phase D3 — oxc corpus sanity categories', () => {
    const comparisons = fixtures.map(fixture => ({
        fixture,
        comparison: compareImpls(fixture.source, `${fixture.name.replace(/\W+/g, '-')}.tsx`),
    }));

    for (const { fixture, comparison } of comparisons) {
        it(`${fixture.name} -> ${fixture.expected}`, () => {
            expect(categorise(comparison)).toBe(fixture.expected);
        });
    }

    it('prints corpus sanity summary', () => {
        const counts = new Map<CorpusCategory, number>();
        for (const { comparison } of comparisons) {
            const category = categorise(comparison);
            counts.set(category, (counts.get(category) ?? 0) + 1);
        }

        const summary = [...counts]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, count]) => `${category}: ${count}`)
            .join(', ');
        console.log(`\n  Phase D3 corpus sanity (${fixtures.length} fixtures) — ${summary}\n`);

        expect(counts.get('class-divergence')).toBeGreaterThan(0);
        expect(counts.get('parity')).toBeGreaterThan(0);
    });
});

function categorise(comparison: ParityComparison): CorpusCategory {
    if (comparison.oxcError) {
        return 'oxc-throws';
    }
    if (!comparison.classesEqual) {
        return 'class-divergence';
    }
    if (!comparison.diagnosticsEqual) {
        return 'diagnostics-divergence';
    }
    if (!comparison.transformedEqual) {
        return 'metadata-divergence';
    }
    return comparison.codeEqual ? 'parity' : 'surgical-parity';
}
