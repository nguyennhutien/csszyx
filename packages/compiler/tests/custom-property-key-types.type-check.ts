/**
 * Type-level regression lock for a CSS custom property written as a KEY on the
 * sz object, which the lowering has always emitted as the arbitrary-property
 * class `[--name:value]` on both engines. The type used to reject the form its
 * own compiler supported, so the only way to write it was a cast.
 *
 * This file is NOT a vitest test (no `.test.ts`); `tsc` checks it as part of the
 * package, so dropping the index signature breaks the build. The
 * `@ts-expect-error` below is the over-loosening guard: a key that is not a
 * custom property must STILL be rejected, or this file fails to compile.
 */
import type { SzProps } from '../src/types/sz-props';

const customProperties: SzProps = {
    bg: 'blue-500',
    '--brand': 'navy',
    '--brand-alpha': 0.18,
    // under a variant, where a design system sets the token per colour scheme
    dark: { '--brand': 'white' },
    hover: { '--brand-alpha': 1 },
    // the `css:` spelling stays valid alongside the key spelling
    css: { '--brand-shadow': '0 0 0 1px navy' },
};

// A key that is not a custom property must still be caught as a typo.
const typo: SzProps = {
    // @ts-expect-error - `bgg` is not an sz key and no index signature covers it
    bgg: 'blue-500',
};

export { customProperties, typo };

// An object body is not a declaration value: the lowering has no rule for it,
// so the type must not let one through.
const objectValued: SzProps = {
    // @ts-expect-error - a custom property takes a declaration value, not an object
    '--brand': { color: 'navy' },
};

export { objectValued };
