/**
 * Canonical implementation of __szBoolClass.
 *
 * This is the SINGLE SOURCE OF TRUTH for resolving dynamic values on
 * boolean-only keys (the BOOLEAN_ONLY_DYNAMIC_KEYS family: border sides,
 * ring, outline, truncate, shadow). The compiler emits calls to this helper
 * for those keys instead of the css-var strategy. The runtime re-exports it
 * (zero duplicate logic), mirroring the __szSpacingVar arrangement in
 * spacing-var.ts.
 *
 * Why not a custom property: React discards booleans in `style`, so
 * `style={{"--_sz-border-b": on}}` never sets the variable — and the valued
 * utility (`border-b-(--var)`) resolves to a COLOR while the bare class
 * (`border-b`) is a WIDTH, so even a resolvable value would style the wrong
 * property. The only correct lowering is the bare class, toggled at runtime.
 */

/** Values already warned about, so a render loop logs each shape only once. */
const warnedShapes = new Set<string>();

/**
 * Resolve a dynamic value on a boolean-only key into its compiled class:
 *   - `true` → the bare class (`border-b`, `hover:truncate`, …)
 *   - `false` / `null` / `undefined` / `''` → `''` silently — `false` is a
 *     MEANINGFUL "off" for these keys (no border), not an absent value, so
 *     unlike the spacing helper it never deserves a warning
 *   - anything else (number, string, object, …) → warn once per key/shape
 *     and omit — never emit CSS that styles the wrong property.
 * @param v - The runtime value from the sz object.
 * @param key - The sz key the value arrived on (diagnostics only).
 * @param className - The compiled bare class, variant prefix included.
 * @returns The class string to render, or an empty string for none.
 */
export function __szBoolClass(v: unknown, key: string, className: string): string {
    if (v === true) {
        return className;
    }
    if (v === false || v === null || v === undefined || v === '') {
        return '';
    }
    const shape = `${key}:${typeof v}`;
    if (!warnedShapes.has(shape)) {
        warnedShapes.add(shape);
        // Kept in prod: the style silently dropping IS the failure mode this
        // helper exists to prevent, so it must stay visible.
        console.warn(
            `[csszyx] dynamic value on "${key}" is a ${typeof v} — only a boolean can ` +
                'toggle this class, so it is omitted. Write non-boolean values as ' +
                'literals (or use dynamic() for responsive objects).',
        );
    }
    return '';
}
