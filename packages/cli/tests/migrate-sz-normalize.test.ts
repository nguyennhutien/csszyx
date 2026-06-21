import { describe, expect, it } from 'vitest';

import { transform } from '@csszyx/compiler';
import { transformSource } from '../src/migrate/ast-transformer.js';

/**
 * TRANSITIONAL (0.9.10 → 0.10.0): `csszyx migrate` rewrites legacy keys inside
 * existing `sz={{…}}` object literals to the single-way canonical. These lock
 * the rewrites and prove the result compiles to the same classes the old key
 * intended. (Remove with the normalizer at v1.)
 */
describe('migrate normalizes legacy sz prop keys', () => {
    const run = (src: string) => transformSource(src, 'test.tsx');

    it('rewrites removed boolean sugar to the canonical value-keyed form', () => {
        const out = run('<div sz={{ flex: true }} />');
        expect(out.code).toBe("<div sz={{ display: 'flex' }} />");
        expect(out.changed).toBe(true);
        expect(out.stats.szKeysNormalized).toBe(1);
        // round-trip: the canonical form compiles to what `flex: true` intended.
        expect(transform({ display: 'flex' }).className).toBe('flex');
    });

    it('renames CSS-property-name and dropped-alias keys to the short canonical', () => {
        const out = run("<div sz={{ padding: 4, fontWeight: 'bold' }} />");
        expect(out.code).toBe("<div sz={{ p: 4, weight: 'bold' }} />");
        expect(out.stats.szKeysNormalized).toBe(2);
        expect(transform({ p: 4, weight: 'bold' }).className).toBe('p-4 font-bold');
    });

    it('recurses into nested variant objects', () => {
        const out = run("<div sz={{ hover: { backgroundColor: 'red' } }} />");
        expect(out.code).toBe("<div sz={{ hover: { bg: 'red' } }} />");
        expect(out.stats.szKeysNormalized).toBe(1);
    });

    it('leaves already-canonical sz untouched', () => {
        const src = "<div sz={{ p: 4, display: 'flex' }} />";
        const out = run(src);
        expect(out.changed).toBe(false);
        expect(out.code).toBe(src);
    });

    it('leaves unknown keys and non-true sugar values untouched', () => {
        const src = "<div sz={{ customThing: 1, flex: 'maybe' }} />";
        const out = run(src);
        expect(out.changed).toBe(false);
        expect(out.code).toBe(src);
    });

    it('does not disturb the className → sz path', () => {
        const out = run('<div className="p-4 flex" />');
        expect(out.code).toContain('sz=');
        expect(out.code).not.toContain('className');
        expect(out.stats.classNamesTransformed).toBe(1);
    });
});
