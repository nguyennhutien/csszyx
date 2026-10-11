/**
 * Native-vs-wasm parity — every fixture must produce identical output from
 * `transformRust` (the native napi artifact of the Rust engine) and
 * `transformWasm` (its wasm artifact): same code, classes, `transformed` flag
 * and CSS custom-property metadata.
 *
 * The native addon must be built once per host platform
 * (`pnpm --filter @csszyx/core native:build -- --native-engine`). `beforeAll`
 * preloads it from the workspace platform package; without it every fixture
 * fails with the unavailable-binding error instead of passing on wasm alone.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import {
    assertNativeMatchesWasm,
    compareNativeVsWasm,
    type RustParityFixture,
} from './transform-rust-harness.js';

const fixtures: readonly RustParityFixture[] = [
    {
        name: 'no-sz-fast-path',
        source: 'const X = () => <div id="a">hello</div>;',
        filename: 'no-sz.tsx',
    },
    {
        name: 'static-single-prop',
        source: 'const X = () => <div sz={{ p: 4 }} />;',
        filename: 'single.tsx',
    },
    {
        name: 'static-string-prop',
        source: 'const X = () => <div sz="p-4 bg-blue-500" />;',
        filename: 'string.tsx',
    },
    {
        name: 'static-multi-prop',
        source: 'const X = () => <div sz={{ p: 4, bg: "blue-500", text: "white" }} />;',
        filename: 'multi.tsx',
    },
    {
        name: 'static-variant-hover',
        source: 'const X = () => <div sz={{ p: 4, hover: { bg: "blue-600" } }} />;',
        filename: 'variant.tsx',
    },
    {
        name: 'arbitrary-variant-with-selector-quotes',
        source: `const X = () => <div sz={{ '[&[data-state="open"]]': { bg: 'red-500' } }} />;`,
        filename: 'arbitrary-variant-quote.tsx',
    },
    {
        name: 'sz-with-existing-classname',
        source: 'const X = () => <div className="existing" sz={{ p: 4 }} />;',
        filename: 'merge.tsx',
    },
    {
        name: 'static-spread-literal',
        source: 'const X = () => <div sz={{ ...{ p: 4 }, m: 2 }} />;',
        filename: 'spread-literal.tsx',
    },
    {
        name: 'sz-recover-csr',
        source: 'const X = () => <div szRecover="csr" sz={{ p: 4 }} />;',
        filename: 'recover.tsx',
    },
    {
        name: 'sz-direct-local-binding',
        source: ['const BASE = { p: 4 } as const;', 'const X = () => <div sz={BASE} />;'].join(
            '\n',
        ),
        filename: 'binding.tsx',
    },
    {
        name: 'sz-identifier-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = () => <div sz={{ ...BASE, m: 2 }} />;',
        ].join('\n'),
        filename: 'ident-spread.tsx',
    },
    {
        name: 'sz-identifier-spread-trailing-override',
        source: [
            'const ITEM = { p: 2, rounded: "md" } as const;',
            'const X = () => <div sz={{ ...ITEM, p: 8 }} />;',
        ].join('\n'),
        filename: 'ident-spread-override.tsx',
    },
    {
        name: 'sz-nested-variant-trailing-override',
        source: [
            'const BASE = { hover: { p: 2, m: 1 } } as const;',
            'const X = () => <div sz={{ ...BASE, hover: { p: 4 } }} />;',
        ].join('\n'),
        filename: 'nested-variant-override.tsx',
    },
    {
        name: 'sz-conditional-spread',
        source: [
            'const BASE = { p: 4 } as const;',
            'const X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;',
        ].join('\n'),
        filename: 'cond-spread.tsx',
    },
    {
        name: 'sz-runtime-identifier',
        source: 'const X = ({ styles }) => <div sz={styles} />;',
        filename: 'runtime-ident.tsx',
    },
    {
        name: 'sz-runtime-call',
        source: 'const X = () => <div sz={getStyles()} />;',
        filename: 'runtime-call.tsx',
    },
    {
        name: 'sz-runtime-ternary',
        source: 'const X = ({ active }) => <div sz={active ? { p: 4 } : { p: 8 }} />;',
        filename: 'ternary.tsx',
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
    },
    {
        name: 'sz-static-property-ternary',
        source: 'const X = ({ big }) => <div sz={{ p: big ? 8 : 4 }} />;',
        filename: 'property-ternary.tsx',
    },
    {
        name: 'sz-dynamic-css-var',
        source: 'const X = ({ pad }) => <div sz={{ p: pad, bg: "blue-500" }} />;',
        filename: 'dynamic-css-var.tsx',
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars',
        source: 'const X = ({ pad }) => <div sz={{ p: pad, bg: "blue-500" }} />;',
        filename: 'dynamic-css-var-mangle-vars.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-hoist',
        source: [
            'const X = ({ pad }) => (',
            '  <section>',
            '    <div sz={{ p: pad }} />',
            '    <button sz={{ p: pad }} />',
            '  </section>',
            ');',
        ].join('\n'),
        filename: 'dynamic-css-var-mangle-vars-hoist.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-component-boundary-diagnostic',
        source: 'const X = ({ pad }) => <Card><div sz={{ p: pad }} /><button sz={{ p: pad }} /></Card>;',
        filename: 'dynamic-css-var-mangle-vars-boundary.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-fragment-boundary-diagnostic',
        source: 'const X = ({ pad }) => <><div sz={{ p: pad }} /><button sz={{ p: pad }} /></>;',
        filename: 'dynamic-css-var-mangle-vars-fragment.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-hoist-max-depth',
        source: [
            'const X = ({ pad }) => (',
            '  <section>',
            '    <div>',
            '      <article>',
            '        <aside>',
            '          <div>',
            '            <span sz={{ p: pad }} />',
            '          </div>',
            '        </aside>',
            '      </article>',
            '    </div>',
            '    <button sz={{ p: pad }} />',
            '  </section>',
            ');',
        ].join('\n'),
        filename: 'dynamic-css-var-mangle-vars-hoist-max-depth.tsx',
        options: { mangleVars: true, mangleVarHoistMaxDepth: 6 },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-reserved-style-vars',
        source: [
            'const X = ({ pad, gap }) => (',
            '  <section style={{ "--cz": "user" }}>',
            '    <div style={{ "--sz": "local" }} sz={{ p: pad }} />',
            '    <button sz={{ p: pad, gap }} />',
            '  </section>',
            ');',
        ].join('\n'),
        filename: 'dynamic-css-var-mangle-vars-reserved.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-mangle-vars-normalized-value-key',
        source: 'const X = ({ pad }) => <section><div sz={{ p: pad }} /><button sz={{ p: (pad) }} /></section>;',
        filename: 'dynamic-css-var-mangle-vars-normalized-value-key.tsx',
        options: { mangleVars: true },
    },
    {
        name: 'sz-dynamic-css-var-existing-class',
        source: 'const X = ({ pad }) => <div className="existing" sz={{ p: pad }} />;',
        filename: 'dynamic-existing-static-class.tsx',
    },
    {
        name: 'sz-dynamic-css-var-existing-class-expression',
        source: 'const X = ({ pad }) => <div className={getClasses()} sz={{ p: pad }} />;',
        filename: 'dynamic-existing-class.tsx',
    },
    {
        name: 'dynamic-call-static-object',
        source: [
            "import { dynamic } from '@csszyx/dynamic';",
            'const X = () => <div className={dynamic({ p: 4, rounded: "md" })} />;',
        ].join('\n'),
        filename: 'dynamic-call.tsx',
    },
    {
        name: 'dynamic-call-static-binding',
        source: [
            "import { dynamic } from '@csszyx/dynamic';",
            'const styles = { w: 7, h: 8, rounded: "sm" } as const;',
            'const X = () => <div className={dynamic(styles as any)} />;',
        ].join('\n'),
        filename: 'dynamic-call-binding.tsx',
    },
    {
        name: 'sz-array-logical-object',
        source: [
            'const base = { p: 4, rounded: "md" };',
            'const X = ({ active }) => <div sz={[{ ...base }, active && { bg: "blue-500" }]} />;',
        ].join('\n'),
        filename: 'array-logical.tsx',
    },
    {
        name: 'sz-array-identifier-elements',
        source: [
            'const layout = { display: "flex", gap: 4 };',
            'const color = { bg: "blue-500" };',
            'const X = () => <div sz={[layout, color]} />;',
        ].join('\n'),
        filename: 'array-identifiers.tsx',
    },
    {
        name: 'sz-conditional-spread-ternary',
        source: [
            'const active = { bg: "blue-500", color: "white" };',
            'const inactive = { bg: "gray-100", color: "gray-600" };',
            'const X = ({ on }) => <div sz={{ ...(on ? active : inactive), p: 4 }} />;',
        ].join('\n'),
        filename: 'conditional-spread-ternary.tsx',
    },
    {
        name: 'sz-identifier-static-ternary',
        source: [
            'const X = ({ active }) => {',
            '  const styles = active ? { p: 4 } : { p: 2 };',
            '  return <div sz={styles} />;',
            '};',
        ].join('\n'),
        filename: 'identifier-static-ternary.tsx',
    },
    {
        // An sz that lowers to zero classes emits `className={undefined}` (renders
        // no class attribute) on every engine, not `class=""`.
        name: 'sz-empty-object',
        source: 'const X = () => <div sz={{}} />;',
        filename: 'empty-object.tsx',
    },
    {
        name: 'sz-empty-array',
        source: 'const X = () => <div sz={[]} />;',
        filename: 'empty-array.tsx',
    },
    {
        name: 'sz-ternary-empty-branch',
        source: 'const X = ({ on }) => <div sz={on ? { p: 4 } : {}} />;',
        filename: 'ternary-empty-branch.tsx',
    },
];

describe('Rust engine — native artifact matches the wasm artifact', () => {
    beforeAll(() => {
        // Preload the native addon from the workspace platform package so
        // `transformRust()` does not hit the unavailable-binding path on
        // hosts that have already run `pnpm --filter @csszyx/core
        // native:build -- --native-engine`. CI must build the addon
        // before this suite; without it every fixture fails loudly with
        // the unavailable-binding message.
        try {
            loadNativeBinding();
        } catch {
            // Binding absent or wrong platform — `transformRust` throws
            // `RustTransformUnavailableError`, which each fixture reports.
        }
    });

    for (const fixture of fixtures) {
        it(fixture.name, () => {
            const comparison = compareNativeVsWasm(
                fixture.source,
                fixture.filename,
                fixture.options,
            );
            expect(() => assertNativeMatchesWasm(fixture, comparison)).not.toThrow();
        });
    }
});
