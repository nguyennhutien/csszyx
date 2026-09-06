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

/**
 * Most distinct messages one session will print. Every other cache in the
 * runtime is capped, and this one takes strings interpolated from the user's
 * className — a class built from data (`user-data-${id}`) would otherwise grow
 * it without bound for as long as the dev server runs; measured at 50 000
 * distinct tokens it held 37–59 MB.
 *
 * Admission stops at the cap rather than clearing, because clearing would
 * print the same data-driven flood again every 512 messages. But a cache that
 * goes quiet is a gate that went blind, so the first suppressed message is
 * replaced by one line saying that it happened and what usually causes it.
 */
const WARNED_MAX = 512;
const warned = new Set<string>();
/** Whether the one-time "suppressed from here" line has been printed. */
let announcedCap = false;

/**
 * Emit a `[csszyx]` warning once per unique message, only outside production.
 * After 512 distinct messages, prints one line saying further warnings are
 * suppressed, then stays silent until {@link resetDevWarnCache}.
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
    if (warned.size >= WARNED_MAX) {
        if (!announcedCap) {
            announcedCap = true;
            console.warn(
                `[csszyx] ${WARNED_MAX} distinct development warnings have been printed; further ones are suppressed for this session. ` +
                    'help: a className built from data is the usual cause — look above for one warning repeating with different values.',
            );
        }
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
    announcedCap = false;
}
