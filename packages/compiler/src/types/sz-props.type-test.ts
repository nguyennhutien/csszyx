/**
 * Type-level tests for the closed sz prop type. Compiled (not run) by tsc:
 * a `@ts-expect-error` line that does NOT error becomes a tsc error itself,
 * so this file passing type-check is the assertion.
 */
import type { SzProps, SzsProps } from './sz-props.js';

declare module './sz-props.js' {
    /** Custom theme tokens used by the augmentation contract fixture. */
    interface CustomTheme {
        /** Custom color token. */
        colors: 'brand';
        /** Custom font-size token. */
        textSizes: 'hero';
        /** Custom font-weight token. */
        fontWeights: 'book';
    }
}

// Known scalar + object props pass.
const _known: SzProps = { p: 4, bg: 'blue-500', m: 2, color: 'red-500' };
const _themeTokens: SzProps = {
    bg: 'brand',
    text: 'hero',
    weight: 'book',
    borderTColor: 'brand',
    insetRingColor: 'brand',
};

// Known variant nesting passes.
const _variant: SzProps = { hover: { bg: 'blue-700' } };

// Nested NAMED variants pass (responsive × state, both orders).
const _nested1: SzProps = { md: { hover: { p: 4 } } };
const _nested2: SzProps = { hover: { md: { p: 4 } } };
const _nested3: SzProps = { md: { group: { hover: { p: 2 } } } };

// Arbitrary variant patterns pass.
const _arbAt: SzProps = { '@container/sidebar': { p: 4 } };
const _arbMin: SzProps = { 'min-[320px]': { p: 4 } };
const _arbMax: SzProps = { 'max-[600px]': { hidden: true } as SzProps };
const _arbSel: SzProps = { '[&>span]': { p: 4 } };

// css escape hatch passes.
const _css: SzProps = { css: { writingMode: 'vertical-lr' } };

// Unknown/typo key is a tsc ERROR (this assertion holds iff the next line errors).
// @ts-expect-error - bgColor is not a valid sz key; canonical is `bg`.
const _typo: SzProps = { bgColor: 'red-500' };

// The @ts-expect-error opt-out lets a deliberate forward-compat token through.
// @ts-expect-error - intentional forward-compat utility csszyx has no key for yet.
const _forward: SzProps = { someBrandNewTwUtility: 'x' };

// SzsProps: the authoring face takes sz objects, the compiled face takes strings,
// both keyed by the SAME slot union.
const _szsWrite: SzsProps<'header' | 'icon'> = {
    szs: { header: { bg: 'gray-100' }, icon: 'p-2 text-red-500' },
};
const _szsRead: SzsProps<'header' | 'icon'> = {
    szsc: { header: 'bg-gray-100' },
};

// A compiled slot forwards into `className?: string` with no cast.
declare const _receivedSzsc: SzsProps<'header'>['szsc'];
const _classNameSlot: string | undefined = _receivedSzsc?.header;

// An unknown slot name is a tsc ERROR on both faces.
// @ts-expect-error - `footer` is not in the declared slot union.
const _szsTypo: SzsProps<'header'> = { szs: { footer: { p: 2 } } };
// @ts-expect-error - `footer` is not in the declared slot union.
const _szscTypo: SzsProps<'header'> = { szsc: { footer: 'p-2' } };

// The compiled face only carries strings — an sz object cannot land on it.
// @ts-expect-error - szsc slots are compiled class strings, not sz objects.
const _szscObject: SzsProps<'header'> = { szsc: { header: { p: 2 } } };

// Exporting the fixtures keeps every assignment live for `noUnusedLocals`
// without introducing runtime-only `void` expressions into this type contract.
export {
    _arbAt,
    _arbMax,
    _arbMin,
    _arbSel,
    _classNameSlot,
    _css,
    _forward,
    _known,
    _nested1,
    _nested2,
    _nested3,
    _szscObject,
    _szscTypo,
    _szsRead,
    _szsTypo,
    _szsWrite,
    _themeTokens,
    _typo,
    _variant,
};
