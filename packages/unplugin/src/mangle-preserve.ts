/**
 * `production.manglePreserve` and the `mangleExclude` sanity check.
 *
 * Mangling renames every csszyx-owned class to a short token. A stylesheet
 * that matches classes by NAME — `[class*="bg-tag"]` — stops matching the
 * moment the names are gone, and `mangleExclude` cannot help: it keeps the
 * allocator from EMITTING a token equal to an external class, it never keeps
 * a class from being renamed. `manglePreserve` is that other switch.
 *
 * Entries are strings. An exact name keeps one class; a name whose LAST
 * character is `*` keeps every class that starts with the rest. Either form
 * reads a class under its variants too — `bg-tag-*` keeps `dark:bg-tag-blue`,
 * because the stylesheet that matches the name by text matches it under every
 * variant. Naming a variant form (`dark:bg-tag-blue`) keeps that form alone. A `*` anywhere
 * else is an ordinary character, because csszyx itself emits `*:p-4`,
 * `**:m-2` and `[&>*]:gap-1` — and no class it emits ends in `*`, so the
 * trailing position is the one place the wildcard is unambiguous. Regular
 * expressions were considered and set aside: a stateful flag (`g`/`y`) makes
 * `.test` alternate its answer across a sorted census, a RegExp serialises to
 * `{}` in the config hash, and a pathological pattern stalls the build for
 * seconds per class.
 */

/** Matches class names against a compiled `manglePreserve` list. */
export interface ManglePreserveMatcher {
    /** The entries as configured, in order. */
    readonly entries: readonly string[];
    /**
     * Whether a class keeps its name.
     *
     * @param className - A csszyx-owned class.
     * @returns True when some entry names or prefixes it.
     */
    test(className: string): boolean;
    /**
     * The entries no class in the census satisfied — a typo, or a class that
     * no longer exists.
     *
     * @param census - Every csszyx-owned class of the build.
     * @returns The unmatched entries, in configured order.
     */
    unmatched(census: Iterable<string>): string[];
}

/**
 * The utility part of a class, with any variant prefixes removed.
 *
 * An entry names a utility, and a stylesheet that matches that name by text
 * matches it under every variant, so `bg-tag-*` has to keep `dark:bg-tag-blue`
 * as well as `bg-tag-blue`. The split is the last `:` outside brackets: a
 * variant may carry a parameter that contains one of its own
 * (`supports-[display:grid]:`), and that colon is part of the parameter.
 *
 * @param className - A csszyx-owned class.
 * @returns The class from after its last variant separator.
 */
function utilityOf(className: string): string {
    let depth = 0;
    let start = 0;
    for (let index = 0; index < className.length; index += 1) {
        const char = className[index];
        if (char === '[') depth += 1;
        else if (char === ']') depth = Math.max(0, depth - 1);
        else if (char === ':' && depth === 0) start = index + 1;
    }
    return className.slice(start);
}

/**
 * Compile the configured list into a matcher, refusing what would misbehave
 * silently.
 *
 * @param entries - `production.manglePreserve` as configured.
 * @returns The matcher; a no-op one when the option is unset.
 * @throws when an entry is not a non-empty string, or is a lone `*`, which
 * would keep every class and turn mangling into a no-op without a word.
 */
