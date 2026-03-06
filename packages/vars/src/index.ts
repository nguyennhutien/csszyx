/**
 * @csszyx/vars — CSS custom property helpers for runtime-driven styling.
 *
 * Zero-runtime CSSzyx handles static sz props at build time.
 * This package handles values that come from an API, CMS, or user config
 * at runtime, injected as CSS custom properties so Tailwind-generated
 * classes like `bg-(--cfg-bg)` resolve correctly.
 *
 * Works standalone (no React required). React hook: @csszyx/vars/react
 */

/**
 *
 */
export type SzVars = Record<string, string | number>;

/**
 * Apply CSS custom properties to an element.
 * Keys are auto-prefixed with `--` if not already.
 * Returns a cleanup function that removes all applied properties.
 *
 * @param vars - Record of CSS var name → value. Keys auto-prefixed with `--`.
 * @param element - Target element. Defaults to `document.documentElement` (`:root`).
 * @returns Cleanup function that removes all applied properties.
 *
 * @example
 * const cleanup = applySzVars({ 'form-bg': '#fff', 'form-p': '24px' }, formEl);
 * // → formEl.style: --form-bg: #fff; --form-p: 24px
 * // cleanup() → removes them
 */
export function applySzVars(
    vars: SzVars,
    element: HTMLElement = document.documentElement,
): () => void {
    const applied: string[] = [];

    for (const [key, value] of Object.entries(vars)) {
        const name = key.startsWith('--') ? key : `--${key}`;
        element.style.setProperty(name, String(value));
        applied.push(name);
    }

    return () => {
        for (const name of applied) {
            element.style.removeProperty(name);
        }
    };
}

/**
 * Update CSS custom properties on an element without full re-apply.
 * Only sets changed values — useful for frequent updates (drag sliders, etc.)
 *
 * @param vars - Record of CSS var name → value. Keys auto-prefixed with `--`.
 * @param element - Target element. Defaults to `document.documentElement` (`:root`).
 */
export function patchSzVars(
    vars: SzVars,
    element: HTMLElement = document.documentElement,
): void {
    for (const [key, value] of Object.entries(vars)) {
        const name = key.startsWith('--') ? key : `--${key}`;
        element.style.setProperty(name, String(value));
    }
}
