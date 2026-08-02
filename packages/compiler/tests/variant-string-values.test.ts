/**
 * String values under variant keys: the colon-join contract, on every engine.
 *
 * A string value under a variant key is a ready-made utility to prefix —
 * `{ hover: 'translate-x-full' }` → `hover:translate-x-full`. Field report
 * (0.11.11): only literal `KNOWN_VARIANTS` members got the colon; every other
 * variant spelling — `data-[ending-style]`, `aria-[pressed]`, `group-hover`,
 * `[&>li]`, `min-[900px]` — joined with a dash instead, minting classes no
 * stylesheet declares, silently. The native engine dash-joined even `hover`.
 * The same report's second bug: a negative utility keyword under any variant
 * hoisted its minus in front of the whole selector (`-hover:translate-x-full`)
 * on the JS lanes, while Rust placed it correctly.
 *
 * Both fixes are pinned here as three-engine parity: the decision lives in
 * `variantStringPrefix` (transform-core.ts) and `variant_string_prefix`
 * (lower.rs), which must agree shape for shape.
 */
import { describe, expect, it } from 'vitest';
import { transformSourceCode } from '../src/transform.js';
import { variantStringPrefix } from '../src/transform-core.js';
import { transformOxc } from '../src/transform-oxc.js';
import { isRustTransformAvailable, transformRust } from '../src/transform-rust.js';

/** [sz object source, expected className] — the Tailwind-valid output. */
const VARIANT_STRING_CASES: ReadonlyArray<readonly [string, string]> = [
    // Known variants: the historically working form, unchanged.
    ["{ hover: 'translate-x-full' }", 'hover:translate-x-full'],
    ["{ dark: 'sr-only' }", 'dark:sr-only'],
    // Arbitrary data/aria attribute variants — the report's Bug 1.
    ["{ 'data-[ending-style]': 'translate-x-full' }", 'data-[ending-style]:translate-x-full'],
    ["{ 'data-[starting-style]': 'translate-x-full' }", 'data-[starting-style]:translate-x-full'],
    ["{ 'aria-[pressed]': 'translate-x-full' }", 'aria-[pressed]:translate-x-full'],
    // Tailwind's built-in bare aria states.
    ["{ 'aria-checked': 'opacity-50' }", 'aria-checked:opacity-50'],
    // Bare data-* variants (attribute presence).
    ["{ 'data-open': 'sr-only' }", 'data-open:sr-only'],
    // Compound scope variants.
    ["{ 'group-hover': 'translate-x-full' }", 'group-hover:translate-x-full'],
    ["{ 'peer-checked': 'underline' }", 'peer-checked:underline'],
    ["{ 'not-hover': 'opacity-50' }", 'not-hover:opacity-50'],
    // Fully arbitrary selector variants.
    ["{ '[&>li]': 'translate-x-full' }", '[&>li]:translate-x-full'],
    // Parameterized breakpoints.
    ["{ 'min-[900px]': 'flex' }", 'min-[900px]:flex'],
    ["{ 'max-[600px]': 'hidden' }", 'max-[600px]:hidden'],
    // Other bracket-parameterized variant families.
    ["{ 'supports-[display:grid]': 'grid' }", 'supports-[display:grid]:grid'],
    ["{ 'has-[:checked]': 'ring-2' }", 'has-[:checked]:ring-2'],
];

/** [sz object source, expected className] — negative placement (Bug 2). */
const NEGATIVE_CASES: ReadonlyArray<readonly [string, string]> = [
    // Top level was always correct.
    ["{ translateX: '-full' }", '-translate-x-full'],
    // Under a variant, the minus belongs on the utility, after the prefix.
    ["{ hover: { translateX: '-full' } }", 'hover:-translate-x-full'],
    [
        "{ 'data-[starting-style]': { translateX: '-full' } }",
        'data-[starting-style]:-translate-x-full',
    ],
    ["{ md: { m: '-px' } }", 'md:-m-px'],
    // Arbitrary negatives keep the sign inside the bracket — the report's
    // verified working spelling for the drawer offsets.
    [
        "{ 'data-[starting-style]': { translateX: '-100%' } }",
        'data-[starting-style]:translate-x-[-100%]',
    ],
];

