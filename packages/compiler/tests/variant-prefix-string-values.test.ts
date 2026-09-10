/**
 * A variant prefix belongs on every class the variant wraps, whatever the
 * value's type.
 *
 * Eleven keys dropped it when — and only when — the value was a string. The
 * same key kept it for a numeric value and for an object value, and
 * `insetShadowColor` kept it where `shadowColor` lost it, so no reading of the
 * three facts describes a rule.
 *
 * The expectations below are written out rather than derived from an engine:
 * the bare utility comes from the spec snippets, and a variant prefix goes in
 * front of it. Deriving them from either engine would assert only that the code
 * agrees with itself.
 *
 * This suite exercises the TypeScript `transform()` because that is where the
 * defect was, and that path is the one shipped to the browser through
 * `@csszyx/runtime/lowering` — so before this was fixed, the same object lowered
 * with its prefix at build time and without it at runtime. The final block
 * cross-checks the native and wasm artifacts of the Rust engine, which already
 * answered correctly, so the fix is proven to converge the lanes rather than to
 * move one of them.
 */
import { describe, expect, it } from 'vitest';
import type { SzObject } from '../src/transform-core.js';
import { transform } from '../src/transform-core.js';
import { ENGINES, normalizeEmit } from './engine-parity-harness.js';

const lower = (sz: SzObject): string => transform(sz).className;

/** `[key, string value, the bare utility the spec snippets document]`. */
const STRING_VALUED: readonly (readonly [string, string, string])[] = [
    ['backdropBrightness', '1.25', 'backdrop-brightness-[1.25]'],
    ['backdropContrast', '--c', 'backdrop-contrast-(--c)'],
    ['backdropSaturate', '1.5', 'backdrop-saturate-[1.5]'],
    ['brightness', '--c', 'brightness-(--c)'],
    ['contrast', '1.5', 'contrast-[1.5]'],
    ['saturate', '--c', 'saturate-(--c)'],
    ['scale', '1.5', 'scale-[1.5]'],
    ['shadowColor', 'blue-500', 'shadow-blue-500'],
    ['shadowColor', '--c', 'shadow-(color:--c)'],
    ['fromPos', '300px', 'from-[300px]'],
    ['viaPos', '--via-pos', 'via-(--via-pos)'],
    ['toPos', '50%', 'to-50%'],
    ['toPos', '12.5%', 'to-[12.5%]'],
];

describe('variant prefix on string-valued effect and gradient keys', () => {
    it.each(STRING_VALUED)('bare { %s: %s } → %s', (key, value, bare) => {
        // The utility itself is unchanged by this fix; pin it so a later change
        // to the prefix cannot quietly rewrite the class it prefixes.
        expect(lower({ [key]: value })).toBe(bare);
    });

    it.each(STRING_VALUED)('{ sm: { %s: %s } } keeps the sm prefix', (key, value, bare) => {
        expect(lower({ sm: { [key]: value } })).toBe(`sm:${bare}`);
    });

    it.each(STRING_VALUED)('nested variants both apply to { %s: %s }', (key, value, bare) => {
        expect(lower({ md: { hover: { [key]: value } } })).toBe(`md:hover:${bare}`);
    });

    it('prefixes a string-valued key sitting beside a numeric one', () => {
        // The numeric branch always kept its prefix, so a mixed object is where
        // the inconsistency was visible in one line of output.
        expect(lower({ sm: { toPos: '300px', fromPos: 25 } })).toBe('sm:to-[300px] sm:from-25%');
    });
});

describe('value forms that always kept the prefix', () => {
    it.each([
        [{ sm: { toPos: 50 } }, 'sm:to-50%'],
        [{ sm: { scale: 75 } }, 'sm:scale-75'],
        [{ sm: { brightness: 110 } }, 'sm:brightness-110'],
        [{ sm: { shadowColor: { color: 'blue-500', op: 50 } } }, 'sm:shadow-blue-500/50'],
        [{ sm: { insetShadowColor: 'blue-500' } }, 'sm:inset-shadow-blue-500'],
        [{ sm: { textShadowColor: 'blue-500' } }, 'sm:text-shadow-blue-500'],
        [{ sm: { scale: '3d' } }, 'sm:scale-3d'],
    ] as const)('%o → %s', (sz, expected) => {
        expect(lower(sz as SzObject)).toBe(expected);
    });
});

describe('both Rust artifacts already agreed, and still do', () => {
    // Not a restatement of the cases above: it asserts the TS answer is the
    // answer the shipped build-time engine gives, on both of its artifacts.
    // `ENGINES` degrades to wasm alone when the native binding is missing, and
    // is hard-failed under CI; locally, run `pnpm --filter @csszyx/core
    // native:build` before trusting a green here.
    it.each(ENGINES)('%s emits what transform() emits', (_lane, engine) => {
        for (const [key, value, bare] of STRING_VALUED) {
            // Serialise the whole object rather than splicing the key in raw.
            // The key is a plain identifier in every case above, so the two
            // spellings parse the same today — but a source string built by
            // concatenating an unescaped name is the shape CodeQL flags as
            // `js/bad-code-sanitization`, and it stops being equivalent the
            // moment this table grows a key needing quotes, such as
            // `@container` or `[&>*]`.
            const source = `export const A = () => <div sz={${JSON.stringify({
                sm: { [key]: value },
            })}} />;`;
            const emitted = normalizeEmit(engine(source, 'variant-prefix.tsx').code ?? '');
            expect(emitted, `${key}: ${value}`).toContain(`sm:${bare}`);
        }
    });
});
