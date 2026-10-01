/**
 * The gate every `sz` key/value dev warning has to pass.
 *
 * These warnings fire while a value is being lowered, so they are emitted from
 * whichever path is doing the lowering — the TypeScript transform, or the
 * pre-validation that runs when the WASM core takes over. Each path had its own
 * copy of the condition, and the copies drifted: one honoured
 * `CSSZYX_QUIET_SZ_WARNINGS` and the other did not, which made a documented
 * switch work or not depending on which engine happened to be active.
 *
 * Lives in its own module so both paths can import it without a cycle.
 *
 * @module
 */

/**
 * Whether a dev-mode sz diagnostic may print here: in a Node/SSR context only
 * (never the browser client — the warnings would double a server-side render),
 * and unless `CSSZYX_QUIET_SZ_WARNINGS=1` mutes them. The opt-out lets a team
 * that prefers a quiet dev loop rely on `csszyx check` instead; the default
 * stays ON because an unknown/aliased key is a dropped-class correctness
 * signal, not a style nudge.
 *
 * It does NOT read `NODE_ENV`. Every caller writes
 * `process.env.NODE_ENV === 'production' || !szNodeWarningsUnmuted()` (or the
 * `!==` / `&&` form) itself, because only that spelling at the call site is
 * folded by an app's bundler, which then drops the warning and its message
 * from a production bundle; behind a call it ships to every user. Reading it
 * here as well would make each development check touch `process.env` twice,
 * and on Node that read is a call into the host. `dev-warning-guard.test.ts`
 * fails a call site without the check.
 *
 * @returns Whether a dev-mode sz warning should be printed, given development.
 */
export function szNodeWarningsUnmuted(): boolean {
    return typeof window === 'undefined' && process.env.CSSZYX_QUIET_SZ_WARNINGS !== '1';
}
