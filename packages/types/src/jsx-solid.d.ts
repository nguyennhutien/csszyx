/**
 * SolidJS JSX type augmentation for the csszyx sz prop.
 *
 * Solid maintains its own JSX namespace (not React's), so the React
 * augmentation in `@csszyx/types/jsx` does not apply. Reference this
 * module instead in Solid projects:
 *
 * ```ts
 * // csszyx-env.d.ts
 * /// <reference types="@csszyx/types/jsx-solid" />
 * ```
 *
 * Types-only: solid-js is required as a type dependency by consumers of
 * this subpath (every Solid project already has it) and is never imported
 * at runtime.
 *
 * @module @csszyx/types/jsx-solid
 */

import 'solid-js';

import type { RecoveryMode, SzPropValue } from '@csszyx/compiler';

export type { RecoveryMode, SzPropValue };

declare module 'solid-js' {
    namespace JSX {
        /**
         *
         */
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
    }
}