/** Keys that must NOT be treated as variants for a string value. */
const NON_VARIANT_CASES: ReadonlyArray<readonly [string, string]> = [
    // A typo'd/unknown key keeps its property fallthrough (and its warning);
    // silently minting a variant would hide the typo forever.
    ["{ 'foo-[bar]': 'flex' }", 'foo-[bar]-flex'],
    // not-italic is the font-style utility; its boolean form must not change.
    ["{ 'not-italic': true }", 'not-italic'],
];

/**
 * Extract the emitted static className for one sz object source.
 *
 * @param transform - Engine entry under test.
 * @param szObject - The sz object literal source text.
 * @returns The emitted className string.
 */
function classNameFor(
    transform: (source: string, filename?: string) => { code?: string },
    szObject: string,
): string | undefined {
    const source = `export const A = () => <div sz={${szObject}} />;`;
    return transform(source, '/p/t.tsx').code?.match(/className="([^"]*)"/)?.[1];
}

const LANES = [
    ['babel', transformSourceCode],
    ['oxc', transformOxc],
] as const;

describe.each(LANES)('%s lane', (_lane, transform) => {
    it.each(VARIANT_STRING_CASES)('joins a variant string with a colon: %s', (szObject, want) => {
        expect(classNameFor(transform, szObject)).toBe(want);
    });

    it.each(NEGATIVE_CASES)('keeps the minus on the utility: %s', (szObject, want) => {
        expect(classNameFor(transform, szObject)).toBe(want);
    });

    it.each(NON_VARIANT_CASES)('leaves a non-variant key alone: %s', (szObject, want) => {
        expect(classNameFor(transform, szObject)).toBe(want);
    });
});

describe.skipIf(!isRustTransformAvailable())('rust lane', () => {
    const all = [...VARIANT_STRING_CASES, ...NEGATIVE_CASES, ...NON_VARIANT_CASES];
    it.each(all)('matches the JS lanes: %s', (szObject, want) => {
        expect(classNameFor(transformRust, szObject)).toBe(want);
    });
});

describe('variantStringPrefix', () => {
    it('maps known variants through the VARIANT_MAP spelling', () => {
        expect(variantStringPrefix('hover')).toBe('hover');
        expect(variantStringPrefix('dark')).toBe('dark');
    });

    it('normalizes whitespace in fully arbitrary variants', () => {
        expect(variantStringPrefix('[& > li]')).toBe('[&>li]');
    });

    it('accepts bracket parameters only on variant stems', () => {
        expect(variantStringPrefix('data-[open]')).toBe('data-[open]');
        expect(variantStringPrefix('min-[900px]')).toBe('min-[900px]');
        expect(variantStringPrefix('foo-[bar]')).toBeNull();
    });

    it('accepts scope compounds only with a known variant state', () => {
        expect(variantStringPrefix('group-hover')).toBe('group-hover');
        // `italic` is a utility, not a variant state — `not-italic` stays a
        // property key so the boolean shorthand keeps working.
        expect(variantStringPrefix('not-italic')).toBeNull();
    });

    it('gates bare aria on the built-in state set', () => {
        expect(variantStringPrefix('aria-checked')).toBe('aria-checked');
        // Unknown aria attributes need the bracket form in Tailwind; minting
        // aria-foo: would emit a class that matches nothing.
        expect(variantStringPrefix('aria-foo')).toBeNull();
    });

    it('rejects plain property keys', () => {
        for (const key of ['translateX', 'p', 'bg', 'foo', '50']) {
            expect(variantStringPrefix(key)).toBeNull();
        }
    });
});
