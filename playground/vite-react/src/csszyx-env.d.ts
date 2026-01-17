/**
 * csszyx JSX type augmentation — adds `sz` prop to all HTML/SVG elements.
 *
 * This file performs the React module augmentation locally so that
 * TypeScript augments the same `react` instance used by this project.
 * (Required in pnpm strict mode where transitive declarations
 *  resolve to a different module instance.)
 */
import type { SzObject } from '@csszyx/types';

declare module 'react' {
    interface HTMLAttributes<T> {
        /**
         * csszyx styling prop — accepts an object of Tailwind utility mappings.
         *
         * @example
         * ```tsx
         * <div sz={{ p: 4, bg: 'blue-500', hover: { bg: 'blue-600' } }} />
         * ```
         */
        sz?: SzObject | string;
    }

    interface SVGAttributes<T> {
        /** csszyx styling prop for SVG elements. */
        sz?: SzObject | string;
    }
}
