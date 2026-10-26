/**
 * Own-entry lookup for tables indexed by text an author wrote.
 *
 * Its own module so the runtime helpers (`spacing-var.ts`) share it without
 * pulling in the lowering.
 *
 * @module
 */

/**
 * A table's own entry for text an author wrote. An index or `in` reads
 * `Object.prototype` too: `{ constructor: 'inherit' }` wrote no class and
 * named `Object` in a `removed-key` line, and `{ wrap: 'constructor' }` wrote
 * the text of the `Object` function as a class, where the engine reads both
 * as the words they are.
 *
 * @param table - The table, or none.
 * @param name - The authored key or value.
 * @returns Its own entry, or `undefined`.
 */
export function own<T>(
    table: Readonly<Record<string, T>> | undefined,
    name: string,
): T | undefined {
    return table !== undefined && Object.hasOwn(table, name) ? table[name] : undefined;
}
