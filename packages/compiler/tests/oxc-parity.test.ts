/**
 * Phase D parity test — tracks how many fixtures the oxc-based
 * `transformOxc` matches `transformSourceCode` (Babel) on.
 *
 * Each fixture carries an `expected` field tracking its current parity
 * state. Until D2.1 lands the real implementation, every fixture is
 * `'pending'` (the oxc skeleton throws `OxcNotImplementedError`, and
 * the harness counts that as the expected-pending state).
 *
 * Workflow per slice:
 *   1. Land slice D2.N (extends `transformOxc` to handle more cases).
 *   2. Flip the matching fixtures' `expected` from `'pending'` to
 *      `'parity'`. Drop `pendingReason`.
 *   3. Run `pnpm test oxc-parity` — failures point at fixtures the
 *      slice was supposed to land but didn't (regression catch).
 *
 * If a `'pending'` fixture starts matching Babel exactly (e.g. an
 * unrelated slice incidentally fixed it), the assertion in
 * {@link assertExpectedParity} flags it so the dev can flip its
 * status. Catches both directions of drift.
 */

import { describe, expect, it } from 'vitest';
import {
    assertExpectedParity,
    compareImpls,
    type ParityFixture,
    summarise,
} from './oxc-parity-harness.js';

const fixtures: readonly ParityFixture[] = [
    {
        name: 'no-sz-fast-path',
        source: 'const X = () => <div id="a">hello</div>;',
        filename: 'no-sz.tsx',
        expected: 'parity',
    },
    {
        name: 'static-single-prop',
        source: 'const X = () => <div sz={{ p: 4 }} />;',
        filename: 'single.tsx',
        expected: 'parity',
    },
    {
        name: 'static-string-prop',
        source: 'const X = () => <div sz="p-4 bg-blue-500" />;',
        filename: 'string.tsx',
        expected: 'parity',
    },
    {
        name: 'static-multi-prop',
        source: 'const X = () => <div sz={{ p: 4, bg: "blue-500", text: "white" }} />;',
        filename: 'multi.tsx',
        expected: 'parity',
    },
    {
        name: 'static-variant-hover',
        source: 'const X = () => <div sz={{ p: 4, hover: { bg: "blue-600" } }} />;',
        filename: 'variant.tsx',
        expected: 'parity',
    },
    {
        name: 'static-responsive-sm',
        source: 'const X = () => <div sz={{ p: 4, sm: { p: 6 } }} />;',
        filename: 'responsive.tsx',
        expected: 'parity',
    },
    {
        name: 'static-array-prop',
        source: 'const X = () => <div sz={[{ flex: true }, { p: 4 }]} />;',
        filename: 'array.tsx',
        expected: 'parity',
    },
    {
        name: 'multi-element-static',
        source: [
            'const X = () => (',
            '    <section sz={{ p: 4 }}>',
            '        <div sz={{ bg: "white" }} />',
            '    </section>',
            ');',
        ].join('\n'),
        filename: 'multi-element.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-with-existing-classname',
        source: 'const X = () => <div className="existing" sz={{ p: 4 }} />;',
        filename: 'merge.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-recover-csr',
        source: 'const X = () => <div szRecover="csr" sz={{ p: 4 }} />;',
        filename: 'recover.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-runtime-call',
        source: [
            "import { _sz } from '@csszyx/runtime';",
            'const X = ({ active }) => <div className={_sz("base", active && "on")} />;',
        ].join('\n'),
        filename: 'runtime.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-conditional-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;',
        ].join('\n'),
        filename: 'spread.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-direct-local-object',
        source: ['const BASE = { p: 4 } as const;', 'const X = () => <div sz={BASE} />;'].join(
            '\n',
        ),
        filename: 'direct-local.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-local-object-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = () => <div sz={{ ...BASE, mt: 2 }} />;',
        ].join('\n'),
        filename: 'local-spread.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-direct-ternary-local-objects',
        source: [
            'const ON = { opacity: 100 } as const;',
            'const OFF = { opacity: 0 } as const;',
            'const X = ({ on }) => <div sz={on ? ON : OFF} />;',
        ].join('\n'),
        filename: 'direct-ternary.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-dynamic-css-var',
        source: 'const X = ({ pad }) => <div sz={{ p: pad, bg: "blue-500" }} />;',
        filename: 'dynamic-css-var.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-static-property-ternary',
        source: 'const X = ({ big }) => <div sz={{ p: big ? 8 : 4 }} />;',
        filename: 'property-ternary.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'dynamic-call-static-object',
        source: [
            "import { dynamic } from '@csszyx/dynamic';",
            'const X = () => <div className={dynamic({ p: 4, rounded: "md" })} />;',
        ].join('\n'),
        filename: 'dynamic-call.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-local-spread-dynamic-css-var',
        source: [
            'const BASE = { rounded: "lg", p: 4 } as const;',
            'const X = ({ color }) => <div sz={{ ...BASE, bg: color }} />;',
        ].join('\n'),
        filename: 'local-spread-dynamic.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-conditional-local-spread',
        source: [
            'const ON = { opacity: 100 } as const;',
            'const OFF = { opacity: 0 } as const;',
            'const X = ({ show }) => <div sz={{ ...(show ? ON : OFF), transition: "opacity" }} />;',
        ].join('\n'),
        filename: 'conditional-spread.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-array-logical-object',
        source: 'const X = ({ active }) => <div sz={[{ flex: true }, active && { bg: "blue-500" }]} />;',
        filename: 'array-logical.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-local-conditional-binding',
        source: [
            'const styles = active ? { p: 4 } : { p: 2 };',
            'const X = () => <div sz={styles} />;',
        ].join('\n'),
        filename: 'conditional-binding.tsx',
        expected: 'surgical-parity',
    },
    {
        name: 'sz-dynamic-css-var-existing-class-expression',
        source: 'const X = ({ pad }) => <div className={getClasses()} sz={{ p: pad }} />;',
        filename: 'dynamic-existing-class.tsx',
        expected: 'surgical-parity',
    },
];

describe('Phase D — Babel vs oxc parity', () => {
    for (const fixture of fixtures) {
        it(`${fixture.name} [${fixture.expected}]`, () => {
            const comparison = compareImpls(fixture.source, fixture.filename);
            expect(() => assertExpectedParity(fixture, comparison)).not.toThrow();
        });
    }

    it('progress tracker', () => {
        const summary = summarise(fixtures);
        console.log(`\n  ${summary}\n`);
        expect(summary).toMatch(
            /Phase D parity: \d+% — \d+ full, \d+ surgical, \d+ classes-only, \d+ pending \(\d+ total\)/,
        );
    });
});
