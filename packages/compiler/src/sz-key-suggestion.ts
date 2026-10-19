/**
 * The key an unknown sz key was probably meant to be.
 *
 * An unknown key is lowered as a literal class, because a project may serve it
 * with `@utility`, so the diagnostic cannot say the key is wrong — only that
 * nothing built in serves it. When a known key is one edit away, naming it is
 * the difference between "check for typos" and the typo itself. The answer is
 * text beside the diagnostic and never a rewrite, so the rules below are tuned
 * against custom utility names a project plausibly defines: a wrong hint costs
 * the reader more than no hint.
 *
 * @module sz-key-suggestion
 */

import {
    BOOLEAN_SHORTHANDS,
    KNOWN_SPECIAL_PROPERTIES,
    KNOWN_VARIANTS,
    PROPERTY_MAP,
    SUGGESTION_MAP,
} from './transform-core.js';

/**
 * The target of the nearest candidate name, when exactly one target is nearest.
 *
 * Case is ignored, and a swap of two neighbouring letters counts as one edit —
 * `dispaly` is one mistake, not two. Two different targets at the same distance
 * answer nothing: picking one would be a guess presented as a finding.
 *
 * @param key - The name as authored.
 * @param candidates - Known names, each with the target to suggest for it.
 * @param maxDistance - The largest edit distance still worth suggesting.
 * @returns The target, or null when nothing is near enough or two targets tie.
 * @example
 * nearestName('dispaly', [['display', 'display']], 1); // 'display'
 */
export function nearestName(
    key: string,
    candidates: Iterable<readonly [name: string, target: string]>,
    maxDistance: number,
): string | null {
    const lower = key.toLowerCase();
    let best = Number.POSITIVE_INFINITY;
    const targets = new Set<string>();
    for (const [name, target] of candidates) {
        // The distance is never below the length difference, so a name that
        // far off cannot come within budget; skipping it leaves the answer
        // unchanged and keeps a long generated key from costing a full row
        // per candidate.
        if (Math.abs(name.length - key.length) > maxDistance) continue;
        // Bounded by the best so far: a name that cannot beat it, or tie it,
        // within budget is settled as soon as its rows say so.
        const distance = editDistance(lower, name.toLowerCase(), Math.min(best, maxDistance));
        if (distance < best) {
            best = distance;
            targets.clear();
        }
        if (distance === best) targets.add(target);
    }
    if (best > maxDistance || targets.size !== 1) return null;
    const [target] = targets;
    return target;
}

/**
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions,
 * given up once it is known to exceed a bound.
 *
 * A cell is never below the smallest cell of the row above it (a
 * transposition from two rows back is matched by the diagonal through the row
 * between), so once a whole row is past the bound the distance is too.
 *
 * @param a - First string.
 * @param b - Second string.
 * @param bound - The largest distance the caller can use.
 * @returns The number of edits between them, or `bound + 1` when it is larger.
 */
function editDistance(a: string, b: string, bound: number): number {
    // Three rows, because a transposition looks two rows back.
    let twoBack: number[] = [];
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            let distance = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                distance = Math.min(distance, twoBack[j - 2] + 1);
            }
            current.push(distance);
        }
        if (Math.min(...current) > bound) return bound + 1;
        twoBack = previous;
        previous = current;
    }
    return previous[b.length];
}

/** An identifier-shaped canonical key, as opposed to a prose suggestion. */
const BARE_KEY = /^[a-z][a-z0-9]*$/i;

/** Every known key and alias, lower-cased, by length, each with the key to suggest. */
interface SzKeyNameIndex {
    /** `byLength[n]`: the names of `n` characters, lower-cased, with their targets. */
    byLength: ReadonlyArray<ReadonlyArray<readonly [lower: string, target: string]> | undefined>;
    /** The length of the longest name. */
    longest: number;
}

/** Built on first use. */
let szKeyNameIndex: SzKeyNameIndex | undefined;

/**
 * Known keys and aliases, each paired with the key to suggest for it, by
 * length.
 *
 * @returns The index.
 */
function knownSzKeyNames(): SzKeyNameIndex {
    if (szKeyNameIndex === undefined) {
        const names = new Map<string, string>();
        for (const key of [
            ...Object.keys(PROPERTY_MAP),
            ...KNOWN_SPECIAL_PROPERTIES,
            ...BOOLEAN_SHORTHANDS,
            ...KNOWN_VARIANTS,
        ]) {
            names.set(key, key);
        }
        // An alias suggests its canonical key: `workBreak` is nearest the alias
        // `wordBreak`, and the key to write is `break`. A few entries are prose
        // naming several keys, which is not a key to suggest.
        for (const [alias, canonical] of Object.entries(SUGGESTION_MAP)) {
            if (BARE_KEY.test(canonical)) names.set(alias, canonical);
        }
        const byLength: Array<Array<readonly [string, string]>> = [];
        let longest = 0;
        for (const [name, target] of names) {
            const bucket = byLength[name.length] ?? [];
            bucket.push([name.toLowerCase(), target]);
            byLength[name.length] = bucket;
            longest = Math.max(longest, name.length);
        }
        szKeyNameIndex = { byLength, longest };
    }
    return szKeyNameIndex;
}

