/**
 * The named shadow sizes across `shadow-*`, `inset-shadow-*`, `text-shadow-*`
 * and `drop-shadow-*`: the value before a slash that is a shadow, not its
 * colour. Its own module, with the tables {@link isShadowValue} reads, so the
 * lowering and the migrate tables, which import the lowering, read one list.
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
 * The CSS-wide keywords. Every property takes them, but Tailwind serves only a
 * few as a named utility (`text-inherit`); for every other key the keyword
 * needs the arbitrary form (`p-[inherit]`), and the bare one is a class with
 * no CSS.
 * @internal Used by csszyx's own packages; not a stable API.
 */
export const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
    'inherit',
    'initial',
    'unset',
    'revert',
    'revert-layer',
]);

/**
 * The calls Tailwind reads a bracket as a colour for when the bracket starts
 * with one (`[rgb(0_0_0)]`), whatever follows the call.
 */
export const COLOUR_FUNCTION_NAMES: ReadonlySet<string> = new Set([
    'rgb',
    'rgba',
    'hsl',
    'hsla',
    'hwb',
    'color',
    'lab',
    'lch',
    'oklab',
    'oklch',
    'light-dark',
    'color-mix',
    '--alpha',
]);

/**
 * Whether the value before a shadow key's slash is the shadow itself rather
 * than its colour, as Tailwind reads `shadow-<value>`. A named size, a
 * variable and a parenthesis without the `color:` hint are the shadow. A
 * bracket is the colour when its hint is `color:`, when it starts with `#` or
 * a colour function (`[rgb(0_0_0)_0_1px]` too, which Tailwind writes as a
 * colour), or when the whole of it is one word other than a size or a
 * CSS-wide keyword (`[red]`, `[canvas]`); anything else is the shadow
 * (`[var(--s)]`, `[none]`, `[red_0_1px]`). Tailwind lists the colour words; a
 * word it does not list (`[foo]`) is read as a colour here, a class that
 * styles nothing either way. Mirrors `is_shadow_value` in `lower.rs`.
 *
 * Cost: one pass over the leading name of `value`, O(n) in its length; the
 * input is the text before a slash on a shadow key. Read by the lowering,
 * `dynamic()` and, through its mirror, the engine.
 *
 * @param value - The value before the slash.
 * @returns Whether it is a shadow.
 */
export function isShadowValue(value: string): boolean {
    if (value.startsWith('(')) return !value.startsWith('(color:');
    if (value.startsWith('[')) return !isBracketColour(value.slice(1, -1));
    return SHADOW_SIZE_KEYWORDS.has(value) || value.startsWith('--');
}

/**
 * @param inner - A bracket's text without the brackets.
 * @returns Whether Tailwind reads it as a colour.
 */
function isBracketColour(inner: string): boolean {
    const name = (/^[a-z-]*/i.exec(inner) as RegExpExecArray)[0];
    const next = inner[name.length];
    if (next === ':') return name === 'color';
    if (next === '(') return COLOUR_FUNCTION_NAMES.has(name.toLowerCase());
    if (next !== undefined) return inner.startsWith('#');
    const word = name.toLowerCase();
    return /^[a-z]+$/.test(word) && !SHADOW_SIZE_KEYWORDS.has(word) && !CSS_WIDE_KEYWORDS.has(word);
}
