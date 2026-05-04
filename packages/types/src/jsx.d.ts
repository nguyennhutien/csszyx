/**
 * JSX type augmentation for csszyx sz prop.
 *
 * This module extends React's JSX namespace to add the `sz` prop
 * to all HTML elements. Types are re-exported from @csszyx/compiler
 * for IntelliSense and autocompletion.
 *
 * @module @csszyx/types/jsx
 */

import 'react';

import type { RecoveryMode, SzProps, SzPropValue } from '@csszyx/compiler';

export type { RecoveryMode, SzProps, SzPropValue };

declare module 'react' {
  /**
   *
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    /**
     * csszyx styling prop — Tailwind CSS via object syntax or class string.
     *
     * @example
     * ```tsx
     * <div sz={{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }} />
     * <div sz="p-4 bg-blue-500 hover:bg-blue-700" />
     * ```
     */
    sz?: SzPropValue;
    /**
     * Hydration recovery mode for the element. The csszyx unplugin
     * compiles this attribute into a `data-sz-recovery-token` and
     * registers the element in the SSR recovery manifest read by
     * `@csszyx/runtime/verify` at hydration time.
     *
     * - `'csr'` — recovery permitted in both dev and production
     * - `'dev-only'` — recovery permitted in development only;
     *   stripped from the production manifest at build time.
     *
     * @example
     * ```tsx
     * <section szRecover="csr">…</section>
     * ```
     */
    szRecover?: RecoveryMode;
  }

  /**
   *
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface SVGAttributes<T> {
    /**
     * csszyx styling prop — Tailwind CSS via object syntax or class string.
     *
     * @example
     * ```tsx
     * <svg sz={{ fill: 'red-500', stroke: 'current' }} />
     * ```
     */
    sz?: SzPropValue;
  }
}
