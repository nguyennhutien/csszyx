/**
 * Deterministic, locale-independent ascending sort for string collections.
 *
 * A local copy of the compiler's `sortStrings`. Some unplugin source files (the
 * Next.js state/watcher modules) are unit-tested WITHOUT a workspace build, so
 * they must not import a value from `@csszyx/compiler` — its package entry points
 * at `dist/`, which does not exist in that job. Kept in sync by shape, not import.
 *
 * The `T extends string` bound makes the string-only intent compiler-checked: a
 * `number[]` (or `(string | number)[]`) is a type error, so a numeric sort cannot
 * slip through as a bare `.sort()`. Locale-independent so safelist / class order
 * stays reproducible across runners.
 *
 * @template T - the (string) element type.
 * @param values - the strings to sort (any iterable; not mutated).
 * @returns a new array sorted ascending by UTF-16 code unit.
 */
export function sortStrings<T extends string>(values: Iterable<T>): T[] {
    return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
