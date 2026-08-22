/**
 * Paths that cross the CLI's edge, made platform-independent.
 *
 * Inbound, a glob typed on Windows carries `\` where fast-glob expects `/`,
 * and fast-glob reads `\` as an escape — the pattern silently matches nothing
 * and a scan reports zero files as a clean result. Outbound, `path.relative`
 * on Windows yields `src\App.tsx`, and that string is a machine-read contract
 * in `--json` output, so it must not vary by host.
 */
import path from 'node:path';

/**
 * A path or glob with forward slashes, as fast-glob and `--json` consumers
 * read it.
 *
 * The separator a hook or a shell happens to use is not a statement about the
 * filesystem, so it is normalised at the door. A path with no backslash is
 * returned as the same string.
 *
 * @param given - A path or glob as typed.
 * @returns The same path with forward slashes.
 */
export function withPosixSeparators(given: string): string {
    return given.includes('\\') ? given.replaceAll('\\', '/') : given;
}

/**
 * `path.relative`, emitted with forward slashes on every platform.
 *
 * @param from - Base directory.
 * @param to - Target path.
 * @param pathApi - The path module to compute with; tests pass `path.win32`
 *   to pin the Windows answer from any host.
 * @returns The relative path, posix-spelled.
 */
export function relativePosix(from: string, to: string, pathApi: path.PlatformPath = path): string {
    return pathApi.relative(from, to).split(pathApi.sep).join('/');
}
