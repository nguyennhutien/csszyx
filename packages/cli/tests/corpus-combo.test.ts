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
import { classNameToSzObject } from '../src/migrate.js';

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

/**
 * The classes one sz object lowers to.
 *
 * @param sz - A migrated sz object.
 * @returns Its classes.
 */
function classesOf(sz: Record<string, unknown>): string[] {
    return (transform(sz as SzObject).className ?? '').split(' ').filter(Boolean);
}

/**
 * Whether the element's output still sets what one input class set.
 *
 * Migrate may fold two classes into one: `text-sm leading-7` is written
 * `text-sm/7`, which sets both. The line-height half of such a pair is found
 * by its value after the slash, under the same variant prefix.
 *
 * @param expected - One class the input class lowers to on its own.
 * @param output - Every class the whole element lowers to, plus what stays in `className`.
 * @returns True when the output carries it.
 */
function carries(expected: string, output: ReadonlySet<string>): boolean {
    if (output.has(expected)) return true;
    const variants = expected.slice(0, expected.lastIndexOf(':') + 1);
    const utility = expected.slice(variants.length);
    for (const className of output) {
        if (className.startsWith(`${expected}/`)) return true;
        const leading = /^leading-(.+)$/.exec(utility);
        if (
            leading &&
            className.startsWith(`${variants}text-`) &&
            className.endsWith(`/${leading[1]}`)
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Elements where two classes land on one sz key and migrate keeps the later.
 *
 * Each needs a decision about the key, not a table fix, so they are listed
 * rather than skipped: the gate fails when one of them stops losing a class,
 * and the entry has to go.
 */
const KNOWN_CLASS_LOSS: ReadonlyMap<string, string> = new Map([
    [
        'border-transparent bg-current bg-dash-icon dark:border-transparent dark:bg-current',
        '`bg-dash-icon` is a project utility; read as a colour it overwrites `bg-current`',
    ],
    [
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        'bare `border-t` and `border-t-transparent` both write the side key',
    ],
    [
        'text-md font-semibold text-gray-900 dark:text-gray-50',
        '`text-md` is a project size; read as a colour it meets `text-gray-900`',
    ],
    [
        'text-tremor-default text-tremor-content-strong dark:text-dark-tremor-content-strong font-medium',
        'two project `text-*` tokens, a size and a colour, both read as a colour',
    ],
    [
        'text-tremor-default text-tremor-content dark:text-dark-tremor-content',
        'two project `text-*` tokens, a size and a colour, both read as a colour',
    ],
    [
        'outline outline-offset-2 outline-0 focus-visible:outline-2',
        'bare `outline` and `outline-0` both write `outline`',
    ],
]);

/**
 * Assert that migrating one corpus element loses none of its classes.
 *
 * The round-trip above proves nothing was invented; this is the other
 * direction. It converts the element the way `csszyx migrate` does — the whole
 * class string at once, so two classes that land on one key meet — and asks
 * that every class the element had is still set by the result.
 *
 * @param classString Whitespace-separated element classes.
 */
function assertNoClassLost(classString: string): void {
    const whole = classNameToSzObject(classString);
    const output = new Set([
        ...classesOf(whole.szObject),
        ...whole.unrecognized,
        ...whole.keepInClassName,
    ]);
    const lost = classString
        .split(/\s+/)
        .filter(Boolean)
        .filter(className =>
            classesOf(classNameToSzObject(className).szObject).some(
                expected => !carries(expected, output),
            ),
        );
    if (KNOWN_CLASS_LOSS.has(classString)) {
        expect(lost, 'a known loss no longer loses a class; remove it from the list').not.toEqual(
            [],
        );
        return;
    }
    expect(lost, `migrate dropped a class from "${classString}"`).toEqual([]);
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
                    assertNoClassLost(classString);
                });
            }
        });
    }
});
