/**
 * The approved `internal-error` line, for tests that pin a site's `where`
 * and `detail`: every such site prints the same help and docs lines.
 *
 * @param where - The `where` arg.
 * @param detail - The `detail` arg.
 * @returns The whole message.
 */
export function internalErrorMessage(where: string, detail: string): string {
    return (
        '[csszyx] internal-error:\n' +
        `  An internal check failed in \`${where}\`, so csszyx stops.\n` +
        '  help: report this csszyx bug at https://github.com/nguyennhutien/csszyx/issues with this message, the csszyx version and the bundler or command you ran.\n' +
        `  note: the check that failed: ${detail}.\n` +
        '  docs: https://csszyx.com/e/internal-error'
    );
}
