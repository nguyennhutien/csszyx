/**
 * Deterministic, locale-independent ascending sort for string collections.
 *
 * A bare `Array.prototype.sort()` coerces elements to strings, so it silently
 * mis-orders numbers (`[10, 9]` → `[10, 9]`). Every ordered collection in this
 * codebase is a set of identifiers — class names, mangle tokens, filenames,
 * variant names, CSS-variable references — so the correct sort is lexicographic
 * AND locale-independent (a locale-aware `localeCompare` would make build output
 * order depend on the runner's locale and break reproducibility).
 *
 * This helper encodes exactly that, and its `T extends string` bound makes the
 * intent compiler-checked: passing a `number[]` (or a `(string | number)[]`) is a
 * type error, so a future numeric sort cannot slip through as a bare `.sort()`.
 * The `no-restricted-syntax` lint rule forbids bare `.sort()` to route every sort
 * through here or an explicit comparator.
 *
 * @template T - the (string) element type.
 * @param values - the strings to sort (any iterable; not mutated).
 * @returns a new array sorted ascending by UTF-16 code unit.
 */
export function sortStrings<T extends string>(values: Iterable<T>): T[] {
    return [...values].sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    });
}
