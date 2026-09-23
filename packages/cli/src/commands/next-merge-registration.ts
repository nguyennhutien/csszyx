/**
 * Writing the merge table for the Next lanes, without letting it stop them.
 *
 * `csszyx next prebuild` and `csszyx next watch` exist to write the safelist
 * the build needs. The merge table is a second artifact: it only lets
 * Turbopack and jest merge the way the browser does. A write that fails, a
 * read-only or full disk or a path taken by a directory, must not fail the
 * prebuild or end the watch, and must not pass in silence either.
 *
 * @module
 */
import {
    MERGE_REGISTRATION_FILE,
    type MergeRegistrationInput,
    writeMergeRegistration,
} from '@csszyx/unplugin/next-prebuild';

/**
 * Write the merge table, answering with a warning instead of throwing.
 *
 * @param input - The project's census and design system.
 * @returns A warning to print, or null when the table was written.
 */
export function tryWriteMergeRegistration(input: MergeRegistrationInput): string | null {
    try {
        writeMergeRegistration(input);
        return null;
    } catch (error) {
        // Node's fs throws `Error`s, and nothing else runs in between.
        const reason = (error as Error).message;
        return (
            `[csszyx] could not write .csszyx/${MERGE_REGISTRATION_FILE}: ${reason}\n` +
            '  note: the safelist is written; until the file can be written, `szcn` under ' +
            'Turbopack and jest removes only exact repeats, and a Turbopack build keeps every ' +
            'key of an sz object rather than merging one a later key covers.'
        );
    }
}
