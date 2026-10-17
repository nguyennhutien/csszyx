/**
 * WASM runtime parity: every sz object in the parity corpus must lower to the
 * SAME className through the Rust runtime `transform_sz` (WASM, the production
 * path used by `@csszyx/compiler` compiler.ts and re-exported from `csszyx`) as
 * through the TypeScript `transform()` source-of-truth.
 *
 * This is the runtime-side twin of the static oracle `parity_corpus.rs` (which
 * replays the same corpus through `lower_static_sz_object`). Together they gate
 * BOTH Rust forward paths against the TS oracle, so a divergence in either —
 * whether a latent gap or future drift — fails CI. The corpus carries `sz` (raw
 * object) and `runtime` (the TS `transform()` baseline); we feed `sz` to the
 * WASM runtime and compare to `runtime` without regenerating.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { transform } from '../../compiler/src/transform-core.js';
import { init, transform_sz } from '../pkg-parser/csszyx_core.js';

interface ParityRecord {
    sz: string;
    runtime: string;
}

const corpus: ParityRecord[] = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/parity-corpus.json', import.meta.url)), 'utf8'),
);

// `transform_sz` is a thin adapter over the single static lowering core
// (transformer.rs → convert_runtime_object → lower_static_sz_object), so every
// corpus record lowers identically through the runtime WASM path and the TS
// source-of-truth. This is the permanent runtime gate, the twin of the static
// `parity_corpus.rs` — a divergence in either fails CI.
describe('WASM runtime parity (transform_sz vs TS transform)', () => {
    beforeAll(async () => {
        await init();
    });

    it.each(corpus.map(r => [r.sz, r.runtime] as const))(
        'transform_sz(%s) === runtime',
        (szJson, runtime) => {
            const sz = JSON.parse(szJson);
            // The TS baseline (`runtime`) is recomputed-equivalent; assert the
            // WASM runtime matches it exactly (token set + order).
            expect(transform_sz(sz)).toBe(runtime);
            // Cross-check the baseline itself stayed in sync with the compiler.
            expect(transform(sz).className).toBe(runtime);
        },
    );
});
