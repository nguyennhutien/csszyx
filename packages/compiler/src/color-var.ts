/**
 * Canonical implementation of __szColorVar.
 *
 * This is the SINGLE SOURCE OF TRUTH for color variable resolution in csszyx.
 * The compiler emits calls to __szColorVar() for dynamic COLOR-category props.
 * The runtime/lite inlines this implementation at build time (zero runtime dep).
 *
 * Resolution rules (Tailwind v4 conventions):
 *   - Raw CSS values (#hex, rgb, hsl, oklch) → pass through unchanged
 *   - CSS custom properties (--*) → wrapped in var()
 *   - Tailwind color names (blue-500, etc.) → var(--color-<name>)
 *
 * @param v - Color value: Tailwind name, hex, rgb/hsl/oklch, or CSS variable
 * @returns CSS-compatible color string
 */
export function __szColorVar(v: string): string {
    if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('oklch')) { return v; }
    if (v.startsWith('--')) { return `var(${v})`; }
    return `var(--color-${v})`;
}
