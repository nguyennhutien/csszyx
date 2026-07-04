/**
 * @csszyx/vars/react — React hook for CSS variable injection.
 * Requires React >=18. Import from "@csszyx/vars/react".
 */

import { type RefObject, useEffect, useRef } from 'react';

import { patchSzVars, type SzVars } from './index.js';

/**
 * Reactively apply CSS custom properties to an element.
 * Re-applies whenever `vars` content changes.
 *
 * @param vars  - Record of CSS var name → value. Keys auto-prefixed with `--`.
 * @param ref   - Target element ref. Defaults to document.documentElement (:root).
 *
 * @example
 * const formRef = useRef<HTMLDivElement>(null);
 * useSzVars({ 'form-bg': config.bg, 'form-p': config.padding }, formRef);
 * // → <div ref={formRef}> gets --form-bg and --form-p on every config change
 */
export function useSzVars(vars: SzVars, ref?: RefObject<HTMLElement | null>): void {
    // Keep a ref to latest vars to avoid stale closure in effect
    const latestVars = useRef(vars);
    latestVars.current = vars;

    useEffect(() => {
        const el = ref?.current ?? document.documentElement;
        if (!el) {
            return;
        }
        patchSzVars(latestVars.current, el);
    });
    // No dep array — runs after every render, intentional:
    // patchSzVars only calls setProperty for entries that changed (cheap DOM op).
}
