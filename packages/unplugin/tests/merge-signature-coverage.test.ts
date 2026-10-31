/**
 * The coverage rows of a merge table, against the definition read pair by pair.
 *
 * A signature covers another when the two agree on `!important`, a class that
 * sets only custom properties is covered only by another such class, and in
 * every context the other writes, whichever way the text runs, it writes every
 * property the other writes there. The table asks only the pairs that can
 * cover; this file asks all of them, on seeded random signatures that share
 * contexts, mix logical and physical sides, and hold no rule or a rule that
 * writes nothing.
 */
import { describe, expect, it } from 'vitest';

import {
    createMergeSignatureTable,
    horizontalProperty,
    type MergeSignature,
} from '../src/merge-signature.js';

const PROPERTIES = [
    'padding-left',
    'padding-right',
    'padding-inline-start',
    'padding-inline-end',
    'margin-top',
    'inset-inline-start',
    'left',
    'right',
    'border-start-start-radius',
    'border-top-left-radius',
    '--tw-a',
    '--tw-b',
    'color',
    'width',
    'inline-size',
    'height',
    'block-size',
];
const CONTEXTS = ['', '&:hover', '@media md', '@media md|&:hover', '&::before', 'x'];

/**
 * A seeded generator, so a failure names the table that broke.
 *
 * @param seed - Where the sequence starts.
 * @returns A function giving an integer below its bound.
 */
function generator(seed: number): (bound: number) => number {
    let state = seed;
    return bound => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        // The high bits: an LCG's low bits repeat with a short period.
        return (state >>> 16) % bound;
    };
}

/**
 * Random signatures by class name, about one in ten without a signature.
 *
 * @param next - The generator.
 * @returns Signatures keyed by class.
 */
function randomSignatures(next: (bound: number) => number): Record<string, MergeSignature | null> {
    const signatures: Record<string, MergeSignature | null> = {};
    const count = 1 + next(40);
    for (let index = 0; index < count; index++) {
        const contexts = new Set<string>();
        const rules: MergeSignature['rules'] = [];
        for (let rule = next(4); rule > 0; rule--) {
            const context = CONTEXTS[next(CONTEXTS.length)] as string;
            if (contexts.has(context)) continue;
            contexts.add(context);
            const properties = new Set<string>();
            for (let property = next(4); property > 0; property--) {
                properties.add(PROPERTIES[next(PROPERTIES.length)] as string);
            }
            rules.push({ context, properties: [...properties].sort() });
        }
        signatures[`c${index}`] = next(10) === 0 ? null : { rules, important: next(5) === 0 };
    }
    return signatures;
}

/**
 * Whether `later` covers `earlier`, read straight from the definition.
 *
 * @param later - The signature that may replace.
 * @param earlier - The signature it may replace.
 * @returns True for complete coverage in both directions.
 */
function covers(later: MergeSignature, earlier: MergeSignature): boolean {
    const customOnly = (signature: MergeSignature): boolean =>
        signature.rules.every(rule => rule.properties.every(name => name.startsWith('--')));
    if (later.important !== earlier.important) return false;
    if (customOnly(earlier) && !customOnly(later)) return false;
    return (['ltr', 'rtl'] as const).every(direction =>
        earlier.rules.every(rule => {
            const covering = later.rules.find(candidate => candidate.context === rule.context);
            if (covering === undefined) return false;
            const written = new Set(
                covering.properties.map(name => horizontalProperty(name, direction)),
            );
            return rule.properties.every(name => written.has(horizontalProperty(name, direction)));
        }),
    );
}

describe('merge table coverage', () => {
    it('lists, for every id, exactly the ids it covers, ascending', () => {
        for (let seed = 1; seed <= 2000; seed++) {
            const signatures = randomSignatures(generator(seed));
            const [byCandidate, coverage] = createMergeSignatureTable(
                Object.keys(signatures),
                candidate => signatures[candidate] ?? null,
                { prune: false },
            );
            // One signature per id, as the table numbered them.
            const byId: MergeSignature[] = [];
            for (const [candidate, id] of Object.entries(byCandidate)) {
                byId[id] = signatures[candidate] as MergeSignature;
            }
            const expected = byId.map(later =>
                byId.flatMap((earlier, id) => (covers(later, earlier) ? [id] : [])),
            );
            expect(coverage, `seed ${seed}`).toEqual(expected);
        }
    });
});
