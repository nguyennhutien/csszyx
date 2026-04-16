/**
 * Combo corpus round-trip tests.
 *
 * Each line in scripts/corpus-combo/*.txt is a real-world element className
 * string from a UI component. All classes from a single element are merged
 * into ONE sz object and compiled together — this catches combination bugs
 * that per-class tests miss.
 *
 * Invariant: transform(merge(allSzObjects)) must not produce phantom classes.
 * Every output class must trace back to a recognized input class or a known
 * self-consistent upgrade (e.g. start-0 → inset-s-0, data-state: → data-[state]:).
 *
 * Unrecognized input classes are skipped (known coverage gaps, not failures).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type SzObject, transform } from '../../compiler/src/transform.js';
import { classNameToSzObject } from '../src/migrate/variant-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMBO_DIR = join(__dirname, '../../../scripts/corpus-combo');

/**
 * Read and parse a corpus-combo file into an array of className strings.
 * @param filename - The corpus-combo file name (e.g. 'shadcn.txt')
 * @returns Array of multi-class strings, one per element
 */
function readComboFile(filename: string): string[] {
    const content = readFileSync(join(COMBO_DIR, filename), 'utf-8');
    return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
}

const comboFiles = existsSync(COMBO_DIR)
    ? readdirSync(COMBO_DIR).filter(f => f.endsWith('.txt')).sort()
    : [];

describe('corpus combo: real element className strings → one sz object', () => {
    if (comboFiles.length === 0) {
        it.todo('No corpus-combo files found. Run: pnpm corpus:extract');
        return;
    }

    for (const filename of comboFiles) {
        const source = filename.replace('.txt', '');
        const classStrings = readComboFile(filename);

        describe(`${source} (${classStrings.length} elements)`, () => {
            for (const classString of classStrings) {
                it(classString, () => {
                    const classes = classString.split(/\s+/).filter(Boolean);

                    // Build ONE merged sz object from all classes on this element.
                    // Last-write wins for conflicts (e.g. p-2 then px-4 → px:4 survives).
                    const mergedSz: Record<string, unknown> = {};
                    const unrecognizedSet = new Set<string>();

                    for (const cls of classes) {
                        const { szObject, unrecognized } = classNameToSzObject(cls);
                        if (unrecognized.length > 0 && unrecognized[0] === cls) {
                            unrecognizedSet.add(cls);
                        } else {
                            Object.assign(mergedSz, szObject);
                        }
                    }

                    // All classes unrecognized → known coverage gap, skip without failing
                    if (unrecognizedSet.size === classes.length) { return; }

                    // Transform the ONE merged sz object
                    const result = transform(mergedSz as SzObject);

                    // Empty output means all recognized classes used unsupported
                    // variants (e.g. group-data-[disabled]:) → skip, not a failure
                    if (result.className === '') { return; }

                    // No phantom classes: every output class must come from the input,
                    // be a known self-consistent upgrade, or be a compiler shorthand
                    // that combines multiple input-derived props (e.g. text-sm/none
                    // from {text:'sm', leading:'none'}).
                    const outputClasses = result.className.split(' ').filter(Boolean);
                    const inputSet = new Set(classes);

                    for (const outCls of outputClasses) {
                        if (inputSet.has(outCls)) { continue; } // exact match — OK

                        const { szObject: outSz, unrecognized: outUnrec } = classNameToSzObject(outCls);

                        // Compiler-canonical form with no reverse parse path — known upgrade
                        if (outUnrec.length > 0 && outUnrec[0] === outCls) { continue; }

                        // Shorthand of input-derived props: all sz props in the output
                        // class must have been contributed by the merged input sz object
                        // (e.g. text-sm/none ← text:sm + leading:none both in mergedSz)
                        const outProps = Object.keys(outSz);
                        if (outProps.length > 0 && outProps.every(prop => prop in mergedSz)) {
                            continue;
                        }

                        // Self-consistent upgrade: recompile and check identity
                        if (outUnrec.length === 0) {
                            const recompiled = transform(outSz as SzObject).className;
                            if (recompiled === outCls) { continue; }
                        }

                        // Not in input, not a shorthand, not a known upgrade — phantom class
                        expect(outCls).toBe(
                            `[phantom class in output — not from input "${classString.slice(0, 60)}..."]`,
                        );
                    }
                });
            }
        });
    }
});
