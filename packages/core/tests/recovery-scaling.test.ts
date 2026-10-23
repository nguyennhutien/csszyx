/**
 * Placing `szRecover` elements grows with the file, on both artifacts
 * (tdd.md TDD-2, TDD-6).
 *
 * `tests/recovery_scaling.rs` holds the same relation for the crate; this
 * holds it for what ships: the native addon and the wasm build, each timed
 * against itself at two sizes in one run, so machine speed cancels out. Ten
 * times the elements in ten times the source cost about ten times as much
 * when each element is placed by a lookup; placing each by scanning the
 * source before it multiplies that by the element count again.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type SourceFile = { filename: string; source: string };

interface ParserWasm {
    transform_batch_json(filesJson: string, optionsJson: string): string;
}

interface NativeModule {
    transformBatch(files: SourceFile[]): Array<{ code: string }>;
}

const wasmEntry = fileURLToPath(new URL('../pkg-parser/csszyx_core.js', import.meta.url));

const wasm = existsSync(wasmEntry)
    ? (createRequire(import.meta.url)(wasmEntry) as ParserWasm)
    : null;
const native = (await import('../native/index.js').catch(() => null)) as NativeModule | null;

const OPTIONS_JSON = JSON.stringify({
    mangle_vars: false,
    mangle_var_hoist_max_depth: null,
    global_var_aliases: [],
    ast_budget: null,
    cross_module_statics_json: null,
    cross_module_sz_objects_json: null,
});

/**
 * A component of `rows` recovered elements, one per line.
 *
 * @param rows - How many elements.
 * @returns One transform input file.
 */
function page(rows: number): SourceFile {
    const body = Array.from(
        { length: rows },
        (_, row) => `    <li szRecover="csr" sz={{ p: ${row % 8} }}>row ${row}</li>`,
    ).join('\n');
    return {
        filename: '/repo/src/List.tsx',
        source: `export const List = () => (\n  <ul>\n${body}\n  </ul>\n);\n`,
    };
}

const tokensIn = (code: string): number => code.split('data-sz-recovery-token="').length - 1;

/**
 * @param file - One source file.
 * @returns What the native addon rewrote it to.
 */
function viaNative(file: SourceFile): string {
    return native?.transformBatch([file])[0]?.code ?? '';
}

/**
 * @param file - One source file.
 * @returns What the wasm build rewrote it to.
 */
function viaWasm(file: SourceFile): string {
    const json = wasm?.transform_batch_json(JSON.stringify([file]), OPTIONS_JSON) ?? '[]';
    return (JSON.parse(json) as Array<{ code: string }>)[0]?.code ?? '';
}

/** Each artifact, or `null` when it is not built. */
const LANES: Array<[string, ((file: SourceFile) => string) | null]> = [
    ['native', native ? viaNative : null],
    ['wasm', wasm ? viaWasm : null],
];

describe('placing recovered elements', () => {
    it.each(LANES)('grows with the file on the %s artifact', (name, transform) => {
        expect(transform, `the ${name} artifact is not built`).not.toBeNull();
        if (!transform) return;
        const small = page(200);
        const large = page(2000);
        const timed = (file: SourceFile, rows: number): number => {
            const started = process.hrtime.bigint();
            const code = transform(file);
            const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
            expect(tokensIn(code)).toBe(rows);
            return elapsed;
        };
        timed(small, 200);
        let smallBest = Number.POSITIVE_INFINITY;
        let largeBest = Number.POSITIVE_INFINITY;
        // Interleaved, the fastest of three: a slow stretch falls on both sizes.
        for (let run = 0; run < 3; run++) {
            smallBest = Math.min(smallBest, timed(small, 200));
            largeBest = Math.min(largeBest, timed(large, 2000));
        }
        const ratio = largeBest / smallBest;
        expect(
            ratio,
            `10x the elements cost ${ratio.toFixed(1)}x (${smallBest.toFixed(2)} -> ${largeBest.toFixed(2)} ms); linear is about 10x`,
        ).toBeLessThan(30);
    });
});
