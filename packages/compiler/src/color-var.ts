/**
 * Canonical implementation of __szColorVar.
 *
 * This is the SINGLE SOURCE OF TRUTH for color variable resolution in csszyx.
 * The compiler emits calls to __szColorVar() for dynamic COLOR-category props.
 * The runtime/lite inlines this implementation at build time (zero runtime dep).
 *
 * Resolution rules (Tailwind v4 conventions):
 *   - undefined/null/empty/non-string → undefined ("no colour", omit the CSS var)
 *   - Raw CSS values (#hex, rgb, hsl, oklch) → pass through unchanged
 *   - CSS custom properties (--*) → wrapped in var()
 *   - Tailwind color names (blue-500, etc.) → var(--color-<name>)
 *
 * @param v - Color value: Tailwind name, hex, rgb/hsl/oklch, or CSS variable
 * @returns CSS-compatible color string, or undefined when there is no colour
 */
export function __szColorVar(v: string | null | undefined): string | undefined {
    // A runtime-conditional colour can resolve to undefined/null
    // (`sz={{ color: cond ? 'muted' : undefined }}`). Treat it as "no colour" and
    // omit the CSS variable — matching dynamic() and object-spread/React
    // conventions — instead of crashing on `.startsWith` of a non-string.
    if (typeof v !== 'string' || v === '') {
        return undefined;
    }
    if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') || v.startsWith('oklch')) {
        return v;
    }
    if (v.startsWith('--')) {
        return `var(${v})`;
    }
    if (/[);\s\\]/.test(v)) return v;
    return `var(--color-${v})`;
}
