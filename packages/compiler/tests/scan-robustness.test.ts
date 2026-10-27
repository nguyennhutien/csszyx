/**
 * Safelist-scan robustness — regressions from the vui 0.10.10 field report
 * item 2 (engine-dependent token loss and corrupted tokens):
 *
 * 1. JSX inside plain `.js` / `.mjs` / `.cjs` files. oxc's extension mapping
 *    picks a JSX-less grammar for those, so the native engine silently
 *    contributed NOTHING from such files (empty IR, no fallback) while the
 *    since-removed JS lanes recovered via Babel — whole files of classes went
 *    missing from the safelist under `parser: 'rust'`. The engine now parses
 *    plain JS with JSX enabled (a superset: a leading `<` was a syntax error
 *    before).
 *
 * 2. Purely numeric sz keys (`{ 50: 100 }` — numeric lookup tables swallowed
 *    by extraction) minted garbage classes like `50-100` via the unknown-key
 *    kebab fallback. The engine now emits nothing for them.
 *
 * Fixtures are field-named (not `const source = ...`) so the extracted-corpus
 * meta-test does not sample them.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { loadNativeBinding } from '../../core/native/index.js';
import { transformRust } from '../src/transform-rust.js';
import type { transformWasm } from '../src/transform-wasm.js';
import { ENGINES as PARITY_ENGINES, RUST_LANE } from './engine-parity-harness.js';

/** Both artifacts, typed to the full result so `rawClassNames` is readable. */
const ENGINES = PARITY_ENGINES.map(
    ([name, engine]) => [name, engine as typeof transformWasm] as const,
);

describe('safelist scan robustness', () => {
    beforeAll(() => {
        try {
            loadNativeBinding();
        } catch {
            // Binding absent — rust assertions are skipped below.
        }
    });

    describe('JSX in plain JavaScript files', () => {
        const jsxInJs =
            'export const Toolbar = ({ x }) => <div className="toolbar date" sz={{ mx: 0, my: 4 }} />;';

        for (const ext of ['js', 'mjs', 'cjs']) {
            for (const [name, engine] of ENGINES) {
                it(`${name} extracts classes from JSX in a .${ext} file (no silent empty scan)`, () => {
                    const result = engine(jsxInJs, { filename: `Toolbar.${ext}` });
                    expect([...result.classes].sort()).toEqual(['mx-0', 'my-4']);
                    expect([...result.rawClassNames].sort()).toEqual(['date', 'toolbar']);
                    expect(result.diagnostics).toEqual([]);
                });
            }
        }

        it('plain JS without JSX still parses everywhere', () => {
            const plainJs = 'const lt = 1 < 2; export const gt = lt && 2 > 1;';
            for (const [, engine] of ENGINES) {
                expect(() => engine(plainJs, { filename: 'math.js' })).not.toThrow();
            }
        });

        it.skipIf(!RUST_LANE)(
            'rust still flags a genuinely broken file with a parse-error diagnostic',
            () => {
                const broken = 'export const A = () => <div sz={{ p: 4 } ;';
                const result = transformRust(broken, { filename: 'Broken.tsx' });
                expect(result.classes.size).toBe(0);
                expect(
                    result.issues.some(issue => issue.code === 'parse-error'),
                    'the parse failure must be observable, not a silent empty scan',
                ).toBe(true);
                expect(
                    result.diagnostics.some(d =>
                        d.startsWith('[csszyx] parse-error: Broken.tsx:1:'),
                    ),
                    'the message must carry the code and the position',
                ).toBe(true);
            },
        );
    });

    describe('raw class discovery is independent of JSX attribute order', () => {
        const fixtures = [
            'export const A=()=> <div className="raw token" sz={{p:4}}/>;',
            'export const A=()=> <div sz={{p:4}} className="raw token"/>;',
        ];

        for (const [name, engine] of ENGINES) {
            it(`${name} catalogs className before and after sz`, () => {
                for (const source of fixtures) {
                    expect([...engine(source, { filename: 'A.tsx' }).rawClassNames].sort()).toEqual(
                        ['raw', 'token'],
                    );
                }
            });
        }
    });

    describe('purely numeric sz keys never mint garbage classes', () => {
        const numericSz = 'export const A = () => <div sz={{ 50: 100, p: 2 }} />;';
        const numericSzvLeaf =
            'import { szv } from "@csszyx/runtime"; export const t = szv({ variants: { op: { half: { 50: 100, m: 6 } } } });';

        for (const [name, engine] of ENGINES) {
            it(`${name} skips a numeric key in sz`, () => {
                expect([...engine(numericSz, { filename: 'A.tsx' }).classes].sort()).toEqual([
                    'p-2',
                ]);
            });
            it(`${name} skips a numeric key inside an szv catalog`, () => {
                expect([...engine(numericSzvLeaf, { filename: 'A.tsx' }).classes].sort()).toEqual([
                    'm-6',
                ]);
            });
        }
    });
});
