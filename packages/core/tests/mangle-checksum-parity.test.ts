/**
 * Checksum parity: the TypeScript runtime and the Rust core must derive the
 * SAME checksum from the same mangle map, for any class name the compiler can
 * produce — not only ASCII ones.
 *
 * The two halves each had tests and both passed. Rust checked itself, and the
 * runtime checked itself against a JavaScript reference that happened to sort
 * strings the same way it did. Nothing ran one into the other, so a disagreement
 * about ORDER could not fail: Rust sorts by UTF-8 bytes, which is code-point
 * order, while JavaScript's `<` compares UTF-16 code units, and the two disagree
 * once a key carries a character above the BMP. A map that differs only in
 * ordering hashes differently, so a healthy page reports as tampered.
 *
 * Class names reach these characters through arbitrary content — a `content-[…]`
 * utility carries whatever the author wrote, emoji included.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { computeMangleChecksumAsync } from '../../runtime/src/hydration.js';
import { compute_mangle_checksum, init } from '../pkg-node/csszyx_core.js';

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

const CASES: Array<[name: string, map: MangleMapLike]> = [
    ['ascii only', { 'p-4': 'a', 'm-2': 'b', flex: 'c' }],
    ['empty map', {}],
    ['single entry', { 'p-4': 'a' }],
    [
        'variant classes, whose names all carry a colon',
        {
            'hover:bg-red-500': 'a',
            'md:focus:ring-2': 'b',
            'group-hover:text-sm': 'c',
        },
    ],
    ['a key carrying the canonical separator', { 'a|b': 'x', 'a:b': 'y' }],
    ['keys that are prefixes of one another', { p: 'a', 'p-4': 'b', 'p-40': 'c' }],
    ['keys differing only by case', { 'P-4': 'a', 'p-4': 'b' }],
    [
        'non-ascii inside the basic plane',
        {
            [content('→')]: 'a',
            [content('é')]: 'b',
            [content('中')]: 'c',
        },
    ],
    ['a character above the basic plane', { [content('🎉')]: 'a', 'p-4': 'b' }],
    [
        'above the plane beside a high one inside it',
        {
            [content('🎉')]: 'a',
            [content('')]: 'b',
        },
    ],
    [
        'several characters above the plane',
        {
            [content('🎉')]: 'a',
            [content('𝄞')]: 'b',
            [content('🚀')]: 'c',
        },
    ],
];

describe('mangle checksum parity (TypeScript vs the Rust core)', () => {
    beforeAll(async () => {
        await init();
    });

    it.each(CASES)('agrees on %s', async (_name, map) => {
        expect(await computeMangleChecksumAsync(map)).toBe(compute_mangle_checksum(map));
    });

    it('agrees on a map large enough to exercise the sort', async () => {
        const map: MangleMapLike = {};
        for (let i = 0; i < 500; i++)
            map[`${content(String.fromCodePoint(0x1f300 + i))}-${i}`] = `t${i}`;
        expect(await computeMangleChecksumAsync(map)).toBe(compute_mangle_checksum(map));
    });

    it('answers the same thing twice, and does not depend on insertion order', async () => {
        const forward: MangleMapLike = { 'p-4': 'a', [content('🎉')]: 'b', 'm-2': 'c' };
        const reversed: MangleMapLike = { 'm-2': 'c', [content('🎉')]: 'b', 'p-4': 'a' };
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
});
