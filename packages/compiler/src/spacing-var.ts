/**
 * Canonical implementations of __szSpacingVar and __szUnitVar.
 *
 * This is the SINGLE SOURCE OF TRUTH for spacing/unit variable resolution in
 * csszyx. The compiler emits calls to these helpers for dynamic SPACING /
 * ANGLE / DURATION-category props. The runtime re-exports them (zero
 * duplicate logic), mirroring the __szColorVar arrangement in color-var.ts.
 *
 * Why a runtime decision at all: the compiler cannot know a runtime value's
 * shape, and the sz type system accepts far more than bare spacing numbers on
 * these keys (`'full'`, `'100%'`, `'3/12'`, `'max-content'`, …). A baked
 * `calc(v * var(--spacing))` template silently produced invalid CSS for every
 * one of those; the helper resolves each shape the way the static path would
 * have lowered the same literal.
 */

/** Sizing keys whose `screen` token means the viewport WIDTH. */
const VIEWPORT_WIDTH_KEYS = new Set([
    'w',
    'minW',
    'maxW',
    'inlineSize',
    'minInlineSize',
    'maxInlineSize',
    'basis',
]);

/** Sizing keys whose `screen` token means the viewport HEIGHT. */
const VIEWPORT_HEIGHT_KEYS = new Set([
    'h',
    'minH',
    'maxH',
    'blockSize',
    'minBlockSize',
    'maxBlockSize',
]);

/** Axis-independent named tokens, resolved exactly as their static classes lower. */
const NAMED_SIZE_TOKENS: Record<string, string> = {
    full: '100%',
    min: 'min-content',
    max: 'max-content',
    fit: 'fit-content',
    auto: 'auto',
    px: '1px',
};

/** Values already warned about, so a render loop logs each shape only once. */
const warnedShapes = new Set<string>();

/**
 * Warn (once per key/shape pair) that a dynamic value could not be resolved
 * into CSS. Kept in prod: the style silently dropping IS the failure mode
 * this helper exists to prevent, so it must stay visible.
 * @param key - The sz key the value arrived on.
 * @param value - The unresolvable value.
 */
function warnUnresolvable(key: string, value: unknown): void {
    const shape = `${key}:${typeof value}`;
    if (warnedShapes.has(shape)) {
        return;
    }
    warnedShapes.add(shape);
    console.warn(
        `[csszyx] dynamic value on "${key}" is a ${typeof value} and cannot be resolved ` +
            'to CSS — the property is omitted. Pass a number, token, or CSS length ' +
            '(for responsive objects, use dynamic()).',
    );
}

/**
 * Resolve a dynamic value on a SPACING-category key into its CSS variable
 * value, matching what the static path would have emitted for the same
 * literal (Tailwind v4 conventions):
 *   - number / numeric string → `calc(v * var(--spacing))` (spacing scale)
 *   - `a/b` fraction → `calc(a / b * 100%)` (w-3/12 parity)
 *   - named tokens → their CSS value (`full` → 100%, `max` → max-content, …);
 *     `screen` resolves per axis from the key (w → 100vw, h → 100vh)
 *   - any other string (raw length, %, calc(), var(), keyword) → verbatim
 *   - undefined/null/other types → undefined ("no value", omit the CSS var)
 * @param v - The runtime value from the sz object.
 * @param key - The sz key the value arrived on (axis + diagnostics).
 * @returns CSS-compatible value string, or undefined when there is none.
 */
export function __szSpacingVar(v: unknown, key: string): string | undefined {
    if (typeof v === 'number') {
        return Number.isFinite(v) ? `calc(${v} * var(--spacing))` : undefined;
    }
    if (typeof v !== 'string' || v === '') {
        if (v !== null && v !== undefined && v !== false && v !== '') {
            warnUnresolvable(key, v);
        }
        return undefined;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(v)) {
        return `calc(${v} * var(--spacing))`;
    }
    const fraction = /^(\d+)\/(\d+)$/.exec(v);
    if (fraction) {
        return `calc(${fraction[1]} / ${fraction[2]} * 100%)`;
    }
    if (v === 'screen') {
        if (VIEWPORT_WIDTH_KEYS.has(key)) {
            return '100vw';
        }
        if (VIEWPORT_HEIGHT_KEYS.has(key)) {
            return '100vh';
        }
        // `screen` is meaningless off the sizing axes — the static class
        // (`p-screen`) generates nothing either. Omit for parity.
        return undefined;
    }
    const named = NAMED_SIZE_TOKENS[v];
    if (named !== undefined) {
        return named;
    }
    // Raw CSS: lengths ('32px', '4rem'), percentages, calc()/var()/min()/…,
    // and keywords ('max-content', 'inherit') pass through verbatim — the
    // static path would have bracketed the same literal into w-[…].
    return v;
}

/**
 * Resolve a dynamic value on an ANGLE/DURATION-category key: bare numbers get
 * the unit appended (rotate: 45 → '45deg'), strings that already carry a unit
 * (or any other CSS expression) pass through verbatim instead of having the
 * unit blindly appended ('45deg' must not become '45degdeg').
 * @param v - The runtime value from the sz object.
 * @param unit - The unit the bare-number form implies ('deg' | 'ms').
 * @param key - The sz key the value arrived on (diagnostics only).
 * @returns CSS-compatible value string, or undefined when there is none.
 */
export function __szUnitVar(v: unknown, unit: string, key: string): string | undefined {
    if (typeof v === 'number') {
        return Number.isFinite(v) ? `${v}${unit}` : undefined;
    }
    if (typeof v !== 'string' || v === '') {
        if (v !== null && v !== undefined && v !== false && v !== '') {
            warnUnresolvable(key, v);
        }
        return undefined;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(v)) {
        return `${v}${unit}`;
    }
    return v;
}