export function compileManglePreserve(
    entries: readonly string[] | undefined,
): ManglePreserveMatcher {
    const list = entries ?? [];
    list.forEach((entry, index) => {
        if (typeof entry !== 'string' || entry.length === 0) {
            throw new TypeError(
                `[csszyx] production.manglePreserve[${index}] must be a non-empty string ` +
                    `(an exact class name, or a prefix ending in \`*\`); got ${describe(entry)}.`,
            );
        }
        if (entry === '*') {
            throw new TypeError(
                '[csszyx] production.manglePreserve must not contain a lone `*`: it would keep ' +
                    'every class and silently turn `production.mangle` into a no-op. Name a prefix ' +
                    '(`bg-tag-*`) or set `production.mangle: false`.',
            );
        }
    });
    /**
     * The names an entry may be compared against. Computed once per class:
     * the split is a scan of the name, and a census runs to tens of
     * thousands of classes.
     *
     * @param className - A csszyx-owned class.
     * @returns The class as written, plus its utility name when they differ.
     */
    const candidates = (className: string): readonly string[] => {
        const base = utilityOf(className);
        return base === className ? [className] : [className, base];
    };
    /**
     * Whether one entry keeps a class — the single rule both members ask.
     *
     * @param entry - One configured entry.
     * @param names - The class's candidate names.
     * @returns True when the entry names or prefixes the class.
     */
    const keeps = (entry: string, names: readonly string[]): boolean =>
        entry.endsWith('*')
            ? names.some(name => name.startsWith(entry.slice(0, -1)))
            : names.includes(entry);
    const test = (className: string): boolean => {
        if (list.length === 0) return false;
        const names = candidates(className);
        return list.some(entry => keeps(entry, names));
    };
    return {
        entries: list,
        test,
        unmatched(census) {
            if (list.length === 0) return [];
            const forms = [...census].map(candidates);
            // Asked of the same rule as `test`, or an entry whose only form in
            // this build carries a variant reads as a typo.
            return list.filter(entry => !forms.some(names => keeps(entry, names)));
        },
    };
}

/**
 * Describe a rejected entry for the error message.
 *
 * @param value - The entry as configured.
 * @returns A short rendering of its type and value.
 */
function describe(value: unknown): string {
    if (typeof value === 'string') return 'an empty string';
    if (value instanceof RegExp) return `a RegExp (${String(value)})`;
    return `${typeof value} ${JSON.stringify(value) ?? String(value)}`;
}

/**
 * The warning for `manglePreserve` entries no class satisfied.
 *
 * A silent no-op here is the very defect the option exists to fix: the author
 * believes the dark theme is safe, the build is green, the class was renamed.
 *
 * @param entries - The unmatched entries.
 * @returns The complete message.
 */
export function manglePreserveNoMatchMessage(entries: readonly string[]): string {
    const sample = entries.slice(0, 8).join(', ');
    const noun = entries.length === 1 ? 'entry' : 'entries';
    return (
        `[csszyx] production.manglePreserve: ${entries.length} ${noun} matched no csszyx class ` +
        `in this build (${sample}) — nothing was preserved for them. Check the spelling against ` +
        'the class census; an entry keeps a class only when its name is exact, or when it ends ' +
        'in `*` and the class starts with the rest.'
    );
}

/** The alphabet every mangle token is drawn from. */
const TOKEN_CHARACTERS = /^[0-9a-z]+$/i;

/**
 * The `mangleExclude` entries that can never equal a token.
 *
 * Tokens are short base62 strings, so a name with a `-`, a `_`, a `:` or any
 * other character outside that alphabet is never allocated, and reserving it
 * does nothing — which reads, to an author who meant "keep this class", as
 * the option quietly failing.
 *
 * @param entries - `production.mangleExclude` as configured.
 * @returns The entries that do nothing, in configured order.
 */
export function mangleExcludeNeverTokenEntries(entries: Iterable<string>): string[] {
    return [...entries].filter(entry => !TOKEN_CHARACTERS.test(entry));
}

/**
 * The warning for `mangleExclude` entries that can never be a token.
 *
 * @param entries - The entries that do nothing.
 * @returns The complete message.
 */
export function mangleExcludeNeverTokenMessage(entries: readonly string[]): string {
    const sample = entries.slice(0, 8).join(', ');
    const noun = entries.length === 1 ? 'name' : 'names';
    return (
        `[csszyx] production.mangleExclude: ${entries.length} ${noun} can never be a mangle ` +
        `token (${sample}) — tokens are short base62 strings, so those entries do nothing. ` +
        'To keep a class from being renamed, list it in `production.manglePreserve` instead.'
    );
}
