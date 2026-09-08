/**
 * Class names the project's Tailwind produces no CSS for.
 *
 * `classify` matches a token by class PREFIX and holds no knowledge of which
 * suffixes a prefix accepts, so an app's own `tab-items-wrapper` reads as a
 * `tab-size` utility and a rule sends it to the inner node. A class nothing
 * classifies — `card`, `btn-primary` — is placed by the fallback instead, and
 * that is the correct treatment for both: they are the app's own vocabulary.
 * Today the two differ only by an accident of prefix matching.
 *
 * The runtime cannot tell them apart on its own. Tailwind is a build tool and
 * is not present in the browser this ships to, so the answer has to arrive
 * from the build, which compiles the project's real design system. This module
 * is where it lands.
 *
 * A registered name is placed by the fallback AND stays silent: the unplaced
 * warning asks the developer to decide, and here the build already decided.
 *
 * @module
 */

/** Base names the build reported as producing no CSS. */
const unserved = new Set<string>();

/**
 * Monotonic generation counter — bumped whenever the set changes, so
 * `splitBox` can drop memos that were classified under the old answer.
 */
let _generation = 0;

/**
 * Record the class names the project's Tailwind serves nothing for.
 *
 * Called by the module a build emits. Replaces the whole set rather than
 * adding to it, so a rebuild that drops a name takes it out of effect, and
 * bumps the generation only when the contents actually differ — a dev server
 * re-running an unchanged build should not flush anyone's memo.
 *
 * @param names - Base class names, as written in source.
 */
export function registerUnservedClasses(names: readonly string[]): void {
    const next = new Set(names);
    if (next.size === unserved.size && [...next].every(name => unserved.has(name))) {
        return;
    }
    unserved.clear();
    for (const name of next) unserved.add(name);
    _generation += 1;
}

/**
 * Whether the build reported this base name as producing no CSS.
 *
 * @param base - Token base, variants and important marker already stripped.
 * @returns True when the project's Tailwind serves nothing for it.
 */
export function isUnservedClass(base: string): boolean {
    return unserved.has(base);
}

/**
 * Current registration generation (see {@link registerUnservedClasses}).
 *
 * @returns The generation counter value.
 */
export function getUnservedGeneration(): number {
    return _generation;
}

/** Empty the registry — test-only. */
export function _resetUnservedClasses(): void {
    if (unserved.size === 0) return;
    unserved.clear();
    _generation += 1;
}
