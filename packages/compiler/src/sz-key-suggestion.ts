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

import { szDiagnosticKindOf } from './sz-diagnostic-kind.js';
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
        const distance = editDistance(lower, name.toLowerCase());
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
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns The number of edits between them.
 */
function editDistance(a: string, b: string): number {
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
        twoBack = previous;
        previous = current;
    }
    return previous[b.length];
}

/** An identifier-shaped canonical key, as opposed to a prose suggestion. */
const BARE_KEY = /^[a-z][a-z0-9]*$/i;

/** Every known key and alias, each with the canonical key to suggest. Built on first use. */
let szKeyNames: ReadonlyArray<readonly [string, string]> | undefined;

/**
 * Known keys and aliases, each paired with the key to suggest for it.
 *
 * @returns The pairs.
 */
function knownSzKeyNames(): ReadonlyArray<readonly [string, string]> {
    if (szKeyNames === undefined) {
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
        szKeyNames = [...names];
    }
    return szKeyNames;
}

/**
 * The canonical sz key an unknown key most likely misspells.
 *
 * One edit, or two on a key of twelve letters or more, and never more than one
 * edit per three letters, so a two-letter key is not turned into another. Tuned
 * on custom utility names: `scrollbarHide` and `noScrollbar` stay unanswered.
 *
 * @param key - The unknown key.
 * @returns The canonical key, or null when no single key is near enough.
 * @example
 * suggestSzKey('workBreak'); // 'break'
 */
export function suggestSzKey(key: string): string | null {
    const maxDistance = Math.min(key.length >= 12 ? 2 : 1, Math.floor(key.length / 3));
    return nearestName(key, knownSzKeyNames(), maxDistance);
}

/**
 * The key to suggest for an unknown-key diagnostic.
 *
 * @param message - One rendered diagnostic, with or without its tag.
 * @returns The canonical key, or null for another kind or when nothing is near.
 */
export function szKeySuggestionFor(message: string): string | null {
    if (szDiagnosticKindOf(message) !== 'unknown-key') return null;
    // The kind guarantees the message names the key in the first quotes.
    const start = message.indexOf('"') + 1;
    return suggestSzKey(message.slice(start, message.indexOf('"', start)));
}
