/**
 * Relational performance invariant for the wasm parser (tdd.md TDD-6).
 *
 * No wall-clock constants: both artifacts of the SAME engine run the SAME
 * batch in the SAME process, interleaved, so machine speed and runner load
 * cancel out of the ratio. Measured baseline (2026-08-12, arm64 devcontainer):
 * wasm ≈ 3–4.1× native across 25–800-file corpora, the gap being rayon
 * parallelism the wasm build does not get. The 15× bound is ~4× above that —
 * wide enough for a loaded shared runner, tight enough to catch the two real
 * regression shapes, which multiply rather than creep: a debug-profile wasm
 * artifact slipping into the build, or the JSON boundary going quadratic.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const requireFromHere = createRequire(import.meta.url);

const wasmEntry = fileURLToPath(new URL('../pkg-parser/csszyx_core.js', import.meta.url));

interface ParserWasm {
    transform_batch_json(filesJson: string, optionsJson: string): string;
}

interface NativeModule {
    transformBatch(
        files: Array<{ filename: string; source: string }>,
        options?: unknown,
    ): unknown[];
}

function loadLanes(): { wasm: ParserWasm; native: NativeModule } | null {
    if (!existsSync(wasmEntry)) return null;
    try {
        return {
            wasm: requireFromHere(wasmEntry) as ParserWasm,
            native: requireFromHere('../native/index.js') as NativeModule,
        };
    } catch {
        return null;
    }
}

const lanes = loadLanes();

/**
 * A component file with a realistic mix of static sz and plain JSX.
 *
 * @param i - Index used to vary filenames and values.
 * @returns One synthetic transform input file.
 */
function makeFile(i: number): { filename: string; source: string } {
    const rows = Array.from(
        { length: 10 },
        (_, j) =>
            `  <div sz={{ p: ${j % 9}, m: ${j % 5}, bg: 'slate-${((j % 9) + 1) * 100}', ` +
            `hover: { bg: 'slate-200' } }}>row ${j}</div>`,
    ).join('\n');
    return {
        filename: `/proj/C${i}.tsx`,
        source: `export function C${i}() {\n  return (<section sz={{ p: 6 }}>\n${rows}\n</section>);\n}\n`,
    };
}

const FILES = Array.from({ length: 40 }, (_, i) => makeFile(i));
const FILES_JSON = JSON.stringify(FILES);
const OPTIONS_JSON = JSON.stringify({
    mangle_vars: false,
    mangle_var_hoist_max_depth: null,
    global_var_aliases: [],
    root_dir: null,
    ast_budget: null,
    cross_module_statics_json: null,
    cross_module_sz_objects_json: null,
});

function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

describe('wasm parser relational performance', () => {
    it.runIf(lanes !== null)('stays within 15x of the native batch on the same corpus', () => {
        if (!lanes) return;
        const REPS = 5;
        const wasmSamples: number[] = [];
        const nativeSamples: number[] = [];

        // Warm both lanes so instantiation and first-call JIT are not counted.
        lanes.wasm.transform_batch_json(FILES_JSON, OPTIONS_JSON);
        lanes.native.transformBatch(FILES);

        // Interleave so a mid-run load spike hits both lanes alike.
        for (let rep = 0; rep < REPS; rep++) {
            let start = process.hrtime.bigint();
            lanes.native.transformBatch(FILES);
            nativeSamples.push(Number(process.hrtime.bigint() - start) / 1e6);

            start = process.hrtime.bigint();
            lanes.wasm.transform_batch_json(FILES_JSON, OPTIONS_JSON);
            wasmSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }

        const wasmMs = median(wasmSamples);
        const nativeMs = median(nativeSamples);
        // +50ms flat margin keeps a sub-millisecond native median from turning
        // the ratio into a coin flip on a noisy runner.
        expect(
            wasmMs,
            `wasm ${wasmMs.toFixed(1)}ms vs native ${nativeMs.toFixed(1)}ms — ` +
                'a multiple this size means a debug-profile artifact or a quadratic boundary, not noise',
        ).toBeLessThanOrEqual(nativeMs * 15 + 50);
    });
});
