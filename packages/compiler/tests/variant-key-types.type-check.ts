/**
 * Type-level regression lock for the flat-string variant keys the closed sz type
 * must accept (the compiler supports each — see advanced-variants tests). This
 * file is NOT a vitest test (no `.test.ts`); it is type-checked by `tsc` as part
 * of the package, so removing an index signature in `VariantModifiers` breaks the
 * build. The `@ts-expect-error` below is the over-loosening guard: a scalar typo
 * key must STILL be rejected, or this file fails to compile.
 */
import type { SzProps } from '../src/types/sz-props';

// Valid flat-variant keys (object body) — the patterns real projects + the
// e2e playgrounds use.
const variants: SzProps = {
    opacity: 50,
    transition: 'opacity',
    // named group / peer (the form that regressed)
    'group-hover/sidebar': { opacity: 100 },
    'peer-focus/search': { opacity: 100 },
    // bare-state + arbitrary-param functional variants
    'group-hover': { bg: 'red-500' },
    'peer-checked': { bg: 'blue-500' },
    'group-data-[active]': { color: 'blue-600' },
    'aria-checked': { bg: 'blue-100' },
    'aria-[sort=asc]': { weight: 'bold' },
    'data-active': { color: 'red-600' },
    'data-[state=open]': { bg: 'green-50' },
    'has-[:checked]': { p: 2 },
    'not-hover': { opacity: 50 },
    'in-[.dark]': { color: 'white' },
    'nth-[2n]': { bg: 'gray-100' },
    'supports-[display:grid]': { display: 'grid' },
    // container-query variants (object) + container-declaration markers (boolean)
    '@md': { p: 4 },
    '@max-[600px]': { p: 2 },
    '@container': true,
    '@container/sidebar': true,
};

// Over-loosening guard: a scalar typo key must STILL be a tsc error. If the index
// signatures were too broad this `@ts-expect-error` would be unused → compile error.
// @ts-expect-error - bgColor is not a valid sz key (canonical is `bg`)
const typo: SzProps = { bgColor: 'red-500' };

// Exports keep the compile-time fixtures live without runtime-only `void` expressions.
export { typo, variants };
