/**
 * Checksum parity: the TypeScript runtime and the Rust core must derive the
 * SAME checksum from the same mangle map, for any class name the compiler can
 * produce — not only ASCII ones.
 *
 * The two halves each had tests and both passed. Rust checked itself, and the
 * runtime checked itself against a JavaScript reference that happened to sort
 * strings the same way it did. Nothing ran one into the other, so a
 * disagreement about ORDER could not fail: Rust sorts by UTF-8 bytes, which is
 * code-point order, while JavaScript's `<` compares UTF-16 code units, and the
 * two disagree once a key carries a character above the basic plane. A map that
 * differs only in ordering hashes differently, so a healthy page reports as
 * tampered.
 *
 * Class names reach these characters through arbitrary content — a
 * `content-[…]` utility carries whatever the author wrote, emoji included.
 *
 * Exotic characters are written as escapes on purpose. A private-use code point
 * does not survive every editor and copy path, and one already went missing
 * from a sibling suite once, leaving a case that passed while comparing the
 * wrong pair.
 */
import { describe, expect, it } from 'vitest';

import { computeMangleChecksumAsync } from '../../runtime/src/hydration.js';
import { compute_mangle_checksum } from '../pkg-node/csszyx_core.js';

type MangleMapLike = Record<string, string>;

/**
 * A class carrying `content`, which is how an arbitrary character reaches a
 * class name at all.
 *
 * @param inner - what the author wrote between the quotes.
 * @returns the class name a build would emit for it.
 */
function content(inner: string): string {
    return `after:content-["${inner}"]`;
}

/**
 * Every dimension the canonical form can be got wrong in, one fragment each.
 *
 * Enumerated rather than sampled. A sibling harness in this repository learned
 * that the hard way: its first version drew from the same product at random and
 * missed a real divergence across eight thousand files, because the chance of
 * drawing the deciding pair was about one in twenty thousand. The dimensions
 * here are finite, so nothing is left to luck.
 */
const FRAGMENTS: Array<[label: string, text: string]> = [
    ['empty', ''],
    ['ascii', 'a'],
    ['utility', 'p-4'],
    ['colon, as every variant class carries', 'hover:bg-red-500'],
    ['pipe', 'a|b'],
    ['backslash', 'a\\b'],
    ['digits then colon, the shape of a length prefix', '12:34'],
    ['basic plane, low', '→'],
    ['basic plane, high', ''],
    ['above the basic plane', '\u{1F389}'],
    ['above it again', '\u{1D11E}'],
    ['wide', '中'],
    ['unpaired surrogate', '\uD800'],
];

/**
 * @param map - the map both engines must agree on.
 * @returns nothing; fails the test when they disagree.
 */
async function expectAgreement(map: MangleMapLike): Promise<void> {
    expect(await computeMangleChecksumAsync(map)).toBe(compute_mangle_checksum(map));
}

describe('the canonical form, frozen on both sides', () => {
    /**
     * The same numbers the Rust crate freezes in `the_canonical_form_is_frozen`.
     *
     * This pair is what catches a stale `pkg-node`. Comparing the runtime with
     * the WebAssembly build alone cannot: change the core and skip the rebuild,
     * and a runtime written against the old form agrees with an artifact built
     * from it. Holding the numbers in the crate's own test — which runs from
     * source — and again here breaks that symmetry.
     */
    const FROZEN: Array<[name: string, map: MangleMapLike, checksum: string]> = [
        ['an empty map', {}, 'e3b0c44298fc1c14'],
        ['one entry', { a: 'b' }, '95dd1eb0a569dbd2'],
        [
            'variant classes',
            { 'hover:bg-red-500': 'a', 'md:focus:ring-2': 'b' },
            '217d2abd522e4601',
        ],
        ['a colon in the name', { 'a:b': 'c' }, '8a37856518dacc57'],
        ['a colon in the token', { a: 'b:c' }, 'b8d47370810d318b'],
        [
            'a character above the basic plane beside a high one inside it',
            { [content('\u{1F389}')]: 'a', [content('')]: 'b' },
            '5bc13806268685f8',
        ],
    ];

    it.each(FROZEN)('the runtime derives the frozen checksum for %s', async (_n, map, sum) => {
        expect(await computeMangleChecksumAsync(map)).toBe(sum);
    });

    it.each(FROZEN)('the core derives the frozen checksum for %s', (_n, map, sum) => {
        // Red here with the runtime green means pkg-node was not rebuilt.
        expect(compute_mangle_checksum(map)).toBe(sum);
    });
});

