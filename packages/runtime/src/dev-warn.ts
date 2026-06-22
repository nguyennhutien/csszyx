/**
 * Shared development-only warning helper. Centralizes the
 * `if (process.env.NODE_ENV !== 'production') console.warn('[csszyx] …')` pattern
 * that was otherwise duplicated across the runtime, so a single call site is
 * dead-code-eliminated in production and warnings stay consistently prefixed and
 * de-duplicated (a hot path — e.g. a szv factory rendered per row — must not spam
 * the console with the same message).
 *
 * @module
 */

const warned = new Set<string>();

/**
 * Emit a `[csszyx]` warning once per unique message, only outside production.
 * No-op (and tree-shakeable) when `process.env.NODE_ENV === 'production'`.
 *
 * @param message - The warning text (the `[csszyx] ` prefix is added).
 */
export function devWarn(message: string): void {
    if (process.env.NODE_ENV === 'production') {
        return;
    }
    if (warned.has(message)) {
        return;
    }
    warned.add(message);
    console.warn(`[csszyx] ${message}`);
}

/**
 * Clear the de-dup cache. Test-only — lets a suite assert the same warning fires
 * again after a reset.
 */
export function resetDevWarnCache(): void {
    warned.clear();
}