/** The pattern's positions of each ASCII character, as bits; reset per key. */
const PATTERN_BITS = new Int32Array(128);

/**
 * The optimal string alignment distance from the pattern in
 * {@link PATTERN_BITS} to a text, by Hyyrö's bit-parallel recurrence: one
 * pass over the text with the pattern's column held in machine words, so a
 * comparison costs `O(text length)` instead of a table of
 * `O(pattern length * text length)` cells.
 *
 * The text is a known name, so its characters are ASCII: a code past the
 * table reads `undefined`, which the bit operations take as no match, as it
 * is for any character the pattern lacks.
 *
 * @param length - The pattern's length, 1 to 31.
 * @param text - The text.
 * @returns The distance.
 */
function patternDistance(length: number, text: string): number {
    const top = 1 << (length - 1);
    let positive = (1 << length) - 1;
    let negative = 0;
    let diagonal = 0;
    let previousMatch = 0;
    let score = length;
    for (let index = 0; index < text.length; index += 1) {
        const match = PATTERN_BITS[text.codePointAt(index) as number] as number;
        // A transposition: this character matches one position later in the
        // pattern than the previous one did, and the diagonal did not.
        const swap = ((~diagonal & match) << 1) & previousMatch;
        diagonal = (((match & positive) + positive) ^ positive) | match | negative | swap;
        const horizontalPositive = negative | ~(diagonal | positive);
        const horizontalNegative = diagonal & positive;
        if (horizontalPositive & top) score += 1;
        else if (horizontalNegative & top) score -= 1;
        const shifted = (horizontalPositive << 1) | 1;
        negative = shifted & diagonal;
        positive = (horizontalNegative << 1) | ~(shifted | diagonal);
        previousMatch = match;
    }
    return score;
}

/**
 * The canonical sz key an unknown key most likely misspells.
 *
 * One edit, or two on a key of twelve letters or more, and never more than one
 * edit per three letters, so a two-letter key is not turned into another. Tuned
 * on custom utility names: `scrollbarHide` and `noScrollbar` stay unanswered.
 *
 * Answers as {@link nearestName} over every known name does, reading only the
 * names whose length is within the budget.
 *
 * @param key - The unknown key.
 * @returns The canonical key, or null when no single key is near enough.
 * @example
 * suggestSzKey('workBreak'); // 'break'
 */
export function suggestSzKey(key: string): string | null {
    const { byLength, longest } = knownSzKeyNames();
    // No name is within two characters of its length, and the budget is at
    // most two: nothing to search, and nothing worth remembering — a long
    // generated key would only push real typos out of the memo.
    if (key.length > longest + 2) return null;
    const known = suggestions.get(key);
    if (known !== undefined) return known;
    const maxDistance = Math.min(key.length >= 12 ? 2 : 1, Math.floor(key.length / 3));
    const suggestion = nearestByLength(key, byLength, maxDistance);
    // A build reports one typo in every file that repeats it; the answer is
    // the same each time. Bounded, so a long dev session cannot grow it.
    if (suggestions.size >= SUGGESTION_MEMO_LIMIT) suggestions.clear();
    suggestions.set(key, suggestion);
    return suggestion;
}

/**
 * {@link nearestName} over names grouped by length.
 *
 * @param key - The name as authored.
 * @param byLength - Lower-cased names with their targets, by length.
 * @param maxDistance - The largest distance still worth suggesting.
 * @returns The target, or null when nothing is near enough or two targets tie.
 */
function nearestByLength(
    key: string,
    byLength: SzKeyNameIndex['byLength'],
    maxDistance: number,
): string | null {
    const pattern = key.toLowerCase();
    PATTERN_BITS.fill(0);
    for (let index = 0; index < pattern.length; index += 1) {
        PATTERN_BITS[pattern.codePointAt(index) as number] |= 1 << index;
    }
    let best = Number.POSITIVE_INFINITY;
    const targets = new Set<string>();
    // The distance is never below the length difference, so only names this
    // close in length to the key, and to the key lower-cased (`İ` becomes two
    // units), can come within budget. A pattern past the 31 units one word
    // holds therefore only meets names of 30 or more characters, and there
    // are none (a test holds the longest name under 30).
    const from = Math.max(key.length, pattern.length) - maxDistance;
    const to = Math.min(key.length, pattern.length) + maxDistance;
    for (let length = from; length <= to; length += 1) {
        for (const [name, target] of byLength[length] ?? []) {
            const distance = patternDistance(pattern.length, name);
            if (distance > maxDistance || distance > best) continue;
            if (distance < best) {
                best = distance;
                targets.clear();
            }
            targets.add(target);
        }
    }
    if (targets.size !== 1) return null;
    const [target] = targets;
    return target;
}

/** How many answers {@link suggestSzKey} keeps before it starts again. */
const SUGGESTION_MEMO_LIMIT = 4096;

/** The answers {@link suggestSzKey} has given, by key. */
const suggestions = new Map<string, string | null>();
