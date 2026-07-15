const WINDOWS_PATH_SEPARATOR = String.fromCodePoint(92);

/**
 * Normalize Windows path separators without changing any other path content.
 *
 * @param value Filesystem path or glob pattern.
 * @returns Path using forward slashes.
 */
export function normalizePathSeparators(value: string): string {
    return value.split(WINDOWS_PATH_SEPARATOR).join('/');
}
