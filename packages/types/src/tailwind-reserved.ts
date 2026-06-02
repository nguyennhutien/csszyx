/** Tailwind v4 @theme namespaces that csszyx must never alias. */
export const TAILWIND_RESERVED_PREFIXES = [
    '--color-',
    '--font-',
    '--text-',
    '--font-weight-',
    '--tracking-',
    '--leading-',
    '--tab-size-',
    '--breakpoint-',
    '--container-',
    '--spacing-',
    '--radius-',
    '--shadow-',
    '--inset-shadow-',
    '--drop-shadow-',
    '--blur-',
    '--perspective-',
    '--zoom-',
    '--aspect-',
    '--ease-',
    '--animate-',
] as const;

/** Default csszyx Phase H generated global-alias namespace. */
export const CSSZYX_GLOBAL_ALIAS_PREFIX = '---g';

/**
 * Checks whether a custom-property name is in a Tailwind-owned theme namespace.
 *
 * @param name Custom-property name including the leading `--`.
 * @returns true when the name belongs to a Tailwind reserved namespace.
 */
export function isTailwindReservedCustomProperty(name: string): boolean {
    return TAILWIND_RESERVED_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Checks whether a custom-property name collides with csszyx generated
 * global-alias names.
 *
 * @param name Custom-property name including the leading `--`.
 * @param aliasPrefix Active generated alias prefix.
 * @returns true when the name belongs to csszyx's reserved generated alias namespace.
 */
export function isCsszyxGlobalAliasCustomProperty(
    name: string,
    aliasPrefix: string = CSSZYX_GLOBAL_ALIAS_PREFIX,
): boolean {
    return name.startsWith(aliasPrefix);
}
