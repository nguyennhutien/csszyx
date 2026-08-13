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

import { type SzObject, transform } from '../../compiler/src/transform-core.js';
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

/**
 * Merge every recognized utility into one last-write-wins sz object.
 *
 * @param classes Element utility classes.
 * @returns Merged sz object and utilities outside migration coverage.
 */
function mergeRecognizedClasses(classes: string[]): {
    mergedSz: Record<string, unknown>;
    unrecognized: Set<string>;
} {
    const mergedSz: Record<string, unknown> = {};
    const unrecognized = new Set<string>();
    for (const className of classes) {
        const parsed = classNameToSzObject(className);
        if (parsed.unrecognized[0] === className) {
            unrecognized.add(className);
        } else {
            Object.assign(mergedSz, parsed.szObject);
        }
    }
    return { mergedSz, unrecognized };
}

/**
 * Check whether one compiler output class traces to the merged input.
 *
 * @param className Compiler output class.
 * @param inputClasses Original element utility set.
 * @param mergedSz Merged migration output.
 * @returns True for exact, shorthand, or self-consistent canonical output.
 */
function isTraceableOutputClass(
    className: string,
    inputClasses: ReadonlySet<string>,
    mergedSz: Record<string, unknown>,
): boolean {
    if (inputClasses.has(className)) return true;
    const { szObject, unrecognized } = classNameToSzObject(className);
    if (unrecognized[0] === className) return true;
    const properties = Object.keys(szObject);
    if (properties.length > 0 && properties.every(property => property in mergedSz)) return true;
    return unrecognized.length === 0 && transform(szObject as SzObject).className === className;
}

/**
 * Assert that compiling one corpus element cannot invent a utility.
 *
 * @param classString Whitespace-separated element classes.
 */
function assertComboRoundTrip(classString: string): void {
    const classes = classString.split(/\s+/).filter(Boolean);
    const { mergedSz, unrecognized } = mergeRecognizedClasses(classes);
    if (unrecognized.size === classes.length) return;

    const result = transform(mergedSz as SzObject);
    if (!result.className) return;
    const inputClasses = new Set(classes);
    for (const className of result.className.split(' ').filter(Boolean)) {
        if (isTraceableOutputClass(className, inputClasses, mergedSz)) continue;
        expect(className).toBe(
            `[phantom class in output — not from input "${classString.slice(0, 60)}..."]`,
        );
    }
}

const comboFiles = existsSync(COMBO_DIR)
    ? readdirSync(COMBO_DIR)
          .filter(f => f.endsWith('.txt'))
          .sort()
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
                    assertComboRoundTrip(classString);
                });
            }
        });
    }
});
