/**
 * The class-name encoder and the mangle map's checksum, on both artifacts.
 *
 * The build runs them on the artifact it runs everything else on, so a native
 * build never loads the wasm for them. Both artifacts and the browser's Web
 * Crypto verifier must give the same answer for the same map, or a healthy
 * page reports itself tampered with.
 */
import { describe, expect, it } from 'vitest';

import { digestMangleMap } from '../../runtime/src/mangle-checksum.js';
import {
    classNameEncoder,
    computeMangleChecksum,
    computeMangleChecksumRust,
    computeMangleChecksumWasm,
    encodeClassNameRust,
    encodeClassNameWasm,
} from '../src/engine.js';
import { RUST_LANE } from './engine-parity-harness.js';

/**
 * Maps whose keys only an own-keys read gets right.
 *
 * @returns Each map with a label.
 */
function awkwardMaps(): Array<[label: string, map: Record<string, string>]> {
    const inherited = Object.create({ 'inherited-class': 'zz' }) as Record<string, string>;
    inherited['p-4'] = 'a';
    return [
        ['an empty map', {}],
        ['variant classes', { 'hover:bg-red-500': 'a', 'md:focus:ring-2': 'b' }],
        ['a key on the prototype', inherited],
        ['an own __proto__ key', JSON.parse('{"__proto__": "a", "p-4": "b"}')],
        ['a constructor key', { constructor: 'a', 'p-4': 'b' }],
        ['a character above the basic plane', { 'after:content-["\u{1F389}"]': 'a', m: 'b' }],
    ];
}

const ARTIFACTS = [
    ['wasm', encodeClassNameWasm, computeMangleChecksumWasm],
    ...(RUST_LANE ? [['rust', encodeClassNameRust, computeMangleChecksumRust] as const] : []),
] as const;

describe.each(ARTIFACTS)('the %s artifact', (_name, encode, checksum) => {
    it.each(awkwardMaps())('checksums %s as the browser does', async (_label, map) => {
        expect(checksum(map)).toBe(await digestMangleMap(map));
    });

    it('encodes every index as the other artifact does', () => {
        for (let index = 0; index < 5000; index++) {
            expect(encode(index)).toBe(encodeClassNameWasm(index));
        }
        expect([0, 51, 52, 571, 572].map(encode)).toEqual(['z', 'A', 'z9', 'A0', 'zz']);
    });
});

describe.each(['wasm', ...(RUST_LANE ? ['rust'] : [])] as const)(
    'the %s artifact a build names',
    parser => {
        it('encodes and checksums on it', () => {
            const encode = classNameEncoder({ parser });
            expect(encode(52)).toBe('z9');
            expect(computeMangleChecksum({ a: 'b' }, { parser })).toBe('95dd1eb0a569dbd2');
        });
    },
);
