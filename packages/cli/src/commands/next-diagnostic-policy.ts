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
    DIAGNOSTIC_POLICY_STATE_FILE,
    diagnosticConfigProblemsMessage,
    loadDiagnosticPolicy,
    writeDiagnosticPolicyState,
} from '@csszyx/unplugin/diagnostics';

/**
 * Load the project's config and write its policy for the loader.
 *
 * @param root - The project root.
 * @returns Warnings to print: the config's problems, and a failed write.
 */
export async function writeNextDiagnosticPolicy(root: string): Promise<string[]> {
    const loaded = await loadDiagnosticPolicy(root);
    const warnings: string[] = [];
    if (loaded.file !== null && loaded.problems.length > 0) {
        warnings.push(diagnosticConfigProblemsMessage(path.basename(loaded.file), loaded.problems));
    }
    try {
        writeDiagnosticPolicyState(root, loaded.policy);
    } catch (error) {
        // Node's fs throws `Error`s, and nothing else runs in between.
        warnings.push(
            `[csszyx] could not write .csszyx/${DIAGNOSTIC_POLICY_STATE_FILE}: ${(error as Error).message}\n` +
                '  note: the safelist is written; until the file can be written, the Turbopack ' +
                'loader reports every diagnostic at its default level.',
        );
    }
    return warnings;
}
