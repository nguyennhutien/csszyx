/**
 * Metamorphic relations over `sz` lowering.
 *
 * `sz` → Tailwind has no independent oracle. Tailwind is not a specification of
 * `sz`, the parity corpus is a snapshot of what the engines already do, and an
 * example-based test only locks the pairs somebody thought to write down. A
 * metamorphic relation sidesteps the missing oracle: instead of asking whether
 * ONE output is right, it transforms the input in a known way and asserts the
 * output changes in the way that transformation implies.
 *
 * That the technique earns its place here is measurable rather than assumed.
 * `MR-1` alone, run on the TypeScript engine with NO second engine to compare
 * against, flags 22 of the 47 documented string-valued cases for the keys in
 * `helpers/sz-known-defects.ts` — the same defect family the differential
 * harness found by comparing two engines.
 *
 * Every relation runs against BOTH engines, because a relation that holds on
 * one lane and not the other is exactly the shape of bug this repo keeps
 * producing.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SzObject } from '../../compiler/src/transform-core.js';
import { deepMergeSzObjects, transform } from '../../compiler/src/transform-core.js';
import { init, transform_sz } from '../pkg-node/csszyx_core.js';
import { createRng, generateSzObject, loadSzPool, type SzPool } from './helpers/sz-fuzz.js';
import { PREFIX_DROP_KEY_SET } from './helpers/sz-known-defects.js';

// Lowering entry points under test, by lane name. A line comment rather than a
// JSDoc block: the jsdoc rule reads the arrow signature in the type annotation
// as a function needing @param/@returns, and documenting a lane table that way
// says nothing.
const ENGINES: readonly (readonly [string, (sz: SzObject) => string])[] = [
    ['ts', (sz: SzObject) => transform(sz).className],
    ['rust', (sz: SzObject) => transform_sz(sz)],
];

/** Variants used for wrapping. Plain forms only; see the differential harness. */
const VARIANTS: readonly string[] = ['hover', 'focus', 'md', 'lg', 'dark'];

/** Cases drawn per relation. Small on purpose — each relation runs per engine. */
const DRAWS = 400;

/**
 * Splits a className into its tokens.
 *
 * @param className A space-separated class string.
 * @returns The non-empty tokens.
 */
function tokens(className: string): string[] {
    return className.split(' ').filter(Boolean);
}

