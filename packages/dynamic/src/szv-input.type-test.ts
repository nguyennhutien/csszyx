/**
 * Type-level contract: `dynamic()` and the `useSz().sz` callback take what an
 * szv factory returns. Compiled (not run) by `tsc -b`; the package tsconfig
 * includes `src/**`, so the lock lives here.
 *
 * The factory is declared with the szv result type (`SzProps`) rather than
 * built with `szv()`: this package's tsconfig does not reference the runtime
 * project, and `@csszyx/runtime`'s own `szv.type-test.ts` locks that the
 * factory returns `SzProps`. Together the two locks cover `dynamic(f(...))`.
 */
import type { SzProps } from '@csszyx/compiler';

import { dynamic } from './index.js';
import type { UseSzReturn } from './react.js';

/** An szv factory, typed as `szv()` returns it. */
declare const buttonSz: (selection?: { size?: 'sm' | 'lg' | null }) => SzProps;
declare const hook: UseSzReturn;

/** `dynamic(f(...))` compiles without a cast. */
export const fromFactory: string = dynamic(buttonSz({ size: 'lg' }));
/** The hook's `sz` takes the same input as `dynamic()`. */
export const fromHook: string = hook.sz(buttonSz());
/** Plain and `as const` objects are still accepted. */
export const fromLiteral: string = dynamic({ p: 4, hover: { bg: 'blue-500' } });
export const fromConst: string = hook.sz({ p: 4, rounded: 'md' } as const);

/**
 * Rejections. The body never runs.
 */
export function dynamicRejects(): void {
    // @ts-expect-error - a class string is not an sz object; dynamic() lowers objects only
    dynamic('p-4');
}
