/**
 * Differential fuzzing: the TS lowering engine against the Rust one.
 *
 * `wasm-runtime-parity.test.ts` runs the SAME comparison over the frozen
 * parity corpus — a list of objects a person wrote down. This file generates
 * the objects instead, so the comparison covers combinations nobody thought to
 * add: a documented key drawn from the spec fixture, wrapped in a variant, next
 * to another key drawn independently.
 *
 * Why the pair is a real oracle: neither side is a copy of the other. The TS
 * engine (`transform`, shipped to the browser through `@csszyx/runtime/lowering`)
 * and the Rust engine (`transform_sz`, the build-time default) were written
 * separately against the same snippets. Where they disagree, one of them is
 * wrong — and the harness does not need to know which in order to fail.
 *
 * The first run of this harness found the `PREFIX_DROP_KEYS` family recorded in
 * `helpers/sz-known-defects.ts`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SzObject } from '../../compiler/src/transform-core.js';
import { transform } from '../../compiler/src/transform-core.js';
import { init, transform_sz } from '../pkg-node/csszyx_core.js';
import {
    createRng,
    fuzzBudget,
    generateSzObject,
    isSzObject,
    loadSzPool,
    type SzPool,
    shrinkSzObject,
} from './helpers/sz-fuzz.js';
import {
    PREFIX_DROP_KEY_SET,
    PREFIX_DROP_KEYS,
    PREFIX_DROP_PROBES,
} from './helpers/sz-known-defects.js';

/**
 * Variant vocabulary the harness is willing to compare across engines. Kept to
 * plain variants — an arbitrary variant (`[&>*]`) carries its own escaping
 * question, and a divergence there would be about the variant syntax rather
 * than about the lowering this file is aimed at.
 */
const VARIANTS: readonly string[] = [
    'hover',
    'focus',
    'active',
    'sm',
    'md',
    'lg',
    'dark',
    'group-hover',
    'motion-safe',
    'print',
];

/**
 * Both engines' answers for one object.
 *
 * A throw is an answer too: one engine refusing an input the other accepts is a
 * divergence, and swallowing it would hide the loudest kind.
 *
 * @param sz The object to lower.
 * @returns The TS and Rust class strings, or a `throw:<name>` marker.
 */
function bothEngines(sz: SzObject): { ts: string; rust: string } {
    let ts: string;
    let rust: string;
    try {
        ts = transform(sz).className;
    } catch (error) {
        ts = `throw:${(error as Error).name}`;
    }
    try {
        rust = transform_sz(sz);
    } catch (error) {
        rust = `throw:${(error as Error).name}`;
    }
    return { ts, rust };
}

/**
 * Whether the two engines disagree on this object.
 *
 * @param sz The object to lower.
 * @returns True when the two answers differ.
 */
function diverges(sz: SzObject): boolean {
    const { ts, rust } = bothEngines(sz);
    return ts !== rust;
}

/**
 * Every leaf property key, in traversal order.
 *
 * @param sz The object to walk.
 * @param out Accumulator, for the recursive call.
 * @returns The leaf keys at every depth.
 */
function leafKeys(sz: SzObject, out: string[] = []): string[] {
    for (const [key, value] of Object.entries(sz)) {
        if (isSzObject(value)) leafKeys(value, out);
        else out.push(key);
    }
    return out;
}

describe('sz differential fuzz (TS transform vs Rust transform_sz)', () => {
    let pool: SzPool;

    beforeAll(async () => {
        await init();
        pool = loadSzPool(VARIANTS);
        // `transform` warns on key/value combinations the composition invents.
        // Those warnings are correct and not what this file measures; printing
        // thousands of them would bury the report a real divergence produces.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('agrees on every generated case outside the recorded prefix-drop keys', () => {
        const { seed, cases } = fuzzBudget(4000);
        const rng = createRng(seed);
        const unexplained: string[] = [];

        for (let index = 0; index < cases; index += 1) {
            const sz = generateSzObject(rng, pool, { maxKeys: 5, maxVariantDepth: 3 });
            if (!diverges(sz)) continue;

            // Report the smallest case that still diverges, not the generated
            // one — a 5-key object with three nested variants does not say
            // which property carries the defect.
            const minimal = shrinkSzObject(sz, diverges);
            const leaves = leafKeys(minimal);
            if (leaves.length === 1 && PREFIX_DROP_KEY_SET.has(leaves[0] as string)) continue;

            const answers = bothEngines(minimal);
            unexplained.push(
                `  seed=${seed} case=${index}\n` +
                    `      sz   = ${JSON.stringify(minimal)}\n` +
                    `      ts   = ${JSON.stringify(answers.ts)}\n` +
                    `      rust = ${JSON.stringify(answers.rust)}`,
            );
            if (unexplained.length >= 10) break;
        }

        expect(
            unexplained,
            `${unexplained.length} TS↔Rust lowering divergence(s) outside the recorded ` +
                `prefix-drop keys. Replay one with ` +
                `SZ_FUZZ_SEED=${seed} SZ_FUZZ_CASES=${cases}:\n${unexplained.join('\n')}`,
        ).toEqual([]);
    });

    it('every recorded prefix-drop key still diverges', () => {
        // A key that starts agreeing has been fixed; the entry must go, or the
        // list stops describing the engines and starts hiding a regression.
        const fixed = PREFIX_DROP_PROBES.filter(([, sz]) => !diverges(sz)).map(([key]) => key);
        expect(
            fixed,
            `${fixed.length} key(s) now agree — remove them from PREFIX_DROP_KEYS`,
        ).toEqual([]);
        expect(PREFIX_DROP_PROBES.map(([key]) => key)).toEqual([...PREFIX_DROP_KEYS]);
    });
});
