/**
 * Deterministic, locale-independent ascending sort for string collections.
 *
 * A browser-safe local copy of the compiler's `sortStrings` — runtime ships to
 * the browser and only imports *types* from `@csszyx/compiler`, so it must not
 * pull that build-time package's code (oxc/WASM) into the bundle for a one-line
 * helper. Kept in sync by shape, not by import.
 *
 * The `T extends string` bound makes the intent compiler-checked: a `number[]`
 * (or `(string | number)[]`) is a type error, so a numeric sort cannot slip
 * through as a bare `.sort()`. Locale-independent so hydration checksums and
 * class order stay identical across runtimes.
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
