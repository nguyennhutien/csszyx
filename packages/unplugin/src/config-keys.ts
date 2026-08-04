/**
 * Unknown-option detection for the plugin config.
 *
 * A plugin option the plugin does not read is silently ignored, and a renamed
 * option is exactly that: `compilePackages` became the path-based
 * `compileSources` before 0.12.0, and a project still passing the old name got
 * no CSS for its workspace package, no cross-module precompile, and not one
 * word from the build. That cost a field user an afternoon.
 *
 * TypeScript catches this when the config is typed, which a `vite.config.ts`
 * usually is — but a `vite.config.js`, a config built from JSON, or an object
 * widened through `as any` all reach the plugin unchecked. This is the runtime
 * half of that guard.
 *
 * Pure functions over plain objects: the key vocabulary and the message are
 * unit-testable without a build.
 *
 * @module config-keys
 */

/** Top-level option names the plugin reads. */
const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
    'include',
    'exclude',
    'compileSources',
    'contentScopeCheck',
    'quiet',
    'mode',
    'development',
    'production',
    'build',
    'hydration',
    'performance',
]);

/**
 * Renamed or removed options, mapped to what replaced them.
 *
 * A rename is the case where silence hurts most: the author believes the option
 * is in effect, so the missing behaviour reads as a csszyx bug rather than a
 * config typo.
 */
const RENAMED_KEYS: Readonly<Record<string, string>> = {
    // Replaced by the path-based form: package NAMES could not express a
    // sibling directory outside the project root, and resolving them meant
    // guessing at workspace layout.
    compilePackages: 'compileSources',
};

/**
 * The nearest known key, when the author plausibly meant one.
 *
 * One edit-distance pass over a set of eleven; a typo of a short option name is
 * within two edits of its target, and beyond that the guess is noise.
 *
 * @param key - The unknown key as authored.
 * @returns The closest known key, or null when nothing is close enough.
 */
export function nearestKnownConfigKey(key: string): string | null {
    const lower = key.toLowerCase();
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of KNOWN_TOP_LEVEL_KEYS) {
        const distance = editDistance(lower, candidate.toLowerCase());
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    // Two edits on a short name is already a stretch; scale the budget so
    // `quiet` does not "match" `mode`.
    return best !== null && bestDistance <= Math.max(1, Math.floor(key.length / 4)) ? best : null;
}

/**
 * Levenshtein distance, two rows instead of a full matrix.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Edit distance between them.
 */
function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            current.push(Math.min(substitution, previous[j] + 1, current[j - 1] + 1));
        }
        previous = current;
    }
    return previous[b.length];
}

/** One unrecognized option and the best guess at what was meant. */
export interface UnknownConfigKey {
    /** The key as authored. */
    key: string;
    /** What replaced it, when it is a known rename. */
    renamedTo?: string;
    /** Nearest known key, when it looks like a typo. */
    suggestion?: string;
}

/**
 * Find the option keys the plugin will not read.
 *
 * Top level only. Nested config objects are typed unions whose unknown members
 * are a different, much rarer mistake, and probing them would mean duplicating
 * the whole schema here — which is the trap the option itself fell into.
 *
 * @param options - The authored plugin options.
 * @returns Unrecognized keys, in the order they were authored.
 */
export function findUnknownConfigKeys(options: unknown): UnknownConfigKey[] {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        return [];
    }
    const unknown: UnknownConfigKey[] = [];
    for (const key of Object.keys(options)) {
        if (KNOWN_TOP_LEVEL_KEYS.has(key)) continue;
        const renamedTo = RENAMED_KEYS[key];
        if (renamedTo !== undefined) {
            unknown.push({ key, renamedTo });
            continue;
        }
        const suggestion = nearestKnownConfigKey(key);
        unknown.push(suggestion === null ? { key } : { key, suggestion });
    }
    return unknown;
}

/**
 * Render the unknown-option warning.
 *
 * @param unknown - Keys from {@link findUnknownConfigKeys}.
 * @returns The warning text, already `[csszyx]`-prefixed.
 */
export function unknownConfigKeysMessage(unknown: readonly UnknownConfigKey[]): string {
    const lines = unknown.map(entry => {
        if (entry.renamedTo !== undefined) {
            return `  - \`${entry.key}\` was replaced by \`${entry.renamedTo}\``;
        }
        return entry.suggestion === undefined
            ? `  - \`${entry.key}\``
            : `  - \`${entry.key}\` — did you mean \`${entry.suggestion}\`?`;
    });
    return (
        `[csszyx] ${unknown.length} plugin option(s) are not recognized and have no ` +
        `effect:\n${lines.join('\n')}\n` +
        'An unread option is silent, so whatever you configured it for is not ' +
        'happening.'
    );
}
