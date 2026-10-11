/**
 * Resolving `csszyx.config` into `.csszyx/` for the Next lanes that cannot
 * load it.
 *
 * The Turbopack loader runs one module at a time, synchronously, and never
 * imports TypeScript, so `csszyx next prebuild` and `csszyx next watch` load
 * the config and write the resolved policy beside the merge table. Like that
 * table it is a second artifact: a write that fails must not fail the
 * prebuild or end the watch, and must not pass in silence either.
 *
 * @module
 */
import path from 'node:path';

import {
    type DeadClassFinding,
    DIAGNOSTIC_POLICY_STATE_FILE,
    type DiagnosticLimiter,
    type DiagnosticPolicy,
    type DiagnosticPolicyInput,
    diagnosticConfigProblemsMessage,
    diagnosticPolicyInputs,
    loadCurrentDiagnosticPolicy,
    reportDeadSzClasses,
    resolveQuietMode,
    shouldHoldAdvisories,
    suppressedAdvisoryMessage,
    writeDiagnosticPolicyState,
} from '@csszyx/unplugin/diagnostics';

/**
 * Load the project's config and write its policy for the loader, with the
 * files the load read: the loader and jest load the config themselves once
 * one of them changed.
 *
 * Loaded so that every module the config imports is read as it is now
 * (`loadCurrentDiagnosticPolicy`): `next watch` loads it again in its own
 * process, where Node still holds each module as first imported, and a
 * policy file whose inputs are new and whose levels are not would be
 * trusted by every lane that reads it.
 *
 * @param root - The project root.
 * @returns The policy, for the command's own reports, the files it was read
 *          from, and the warnings to print: the config's problems, and a
 *          failed write.
 */
export async function writeNextDiagnosticPolicy(
    root: string,
): Promise<{ policy: DiagnosticPolicy; inputs: DiagnosticPolicyInput[]; warnings: string[] }> {
    // Before the load, so an edit made while it runs reads as a change.
    const inputs = diagnosticPolicyInputs(root);
    const loaded = await loadCurrentDiagnosticPolicy(root, inputs);
    const warnings: string[] = [];
    if (loaded.file !== null && loaded.problems.length > 0) {
        warnings.push(diagnosticConfigProblemsMessage(path.basename(loaded.file), loaded.problems));
    }
    try {
        writeDiagnosticPolicyState(root, loaded.policy, inputs);
    } catch (error) {
        // Node's fs throws `Error`s, and nothing else runs in between.
        warnings.push(
            `[csszyx] could not write .csszyx/${DIAGNOSTIC_POLICY_STATE_FILE}: ${(error as Error).message}\n` +
                '  note: the safelist is written; until the file can be written, the Turbopack ' +
                'loader reports every diagnostic at its default level.',
        );
    }
    return { policy: loaded.policy, inputs, warnings };
}

/**
 * The lines a Next command prints for the `sz` classes the project's Tailwind
 * serves nothing for, at the level the policy gives `dead-class`, followed by
 * what the cap held back.
 *
 * The Turbopack loader cannot compile the project's CSS, so the commands that
 * settle the merge table are where the question is asked, as the bundler
 * plugins ask it when they settle theirs. They follow the loader's switches:
 * `CSSZYX_QUIET_SZ_WARNINGS=1` mutes them, and a production prebuild counts an
 * `info` finding in one closing line, as a production build does.
 *
 * @param dead - The dead classes the registration found.
 * @param policy - The project's policy.
 * @param limiter - The command's dedupe record, kept across a watch session.
 * @param development - Whether this is a dev session, which lists `info`.
 * @param env - The environment the switches are read from.
 * @returns The lines to print.
 */
export function nextDeadClassLines(
    dead: readonly DeadClassFinding[],
    policy: DiagnosticPolicy,
    limiter: DiagnosticLimiter,
    development: boolean,
    env: Record<string, string | undefined> = process.env,
): string[] {
    const quiet = resolveQuietMode(env.CSSZYX_QUIET_SZ_WARNINGS === '1');
    const { lines, held } = reportDeadSzClasses(dead, {
        policy,
        quiet,
        // A prebuild that is not a dev session is a production build.
        holdInfo: shouldHoldAdvisories(quiet, development, 'production'),
        limiter,
    });
    const closing = suppressedAdvisoryMessage(held);
    return [...lines, ...limiter.flush(), ...(closing === null ? [] : [closing])];
}
