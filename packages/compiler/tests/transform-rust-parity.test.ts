/**
 * Rust transform parity — tracks how many fixtures the Rust native engine
 * matches `transformOxc` (the v0.8.0 production baseline). Mirrors the
 * Phase D oxc-vs-Babel parity playbook: each fixture carries an
 * `expected` state, flips from `pending` to `parity` or `rust-ahead` as the
 * Rust engine grows coverage, and catches drift in both directions.
 *
 * The Rust engine ships as a native addon under `@csszyx/core/native` and
 * must be built once per host platform before these tests can compare
 * meaningfully. `setup()` below preloads the addon from the workspace
 * platform package when present; if the addon is not built, every
 * fixture passes via the `pending` path and a summary line is logged so
 * the gap is visible.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import {
    assertExpectedRustParity,
    compareRustVsOxc,
    type RustParityFixture,
    summariseRust,
} from './transform-rust-harness.js';

const fixtures: readonly RustParityFixture[] = [
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
        name: 'sz-with-existing-classname',
        source: 'const X = () => <div className="existing" sz={{ p: 4 }} />;',
        filename: 'merge.tsx',
        expected: 'parity',
    },
    {
        name: 'static-spread-literal',
        source: 'const X = () => <div sz={{ ...{ p: 4 }, m: 2 }} />;',
        filename: 'spread-literal.tsx',
        expected: 'rust-ahead',
    },
    {
        name: 'sz-recover-csr',
        source: 'const X = () => <div szRecover="csr" sz={{ p: 4 }} />;',
        filename: 'recover.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-direct-local-binding',
        source: ['const BASE = { p: 4 } as const;', 'const X = () => <div sz={BASE} />;'].join(
            '\n',
        ),
        filename: 'binding.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-identifier-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = () => <div sz={{ ...BASE, m: 2 }} />;',
        ].join('\n'),
        filename: 'ident-spread.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-conditional-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;',
        ].join('\n'),
        filename: 'cond-spread.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-runtime-identifier',
        source: 'const X = ({ styles }) => <div sz={styles} />;',
        filename: 'runtime-ident.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-runtime-call',
        source: 'const X = () => <div sz={getStyles()} />;',
        filename: 'runtime-call.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-runtime-ternary',
        source: 'const X = ({ active }) => <div sz={active ? { p: 4 } : { p: 8 }} />;',
        filename: 'ternary.tsx',
        expected: 'parity',
    },
    {
        name: 'sz-function-local-ternary',
        source: [
            'const X = ({ active }) => {',
            '    const ON = { p: 4 } as const;',
            '    const OFF = { p: 8 } as const;',
            '    return <div sz={active ? ON : OFF} />;',
            '};',
        ].join('\n'),
        filename: 'function-local-ternary.tsx',
        expected: 'parity',
    },
];

describe('Rust native engine — parity vs oxc-JS', () => {
    beforeAll(() => {
        // Preload the Rust addon from the workspace platform package so
        // `transformRust()` does not hit the unavailable-binding path on
        // hosts that have already run `pnpm --filter @csszyx/core
        // native:build -- --native-engine`. CI must build the addon
        // before this suite. When the build is absent, fixtures
        // marked `pending` continue to pass and non-pending fixtures
        // fail loudly with a missing-build message.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const platformDir = path.resolve(here, '../../core-linux-arm64-gnu');
        try {
            loadNativeBinding(platformDir);
        } catch {
            // Binding absent or wrong platform — `transformRust` will
            // continue to throw `OxcRustNotImplementedError` per
            // existing scaffold semantics. Individual tests handle
            // that via the `pending` state.
        }
    });

    for (const fixture of fixtures) {
        it(`${fixture.name} [${fixture.expected}]`, () => {
            const comparison = compareRustVsOxc(fixture.source, fixture.filename);
            expect(() => assertExpectedRustParity(fixture, comparison)).not.toThrow();
        });
    }

    it('progress tracker', () => {
        const summary = summariseRust(fixtures);
        console.log(`\n  ${summary}\n`);
        expect(summary).toMatch(
            /Rust vs oxc-JS coverage: \d+% — \d+ full, \d+ surgical, \d+ classes-only, \d+ rust-ahead, \d+ pending \(\d+ total\)/,
        );
    });
});
