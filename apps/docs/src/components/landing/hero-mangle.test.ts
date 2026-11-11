/**
 * The hero's mangle phase shows what the build's mangler writes: one token per
 * class, the same token for the same class in every example.
 */
import { describe, expect, it } from 'vitest';

import { compileData } from './hero-compile-data.js';
import { mangledClassList } from './hero-mangle.js';

/** @returns A token source that counts up, as the hero's does. */
function tokens(): () => string {
    let index = 0;
    return () => `t${index++}`;
}

describe('the hero mangle phase', () => {
    it.each(compileData.map(({ tw }) => [tw]))('writes one token per class of %s', tw => {
        const mangled = mangledClassList(tw, new Map(), tokens());
        expect(mangled.split(' ')).toHaveLength(tw.split(' ').length);
    });

    it('gives the same class the same token across examples, and two classes two', () => {
        const cache = new Map<string, string>();
        const next = tokens();
        const first = mangledClassList(
            'focus-visible:ring-2 focus-visible:ring-rose-500',
            cache,
            next,
        );
        const second = mangledClassList('focus-visible:ring-rose-500 p-4', cache, next);
        expect(first).toBe('t0 t1');
        expect(second).toBe('t1 t2');
    });
});
