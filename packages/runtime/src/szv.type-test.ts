/**
 * Type-level contract for `szv()`. Compiled (not run) by `tsc -b`: the runtime
 * tsconfig includes `src/**`, so the locks live here to be in the program at
 * all. Each `@ts-expect-error` is an assertion — an error that stops firing
 * becomes an "unused directive" error and fails the build.
 *
 * The contract: a factory's result is `SzProps` (it goes straight into `sz=`),
 * every row key is a real sz key (also inside nested variants such as `hover`),
 * row values are checked like `sz={...}`, and the call-site option, dimension
 * and default names stay checked. A row table built at runtime as
 * `Record<string, SzProps>` still compiles; `validateSzvConfig` handles data
 * the types cannot see.
 */
import type { SzObject, SzProps } from '@csszyx/compiler';

import { szv } from './variants.js';

/** Resolves to `T` only when `T` is exactly `true`, else fails the build. */
type Assert<T extends true> = T;

/** True when `A` is assignable to `B`. */
type AssignableTo<A, B> = [A] extends [B] ? true : false;

const buttonSz = szv({
    base: { display: 'inline-flex', items: 'center' },
    variants: {
        size: {
            sm: { h: 9, px: 3 },
            lg: { h: 11, px: 8, hover: { bg: 'blue-700' } },
        },
        tone: {
            plain: {},
            loud: { weight: 'bold', bgImg: { gradient: 'linear', dir: 'to-r' } },
        },
    },
    defaultVariants: { size: 'sm' },
});

// ── The result is `SzProps`: it goes into `sz=` (or another row) without a cast ──
/** A factory's result is `SzProps`, whatever the config. */
export type _ContractResultIsSzProps = Assert<
    AssignableTo<ReturnType<ReturnType<typeof szv>>, SzProps>
>;
export const resultWithSelection: SzProps = buttonSz({ size: 'lg' });
export const resultWithoutSelection: SzProps = buttonSz();
export const resultAsRow: SzProps = { ...buttonSz({ tone: 'loud' }), p: 2 };

// ── Rows that must keep compiling ──
declare const runtimeRows: Record<string, SzProps>;
export const fromRuntimeRows: SzProps = szv({ variants: { size: runtimeRows } })({ size: 'any' });

export const exoticKeys: SzProps = szv({
    variants: {
        look: {
            a: {
                css: { writingMode: 'vertical-rl' },
                'group-hover': { bg: 'blue-500' },
                '@md': { p: 4 },
                '--brand': 'navy',
                group: { hover: { opacity: 100 } },
                aria: { expanded: { bg: 'blue-100' } },
                color: { color: 'indigo-900', op: 66 },
            },
        },
    },
})({ look: 'a' });

const typedRow: SzProps = { p: 4, hover: { bg: 'blue-500' } };
export const fromTypedRow: SzProps = szv({ variants: { size: { md: typedRow } } })({ size: 'md' });

/** A shared row declared `as const` keeps its literal values, so it type-checks. */
const sharedRow = { p: 4, rounded: 'md' } as const;
export const fromSharedRow: SzProps = szv({ variants: { size: { md: sharedRow } } })();

/**
 * A widened row (no `as const`) compiles while every key it has takes any
 * string: `rounded` does, so this row is accepted.
 */
const widenedOpenRow = { rounded: 'full', px: 3 };
export const fromWidenedOpenRow: SzProps = szv({ variants: { shape: { pill: widenedOpenRow } } })();

export const baseOnly: SzProps = szv({ base: { p: 4, hover: { opacity: 50 } } })();

declare const looseRow: SzObject;
/** Widened: `display` becomes `string`, and `display` takes only its keywords. */
const widenedClosedRow = { display: 'flex', px: 3 };

/**
 * Rejections. Each statement must fail to compile; the body never runs.
 */
export function szvRejects(): void {
    // ── Row keys: a typo is an error, at the top of a row and nested under a variant ──
    // The error lands on the typo alone: the valid keys beside it carry no
    // directive, so an error on them fails the build.
    szv({
        variants: {
            size: {
                sm: {
                    p: 2,
                    // @ts-expect-error - `bgg` is not an sz key (canonical is `bg`)
                    bgg: 'red-500',
                    rounded: 'md',
                },
                lg: { p: 4 },
            },
        },
    });
    szv({
        variants: {
            size: {
                sm: {
                    p: 2,
                    hover: {
                        opacity: 50,
                        // @ts-expect-error - `bgg` under `hover` is not an sz key either
                        bgg: 'red-500',
                    },
                },
            },
        },
    });
    szv({
        variants: {
            state: {
                on: {
                    aria: {
                        expanded: {
                            p: 2,
                            // @ts-expect-error - a row under `aria` is an sz row, so its keys are checked too
                            bgg: 'red-500',
                        },
                    },
                },
            },
        },
    });

    // ── Row values are checked like `sz={...}` ──
    szv({
        variants: {
            layout: {
                // @ts-expect-error - `flexx` is not a display value
                row: { display: 'flexx' },
            },
        },
    });

    // ── Call-site names: option, dimension and default stay checked ──
    // @ts-expect-error - `xl` is not an option of `size`
    buttonSz({ size: 'xl' });
    // @ts-expect-error - `sizee` is not a dimension
    buttonSz({ sizee: 'sm' });
    szv({
        variants: { size: { sm: { p: 2 } } },
        // @ts-expect-error - `xl` is not an option of `size`
        defaultVariants: { size: 'xl' },
    });

    // ── Documented reject: a widened row whose key has a closed value type ──
    // @ts-expect-error - `display: string` is not a display value; declare the row `as const`
    szv({ variants: { layout: { row: widenedClosedRow } } });

    // ── Documented reject: an index-signature row is not an sz row ──
    // @ts-expect-error - `SzObject` admits any key; type the row `SzProps` or declare it `as const`
    szv({ variants: { size: { md: looseRow } } });
}