describe('mangle checksum parity (TypeScript vs the Rust core)', () => {
    it('agrees on every pair of fragments, as a name and as a token', async () => {
        // The two names share a prefix and differ inside the fragment, so the
        // fragment is what decides their order. Distinguishing them by a
        // leading letter instead would settle every comparison on that letter
        // and the ordering would never be exercised at all — which is what an
        // earlier draft of this suite did, and why reintroducing the ordering
        // bug turned only one case red.
        for (const [, left] of FRAGMENTS) {
            for (const [, right] of FRAGMENTS) {
                if (left === right) continue;
                await expectAgreement({ [`k${left}z`]: right, [`k${right}z`]: left });
            }
        }
    });

    it.each(FRAGMENTS)('agrees on a single entry built from %s', async (_label, fragment) => {
        await expectAgreement({ [fragment || 'k']: fragment });
        await expectAgreement({ [`k${fragment}`]: `v${fragment}` });
    });

    it('agrees on a map large enough to exercise the sort', async () => {
        const map: MangleMapLike = {};
        for (let i = 0; i < 500; i++) {
            map[`${content(String.fromCodePoint(0x1f300 + i))}-${i}`] = `t${i}`;
        }
        await expectAgreement(map);
    });

    it('agrees on keys that are prefixes of one another', async () => {
        await expectAgreement({ p: 'a', 'p-4': 'b', 'p-40': 'c', 'p-40-x': 'd' });
    });

    it('answers the same thing twice, and does not depend on insertion order', async () => {
        const forward: MangleMapLike = { 'p-4': 'a', [content('\u{1F389}')]: 'b', 'm-2': 'c' };
        const reversed: MangleMapLike = { 'm-2': 'c', [content('\u{1F389}')]: 'b', 'p-4': 'a' };
        const first = await computeMangleChecksumAsync(forward);

        expect(await computeMangleChecksumAsync(forward)).toBe(first);
        expect(await computeMangleChecksumAsync(reversed)).toBe(first);
        expect(first).toBe(compute_mangle_checksum(reversed));
    });

    it('reads only the keys the build emitted, not one carried on a prototype', async () => {
        const own: MangleMapLike = Object.create({ 'inherited-class': 'zz' }) as MangleMapLike;
        own['p-4'] = 'a';
        expect(await computeMangleChecksumAsync(own)).toBe(compute_mangle_checksum({ 'p-4': 'a' }));
    });

    it.each([
        ['a private-use character', 'k\uE000z'],
        ['the last two code points in the basic plane', 'k\uFFFEz'],
    ])('orders an unpaired surrogate against %s the way the core does', async (_l, other) => {
        // Ordering by the text JavaScript holds gets this wrong: an unpaired
        // surrogate survives in a JavaScript string and does not survive the
        // trip into the core, so the two sides would be ordering different
        // characters. Ordering by the bytes that get hashed settles it.
        await expectAgreement({ 'k\uD800z': 'a', [other]: 'b' });
    });

    it('cannot be asked about a name that collides with its own replacement', async () => {
        // Recorded as a limit rather than asserted as behaviour. `k\uD800z` and
        // `k\uFFFDz` are two names in JavaScript and encode to the same bytes,
        // so the core receives ONE entry where the runtime has two. No ordering
        // can reconcile a map that changed size crossing the boundary. Nothing
        // reads source text can produce such a name, which is why this is a
        // note and not a defect.
        const map = { 'k\uD800z': 'a', 'k\uFFFDz': 'b' };
        expect(Object.keys(map)).toHaveLength(2);
        expect(await computeMangleChecksumAsync(map)).not.toBe(compute_mangle_checksum(map));
    });

    it('normalises an unpaired surrogate the same way on both sides', async () => {
        // Neither engine can encode one, and both replace it. Recorded rather
        // than relied on: a compiler reading source text cannot produce a class
        // name holding one, and the three spellings below collapse together,
        // which is only harmless while that stays true.
        const high = { 'a\uD800b': 'x' };
        const low = { 'a\uDC00b': 'x' };
        const replaced = { 'a�b': 'x' };
        await expectAgreement(high);
        await expectAgreement(low);
        await expectAgreement(replaced);
        expect(await computeMangleChecksumAsync(high)).toBe(
            await computeMangleChecksumAsync(replaced),
        );
    });
});

describe('mangle checksum parity, over generated maps', () => {
    /**
     * A seeded generator, so a failure replays exactly.
     *
     * @param seed - the starting state.
     * @returns a function yielding the next integer below its argument.
     */
    function randomBelow(seed: number): (bound: number) => number {
        let state = seed >>> 0;
        return (bound: number): number => {
            // A linear congruential step, the constants Numerical Recipes uses.
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state % bound;
        };
    }

    /**
     * @param next - the seeded generator.
     * @returns a class-name-shaped string built from the fragments above.
     */
    function randomText(next: (bound: number) => number): string {
        let text = '';
        const parts = next(4) + 1;
        for (let i = 0; i < parts; i++) {
            const fragment = FRAGMENTS[next(FRAGMENTS.length)];
            text += fragment === undefined ? '' : fragment[1];
        }
        return text;
    }

    it.each([1, 7, 42, 2026])('agrees on generated maps from seed %i', async seed => {
        const next = randomBelow(seed);
        for (let round = 0; round < 40; round++) {
            const map: MangleMapLike = {};
            const entries = next(6) + 1;
            for (let i = 0; i < entries; i++) {
                // The counter goes last. Leading it would decide every
                // comparison before the generated text was reached, and the
                // ordering these maps exist to exercise would go untested.
                map[`${randomText(next)}#${i}`] = randomText(next);
            }
            await expectAgreement(map);
        }
    });
});
