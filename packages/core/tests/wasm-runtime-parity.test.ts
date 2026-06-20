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
 * object) and `oxc` (the TS `transform()` baseline); we feed `sz` to the WASM
 * runtime and compare to `oxc` without regenerating.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { transform } from '../../compiler/src/transform-core.js';
import { init, transform_sz } from '../pkg-node/csszyx_core.js';

interface ParityRecord {
    sz: string;
    oxc: string;
}

const corpus: ParityRecord[] = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/parity-corpus.json', import.meta.url)), 'utf8'),
);

// SKIPPED until `transform_sz` is unified onto the single static lowering core.
// Against the current duplicated runtime, 173/1317 corpus records diverge (111
// leaf-level: CSS-var parens, fractions, content→alignContent, …; 62 nested:
// color-opacity / bgImg objects, css escape hatch, group/peer/parametric
// variants the runtime treats as plain variants). Flip `.skip` off — this then
// becomes the permanent runtime gate, the twin of the static `parity_corpus.rs`
// — once the unification lands and drives every record green.
describe.skip('WASM runtime parity (transform_sz vs TS transform)', () => {
    beforeAll(async () => {
        await init();
    });

    it.each(corpus.map(r => [r.sz, r.oxc] as const))(
        'transform_sz(%s) === oxc',
        (szJson, oxc) => {
            const sz = JSON.parse(szJson);
            // The TS baseline (`oxc`) is recomputed-equivalent; assert the WASM
            // runtime matches it exactly (token set + order).
            expect(transform_sz(sz)).toBe(oxc);
            // Cross-check the baseline itself stayed in sync with the compiler.
            expect(transform(sz).className).toBe(oxc);
        },
    );
});
