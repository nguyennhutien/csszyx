/**
 * How a colour value's slash opacity and its modifier are read, shared by the
 * lowering's reports and by `dynamic()`, which writes the opacity a class
 * names. Its own entry so the browser lowering, which reads them only in
 * development, ships none of it.
 *
 * @module
 */

/**
 * Whether a background value, its `-` taken off, names a Tailwind gradient
 * utility: `linear-to-r`, `radial`, `conic-180`, `gradient-to-b`. Mirrors
 * `is_background_gradient`.
 *
 * @param value - The value.
 * @returns True for a gradient.
 */
export function isBackgroundGradientString(value: string): boolean {
    return (
        value.startsWith('linear-') ||
        value.startsWith('radial') ||
        value.startsWith('conic') ||
        value.startsWith('gradient-to-')
    );
}

/** A bare fraction (`1/2`) or a numeric ratio (`4/2.5`, `-1/2`): a sizing value. */
const NUMERIC_RATIO = /^-?\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;

/**
 * The colour and the opacity of a colour value that carries a slash opacity:
 * the first `/` outside brackets and parentheses, so `#f00/50`,
 * `rgb(255 0 0)/50` and `[#f00]/50` split and `rgb(255_0_0/50%)` does not. A
 * bare fraction or a numeric ratio is a sizing value, and a gradient's slash
 * names its interpolation (`linear-to-r/oklch`). Mirrors
 * `slash_opacity_split`; linear in the value's length.
 *
 * @param value - The value, without a trailing `!`.
 * @returns The colour and the opacity, or `undefined`.
 */
export function slashOpacitySplit(value: string): [string, string] | undefined {
    if (NUMERIC_RATIO.test(value)) return undefined;
    let depth = 0;
    for (let at = 0; at < value.length; at++) {
        const char = value[at];
        if (char === '(' || char === '[') depth++;
        else if (char === ')' || char === ']') depth--;
        else if (char === '/' && depth === 0) {
            const color = value.slice(0, at);
            const opacity = value.slice(at + 1);
            const gradient = isBackgroundGradientString(color.replace(/^-/, ''));
            return color && opacity && !gradient ? [color, opacity] : undefined;
        }
    }
    return undefined;
}

/** Digits with at most one point: `50`, `0.5`, `.5`. */
const PLAIN_DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * The `op` an opacity modifier names, as Tailwind reads the modifier: `50` is
 * 50, `[50%]` is `'50%'`, `[0.5]` is a fraction of one, 50, and `(--o)` is
 * `'--o'`. `undefined` for a modifier no `op` writes, such as `[2]`, which is
 * 200%. Mirrors `modifier_op`, which `csszyx migrate` reads a class with.
 *
 * @param modifier - The modifier after the slash.
 * @returns The `op`, or `undefined`.
 */
export function modifierOp(modifier: string): number | string | undefined {
    const inner = modifier.slice(1, -1);
    if (modifier.startsWith('(') && modifier.endsWith(')')) return inner;
    if (!modifier.startsWith('[') || !modifier.endsWith(']')) {
        return PLAIN_DECIMAL.test(modifier) ? Number(modifier) : undefined;
    }
    if (inner.includes('%')) return inner;
    const fraction = PLAIN_DECIMAL.test(inner) ? Number(inner) : Number.NaN;
    // Rounded so `0.05` reads 5, not 5.000000000000001.
    return fraction <= 1 ? Math.round(fraction * 100 * 1e9) / 1e9 : undefined;
}
