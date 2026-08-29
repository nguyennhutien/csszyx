/**
 * A per-key store whose merged view is built when read, not when written.
 *
 * The plugin keeps two aggregates over "what each file contributed": the CSS
 * variable mangle map and the variable hoisting metrics. Both were rebuilt in
 * full — a sort over every file, then a merge — on EVERY write, and a write
 * happens once per module in the prescan and again in the transform hook. That
 * made recording a module cost as much as every module before it: 18 000
 * files with `mangleVars` on spent 77 s here, a 12× build-time regression that
 * the flag's own benchmarks never showed because their fixtures emitted no
 * variables.
 *
 * Readers (`buildEnd`, the virtual map module, the manifest) run after the
 * writes, so building on read costs one merge per build instead of one per
 * file, and a write followed by a read still sees the write.
 *
 * @module
 */

/** A per-key store with a lazily rebuilt merged view. */
export interface LazyAggregate<Entry, Aggregate> {
    /** Contributions by key, in insertion order. */
    readonly entries: ReadonlyMap<string, Entry>;
    /**
     * Record one key's contribution, replacing what it held before.
     *
     * @param key Contribution owner (a normalized filename).
     * @param entry What the owner contributes.
     */
    set(key: string, entry: Entry): void;
    /**
     * Drop one key's contribution.
     *
     * @param key Contribution owner.
     */
    delete(key: string): void;
    /** @returns The merged view, rebuilt only if a write happened since the last read. */
    get(): Aggregate;
}

/**
 * Create a lazily merged per-key store.
 *
 * @param build Merge the current contributions into one view.
 * @param initial The view served until the first write.
 * @returns The store.
 */
export function createLazyAggregate<Entry, Aggregate>(
    build: (entries: ReadonlyMap<string, Entry>) => Aggregate,
    initial: Aggregate,
): LazyAggregate<Entry, Aggregate> {
    const entries = new Map<string, Entry>();
    let current = initial;
    let dirty = false;
    return {
        entries,
        set(key, entry) {
            entries.set(key, entry);
            dirty = true;
        },
        delete(key) {
            if (entries.delete(key)) dirty = true;
        },
        get() {
            if (dirty) {
                current = build(entries);
                dirty = false;
            }
            return current;
        },
    };
}
