import type { SzObject } from '@csszyx/types';

declare module 'react' {
    interface HTMLAttributes<T> {
        sz?: SzObject | string;
    }

    interface SVGAttributes<T> {
        sz?: SzObject | string;
    }
}
