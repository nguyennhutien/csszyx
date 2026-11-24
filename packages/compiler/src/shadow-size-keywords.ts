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
