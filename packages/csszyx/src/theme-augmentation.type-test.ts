/**
 * Type-level lock: `csszyx` re-exports the compiler's own `CustomTheme` and
 * `VariantModifiers`, not copies. A generated `.csszyx/theme.d.ts` augments
 * them through `declare module 'csszyx'`, because a pnpm project cannot
 * resolve `@csszyx/compiler`; that augmentation reaches the `sz` prop's types
 * only while these two names are the compiler's interfaces. Compiled (not
 * run) by `tsc -b`.
 */
import type {
    CustomTheme as CompilerCustomTheme,
    VariantModifiers as CompilerVariantModifiers,
} from '@csszyx/compiler';

import type { CustomTheme, VariantModifiers } from './index.browser.js';

/** True when `A` and `B` are the same type. */
type Same<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const customThemeIsTheCompilers: Same<CustomTheme, CompilerCustomTheme> = true;
export const variantModifiersAreTheCompilers: Same<VariantModifiers, CompilerVariantModifiers> =
    true;
