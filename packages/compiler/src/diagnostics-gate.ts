/**
 * Process-wide switch for build ADVISORY diagnostics (`build.warn`).
 *
 * Advisory diagnostics tell the author something was skipped, unresolvable, or
 * suspicious while the build still produced output: the sz runtime-fallback
 * matrix, unresolvable spreads, szs/szRecover shape notices, style-spread
 * collisions. `build.warn: false` runs the transform as a single pass with none
 * of that machinery — the escape hatch ADR 0011 promises while its removal
 * criterion (off ≡ on-with-zero-findings, measured) is still unproven.
 *
 * Deliberately NOT gated here: failures where output was withheld — the AST
 * budget and oxc-unsupported errors (thrown, not collected) and the Rust
 * engine's file-unchanged notices. Silencing those would reintroduce the
 * silently-dropped-output class this codebase has been bitten by before.
 *
 * Module state rather than a parameter because the emission sites sit many
 * frames below the public entries, on both the Babel and oxc lanes; threading a
 * boolean through every signature would dwarf the feature. The transforms are
 * synchronous and single-threaded, and the entries reset the flag in
 * `finally`, so the state cannot leak across calls — the same contract
 * `setSzWarnLocation` already relies on.
 *
 * @module diagnostics-gate
 */

/** Current switch state. Defaults on: warnings are opt-out, not opt-in. */
let advisoryDiagnosticsEnabled = true;

/**
 * Set the advisory-diagnostics switch for the transform call in progress.
 *
 * @param enabled - False to run without advisory diagnostics.
 */
export function setSzAdvisoryDiagnostics(enabled: boolean): void {
    advisoryDiagnosticsEnabled = enabled;
}

/**
 * Whether advisory diagnostics are enabled for the transform call in progress.
 *
 * @returns The current switch state.
 */
export function szAdvisoryDiagnosticsEnabled(): boolean {
    return advisoryDiagnosticsEnabled;
}

/**
 * Collect one advisory diagnostic, unless the switch is off.
 *
 * Takes a thunk so a disabled run skips the message formatting too — the
 * one-pass contract is "no diagnostic work", not "diagnostic work, discarded".
 *
 * @param diagnostics - Sink for the current transform.
 * @param build - Produces the message; only called when enabled.
 */
export function pushAdvisoryDiagnostic(diagnostics: string[], build: () => string): void {
    if (advisoryDiagnosticsEnabled) {
        diagnostics.push(build());
    }
}