describe('metamorphic relations on sz lowering', () => {
    let pool: SzPool;

    beforeAll(async () => {
        await init();
        pool = loadSzPool(VARIANTS);
        // Composition invents key/value pairs nobody would author, and the
        // engine is right to warn about them. The warnings are not what this
        // file measures.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    /**
     * Draws single-key objects, skipping the keys whose recorded defect this
     * file is not re-reporting.
     *
     * @param rng Seeded generator.
     * @returns A single-key `sz` object.
     */
    function drawSingleKey(rng: () => number): SzObject {
        for (;;) {
            const chosen = pool.cases[Math.floor(rng() * pool.cases.length)];
            if (chosen !== undefined && !PREFIX_DROP_KEY_SET.has(chosen.key)) {
                return { [chosen.key]: chosen.value };
            }
        }
    }

    describe.each(ENGINES)('%s engine', (_lane, lower) => {
        it('MR-1 · wrapping a key in one variant prefixes every token, and only that', () => {
            const rng = createRng(0x4d523100);
            const broken: string[] = [];

            for (let draw = 0; draw < DRAWS; draw += 1) {
                const base = drawSingleKey(rng);
                const before = tokens(lower(base));
                const after = tokens(lower({ hover: base }));
                const expected = before.map(token => `hover:${token}`);
                if (JSON.stringify(after) !== JSON.stringify(expected)) {
                    broken.push(
                        `  sz ${JSON.stringify(base)}\n` +
                            `      bare    = ${before.join(' ')}\n` +
                            `      wrapped = ${after.join(' ')}\n` +
                            `      implied = ${expected.join(' ')}`,
                    );
                }
                if (broken.length >= 5) break;
            }

            expect(broken, `${broken.length} case(s) break MR-1:\n${broken.join('\n')}`).toEqual(
                [],
            );
        });

        it('MR-2 · a second variant level accumulates onto the first', () => {
            const rng = createRng(0x4d523200);
            const broken: string[] = [];

            for (let draw = 0; draw < DRAWS; draw += 1) {
                const base = drawSingleKey(rng);
                const one = tokens(lower({ hover: base }));
                const two = tokens(lower({ md: { hover: base } }));
                const expected = one.map(token => `md:${token}`);
                // Prefixes compose; the token COUNT must not change. A variant
                // that duplicated its group would show up here as growth.
                if (JSON.stringify(two) !== JSON.stringify(expected)) {
                    broken.push(
                        `  sz ${JSON.stringify(base)}\n` +
                            `      one level  = ${one.join(' ')}\n` +
                            `      two levels = ${two.join(' ')}\n` +
                            `      implied    = ${expected.join(' ')}`,
                    );
                }
                if (broken.length >= 5) break;
            }

            expect(broken, `${broken.length} case(s) break MR-2:\n${broken.join('\n')}`).toEqual(
                [],
            );
        });

        it('MR-3 · writing two keys in either order yields the same token set', () => {
            const rng = createRng(0x4d523300);
            const broken: string[] = [];

            for (let draw = 0; draw < DRAWS; draw += 1) {
                const first = drawSingleKey(rng);
                const second = drawSingleKey(rng);
                const [keyA] = Object.keys(first);
                const [keyB] = Object.keys(second);
                if (keyA === keyB) continue;

                const forward = tokens(lower({ ...first, ...second })).sort();
                const reverse = tokens(lower({ ...second, ...first })).sort();
                if (JSON.stringify(forward) !== JSON.stringify(reverse)) {
                    broken.push(
                        `  ${keyA} + ${keyB}\n` +
                            `      forward = ${forward.join(' ')}\n` +
                            `      reverse = ${reverse.join(' ')}`,
                    );
                }
                if (broken.length >= 5) break;
            }

            expect(broken, `${broken.length} case(s) break MR-3:\n${broken.join('\n')}`).toEqual(
                [],
            );
        });

        it('MR-4 · merging an object with itself does not change what it lowers to', () => {
            const rng = createRng(0x4d523400);
            const broken: string[] = [];

            for (let draw = 0; draw < DRAWS; draw += 1) {
                const sz = generateSzObject(rng, pool, { maxKeys: 3, maxVariantDepth: 2 });
                if (containsRecordedKey(sz)) continue;
                const once = lower(sz);
                const merged = lower(deepMergeSzObjects(sz, structuredClone(sz)));
                if (once !== merged) {
                    broken.push(
                        `  sz ${JSON.stringify(sz)}\n` +
                            `      once   = ${once}\n` +
                            `      merged = ${merged}`,
                    );
                }
                if (broken.length >= 5) break;
            }

            expect(broken, `${broken.length} case(s) break MR-4:\n${broken.join('\n')}`).toEqual(
                [],
            );
        });
    });

    it('MR-5 · deepMergeSzObjects is structurally idempotent', () => {
        // Engine-independent: this is a property of the merge helper both the
        // static and the runtime lane call before lowering anything.
        const rng = createRng(0x4d523500);
        for (let draw = 0; draw < DRAWS; draw += 1) {
            const sz = generateSzObject(rng, pool, { maxKeys: 4, maxVariantDepth: 3 });
            expect(deepMergeSzObjects(sz, structuredClone(sz))).toEqual(sz);
        }
    });
});

/**
 * Whether any leaf key in `sz` is one of the recorded prefix-drop keys.
 *
 * @param sz The object to walk.
 * @returns True when a recorded key appears at any depth.
 */
function containsRecordedKey(sz: SzObject): boolean {
    for (const [key, value] of Object.entries(sz)) {
        if (typeof value === 'object' && value !== null) {
            if (containsRecordedKey(value)) return true;
        } else if (PREFIX_DROP_KEY_SET.has(key)) {
            return true;
        }
    }
    return false;
}
