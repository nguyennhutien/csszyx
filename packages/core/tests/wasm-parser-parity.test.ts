/**
 * Parser-level parity for the WASM build of the native engine.
 *
 * `pkg-parser/` is the same `parser.rs`/`engine.rs` source compiled with the
 * `native-engine` feature to `wasm32-unknown-unknown` — the universal fallback
 * a machine uses when no `@csszyx/core-<platform>` binary is available. The
 * corpus replayed here is the same frozen regression corpus
 * `parse_parity_corpus.rs` runs through the napi binding, so the two artifacts
 * of the one engine cannot drift apart without this file or that one going red.
 *
 * Like `wasm-runtime-parity.test.ts`, this suite requires `pnpm build` to have
 * produced the wasm packages first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface ParseRecord {
    source: string;
    classes: string[];
    rawClassNames: string[];
}

interface WasmTransformResult {
    code: string;
    classes: string[];
    raw_class_names: string[];
    diagnostics: string[];
}

interface ParserWasm {
    transform_source(filename: string, source: string): string;
    transform_batch_json(filesJson: string, optionsJson: string): string;
}

const wasmEntry = fileURLToPath(new URL('../pkg-parser/csszyx_core.js', import.meta.url));

const MISSING =
    'pkg-parser wasm build is missing — run `pnpm --filter @csszyx/core build` ' +
    '(the parser wasm is built alongside pkg/ and pkg-node/)';

function loadParserWasm(): ParserWasm | null {
    if (!existsSync(wasmEntry)) return null;
    return createRequire(import.meta.url)(wasmEntry) as ParserWasm;
}

const corpus: ParseRecord[] = JSON.parse(
    readFileSync(
        fileURLToPath(new URL('./fixtures/parse-parity-corpus.json', import.meta.url)),
        'utf8',
    ),
);

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/**
 * The cross-module transport is ordered pairs RECURSIVELY — every object at
 * every depth becomes `[[key, value], …]` (see `encodeOrderedValue` in
 * `transform-rust.ts`); a plain JSON object is rejected by the decoder.
 * @param value - Plain config value to re-encode.
 * @returns The ordered-pair transport form; scalars pass through unchanged.
 */
function encodeOrdered(value: unknown): unknown {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            encodeOrdered(entry),
        ]);
    }
    return value;
}

describe('wasm parser artifact', () => {
    it('ships transform_source and transform_batch_json', () => {
        const wasm = loadParserWasm();
        expect(wasm, MISSING).not.toBeNull();
        expect(typeof wasm?.transform_source).toBe('function');
        expect(typeof wasm?.transform_batch_json).toBe('function');
    });

    it('replays the parse-parity corpus with the same classes as the engine records', () => {
        const wasm = loadParserWasm();
        expect(wasm, MISSING).not.toBeNull();
        if (!wasm) return;

        const mismatches: string[] = [];
        for (const record of corpus) {
            const result = JSON.parse(
                wasm.transform_source('corpus.tsx', record.source),
            ) as WasmTransformResult;
            const got = sortedUnique(result.classes);
            const expected = sortedUnique(record.classes);
            if (got.join(' ') !== expected.join(' ')) {
                mismatches.push(
                    `${record.source}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`,
                );
            }
        }
        expect(mismatches, mismatches.join('\n')).toEqual([]);
    });

    it('resolves a cross-module szv registry through transform_batch_json', () => {
        const wasm = loadParserWasm();
        expect(wasm, MISSING).not.toBeNull();
        if (!wasm) return;

        // Mirrors `szv-cross-module.test.ts` "collapses a static selection on
        // an imported factory": registry keys are import SPECIFIERS, and the
        // collapse happens on the szr() path.
        const files = [
            {
                filename: '/p/t.tsx',
                source:
                    "import { szr } from '@csszyx/runtime';\n" +
                    "import { cardSz } from './styles';\n" +
                    "export const cls = szr(cardSz({ pad: 'lg' }));",
            },
        ];
        const options = {
            mangle_vars: false,
            mangle_var_hoist_max_depth: null,
            global_var_aliases: [],
            root_dir: '/p',
            ast_budget: null,
            cross_module_statics_json: JSON.stringify([
                [
                    './styles',
                    [
                        [
                            'cardSz',
                            encodeOrdered({
                                base: { rounded: 'lg' },
                                variants: {
                                    pad: { sm: { p: 2 }, lg: { p: 8 } },
                                    tone: {
                                        red: { bg: 'red-500' },
                                        blue: { bg: 'blue-500', color: 'white' },
                                    },
                                },
                                defaultVariants: { tone: 'blue' },
                            }),
                        ],
                    ],
                ],
            ]),
            cross_module_sz_objects_json: null,
        };

        const results = JSON.parse(
            wasm.transform_batch_json(JSON.stringify(files), JSON.stringify(options)),
        ) as WasmTransformResult[];

        expect(results).toHaveLength(1);
        expect(results[0].code).toContain('"rounded-lg p-8 bg-blue-500 text-white"');
        expect(results[0].code).not.toContain('__szvPick');
    });
});
