import { transform } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';
import { transformSource, transformSourceTs } from '../src/migrate/ast-transformer.js';

/**
 * TRANSITIONAL (0.9.10 → 0.10.0): `csszyx migrate` rewrites legacy keys inside
 * existing `sz={{…}}` object literals to the single-way canonical. These lock
 * the rewrites and prove the result compiles to the same classes the old key
 * intended. (Remove with the normalizer at v1.)
 */
describe('migrate normalizes legacy sz prop keys', () => {
    /**
     * Both implementations on every case, asserted equal before the case
     * reads the answer. The native engine is the default, so calling the
     * dispatcher alone would leave the TypeScript this suite was written
     * against dark.
     *
     * @param src - The JSX source to migrate.
     * @returns What the TypeScript implementation wrote.
     */
    const run = (src: string) => {
        const ts = transformSourceTs(src, 'test.tsx');
        expect(transformSource(src, 'test.tsx')).toEqual(ts);
        return ts;
    };

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

    it('resolves a legacy stretch value, not just its key', () => {
        // The key rename alone leaves the marker on the value, and
        // `fontStretch: 'stretch-condensed'` compiles to an arbitrary value
        // that sets font-stretch to a word CSS does not know — the class is
        // emitted, the style is silently lost.
        const out = run("<div sz={{ font: 'stretch-condensed' }} />");
        expect(out.code).toBe("<div sz={{ fontStretch: 'condensed' }} />");
        expect(out.stats.szKeysNormalized).toBe(1);
        expect(transform({ fontStretch: 'condensed' }).className).toBe('font-stretch-condensed');
    });

    it('keeps the percentage and custom-property forms of a stretch value', () => {
        expect(run("<div sz={{ font: 'stretch-75%' }} />").code).toBe(
            "<div sz={{ fontStretch: '75%' }} />",
        );
        expect(transform({ fontStretch: '75%' }).className).toBe('font-stretch-75%');
        expect(run("<div sz={{ font: 'stretch-(--s)' }} />").code).toBe(
            "<div sz={{ fontStretch: '--s' }} />",
        );
        expect(transform({ fontStretch: '--s' }).className).toBe('font-stretch-(--s)');
    });

    it('leaves a weight value alone, because its spelling decides its class', () => {
        // `weight: '700'` is `font-700` and `weight: 700` is `font-[700]`, so
        // rewriting the value here would change what the file compiles to.
        expect(run("<div sz={{ font: '700' }} />").code).toBe("<div sz={{ weight: '700' }} />");
        expect(transform({ weight: '700' }).className).toBe('font-700');
        expect(run('<div sz={{ font: 700 }} />').code).toBe('<div sz={{ weight: 700 }} />');
        expect(run("<div sz={{ font: 'bold' }} />").code).toBe("<div sz={{ weight: 'bold' }} />");
        expect(run("<div sz={{ font: 'sans' }} />").code).toBe(
            "<div sz={{ fontFamily: 'sans' }} />",
        );
    });

    it('leaves a stretch marker with nothing after it alone', () => {
        // Neither spelling generates useful CSS, so there is nothing to gain
        // by rewriting a value that carries no keyword.
        expect(run("<div sz={{ font: 'stretch-' }} />").code).toBe(
            "<div sz={{ fontStretch: 'stretch-' }} />",
        );
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

    it('disambiguates the ambiguous passthrough `font` key by its value', () => {
        // SUGGESTION_MAP only has a prose hint for `font`, but it is resolvable
        // from the value just like the class migration resolves `font-*`. Without
        // this `font` would survive the migration unchanged.
        expect(run("<div sz={{ font: 'bold' }} />").code).toBe("<div sz={{ weight: 'bold' }} />");
        expect(run('<div sz={{ font: 600 }} />').code).toBe('<div sz={{ weight: 600 }} />');
        expect(run("<div sz={{ font: 'sans' }} />").code).toBe(
            "<div sz={{ fontFamily: 'sans' }} />",
        );
        // Migration restores the intended utilities; the removed alias itself
        // is deliberately a no-op so stale source cannot look supported.
        expect(transform({ weight: 'bold' }).className).toBe('font-bold');
        expect(transform({ fontFamily: 'sans' }).className).toBe('font-sans');
        expect(transform({ font: 'bold' }).className).toBe('');
        expect(transform({ font: 'sans' }).className).toBe('');
    });

    it('leaves a `font` key with a non-literal value for the dev-warn', () => {
        const src = '<div sz={{ font: weightVar }} />';
        const out = run(src);
        expect(out.code).toBe(src);
    });
});
