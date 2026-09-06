/**
 * `@csszyx/runtime/split` exists to publish the className half of the class
 * toolkit WITHOUT the sz-object half. Both halves live in one source file, so
 * nothing but this test stops a later edit from re-exporting `splitBoxSz` here
 * and quietly widening the entry. The barrel's own tree-shaking does not cover
 * it: under `require()` nothing shakes, which is where this entry pays
 * (22 515 B gzip against the barrel's 30 876 B).
 */
import { describe, expect, it } from 'vitest';
import * as split from '../src/split.js';

const SZ_ADAPTERS = ['classifySzKey', 'splitBoxSz', 'hasSz', 'pickSz', 'omitSz'];

describe('@csszyx/runtime/split surface', () => {
    it('exports exactly the className toolkit', () => {
        expect(Object.keys(split).sort()).toEqual([
            'classify',
            'has',
            'normalizeBase',
            'omit',
            'pick',
            'splitBox',
            'stripVariant',
        ]);
    });

    it.each(SZ_ADAPTERS)('does not re-export the sz adapter %s', name => {
        expect(split).not.toHaveProperty(name);
    });

    it('answers the same as the barrel for the same token', async () => {
        const barrel = await import('../src/index.js');
        expect(split.classify('placeholder-gray-400')).toEqual(
            barrel.classify('placeholder-gray-400'),
        );
        expect(split.splitBox('m-4 p-2')).toEqual(barrel.splitBox('m-4 p-2'));
    });
});
