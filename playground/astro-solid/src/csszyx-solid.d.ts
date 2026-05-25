import 'solid-js';

import type { RecoveryMode, SzPropValue } from '@csszyx/types/jsx';

declare module 'solid-js' {
    namespace JSX {
        interface HTMLAttributes<T> {
            /** csszyx styling prop for SolidJS JSX intrinsic elements. */
            sz?: SzPropValue;
            /** csszyx hydration recovery mode. */
            szRecover?: RecoveryMode;
        }
    }
}
