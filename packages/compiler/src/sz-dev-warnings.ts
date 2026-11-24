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
 * `globalThis.__CSSZYX_SZ_WARNINGS_IN_BROWSER__`, which the development CDN
 * bundle's build (`packages/csszyx/cdn-build.mjs`) defines, and no other; absent
 * when run from source or from any other bundle. Read as a property of
 * `globalThis`, written out at the read, so a bundle that does not define it
 * reads `undefined` instead of throwing on an undeclared name, and esbuild's
 * `define` replaces that member expression where it is defined.
 */
interface BrowserWarningsGlobal {
    __CSSZYX_SZ_WARNINGS_IN_BROWSER__?: true;
}

/**
 * Whether a dev-mode sz diagnostic may print here: in a Node/SSR context only
 * (never the browser client — the warnings would double a server-side render),
 * and unless `CSSZYX_QUIET_SZ_WARNINGS=1` mutes them. The development CDN
 * bundle is the exception: a script-tag page has no server render to double,
 * so its build defines `__CSSZYX_SZ_WARNINGS_IN_BROWSER__`, which esbuild folds
 * here, and the browser prints them. Every other bundle leaves it undefined. The opt-out lets a team
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
    if (mutedRuns > 0) {
        mutedAttempts++;
        return false;
    }
    return (
        ((globalThis as BrowserWarningsGlobal).__CSSZYX_SZ_WARNINGS_IN_BROWSER__ !== undefined ||
            typeof window === 'undefined') &&
        process.env.CSSZYX_QUIET_SZ_WARNINGS !== '1'
    );
}

/** How many {@link withSzWarningsMuted} runs are open. */
let mutedRuns = 0;

/** How many warnings a muted run reached the gate of, and so held back. */
let mutedAttempts = 0;

/**
 * Whether a {@link withSzWarningsMuted} run is open, for a caller whose own
 * record would only restate the value the run lowers, so it is no warning.
 *
 * @returns True inside a muted run.
 */
export function szWarningsMuted(): boolean {
    return mutedRuns > 0;
}

/**
 * Whether an open {@link withSzWarningsMuted} run holds this warning back,
 * counted as one it held. For a warning that prints wherever it is lowered,
 * the browser included, so it asks no other gate: an alignment value on a
 * prop-API component is resolved through `_sz` on the client.
 *
 * @returns True inside a muted run.
 */
export function szWarningHeld(): boolean {
    if (mutedRuns > 0) mutedAttempts++;
    return mutedRuns > 0;
}

/**
 * Run a trial lowering whose warnings would name a value the author did not
 * write: the value of a bracketed spelling without its brackets, lowered to
 * read the class its key writes. Both gates are shut while it runs, the
 * development one ({@link szNodeWarningsUnmuted}) and the one the
 * every-mode warnings read ({@link szWarningsQuiet}), so the trial prints
 * nothing and takes no warning's dedup slot. A warning asks a gate only once
 * it has found something to say, so the run also counts how many it held
 * back: whether the lowering reports anything, whatever a dedup set already
 * printed.
 *
 * @param run - The lowering.
 * @returns What `run` returns, and how many warnings it held back.
 */
export function withSzWarningsMuted<T>(run: () => T): { result: T; held: number } {
    const before = mutedAttempts;
    mutedRuns++;
    try {
        const result = run();
        return { result, held: mutedAttempts - before };
    } finally {
        mutedRuns--;
    }
}

/**
 * Whether `CSSZYX_QUIET_SZ_WARNINGS=1` mutes the sz warnings that print in
 * every mode — a replaced or removed key, a moved value, a stand-alone key a
 * later group replaces. Those report a class csszyx did not emit, so they reach
 * production and the browser console (ADR 0011) instead of folding away with
 * `NODE_ENV`; the switch still mutes them, as it mutes every sz key and value
 * warning. Safe where `process` does not exist, as in a browser bundle that
 * defines only `process.env.NODE_ENV`.
 *
 * @returns Whether the switch is set.
 */
export function szWarningsQuiet(): boolean {
    // `process.env.X` written plainly, not `process.env?.X`, so a bundler's
    // `define` can fold it: the CDN bundle defines it away and keeps no
    // `process.env` at all. The `typeof` guard covers a bundle that does not.
    if (mutedRuns > 0) {
        mutedAttempts++;
        return true;
    }
    return typeof process !== 'undefined' && process.env.CSSZYX_QUIET_SZ_WARNINGS === '1';
}
