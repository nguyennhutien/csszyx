/**
 * The named shadow sizes across `shadow-*`, `inset-shadow-*`, `text-shadow-*`
 * and `drop-shadow-*`: the value before a slash that is a shadow, not its
 * colour. Its own module so the lowering and the migrate tables, which
 * imports the lowering, read one list.
 */
export const SHADOW_SIZE_KEYWORDS: ReadonlySet<string> = new Set([
    '2xs',
    'xs',
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    'inner',
    'none',
]);

/**
 * Whether the value before a shadow key's slash is the shadow itself rather
 * than its colour: a named size, a variable, or a bracket of several tokens
 * (`[0_1px_2px_black]`; `[red]` is a colour).
 *
 * @param value - The value before the slash.
 * @returns Whether it is a shadow.
 */
export function isShadowValue(value: string): boolean {
    return (
        SHADOW_SIZE_KEYWORDS.has(value) ||
        value.startsWith('--') ||
        value.startsWith('(') ||
        (value.startsWith('[') && value.includes('_'))
    );
}
