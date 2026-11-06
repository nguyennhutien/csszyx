/**
 * The modules a generated `.csszyx/theme.d.ts` may augment, in the order the
 * writer prefers them.
 *
 * A module augmentation applies only when TypeScript resolves the module from
 * the project. `csszyx` is the package a project installs and lists, so it
 * resolves under every package manager; `@csszyx/compiler` is its dependency,
 * which pnpm and Yarn PnP keep out of the project's reach. `csszyx` re-exports
 * the compiler's `CustomTheme` and `VariantModifiers`, so augmenting either
 * name patches the same interfaces.
 */
export const THEME_AUGMENT_MODULES = Object.freeze(['csszyx', '@csszyx/compiler'] as const);

/** One module a theme declaration may augment. */
export type ThemeAugmentModule = (typeof THEME_AUGMENT_MODULES)[number];
