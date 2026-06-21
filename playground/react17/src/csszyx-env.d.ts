/**
 * csszyx JSX type augmentation — adds `sz` prop to all HTML/SVG elements.
 *
 * Performed locally so TypeScript augments the same `react` instance this
 * project resolves (required under pnpm strict mode). On React 17 this still
 * augments `HTMLAttributes`/`SVGAttributes`, which `JSX.IntrinsicElements`
 * inherits from in @types/react 17 — the same mechanism as React 18.
 */
import type { SzObject } from '@csszyx/types';

declare module 'react' {
    interface HTMLAttributes<T> {
        /** csszyx styling prop — object of Tailwind utility mappings or a class string. */
        sz?: SzObject | string;
    }

    interface SVGAttributes<T> {
        /** csszyx styling prop for SVG elements. */
        sz?: SzObject | string;
    }
}
