/**
 * A closed-enum key and the class it compiles to must land on the same node.
 *
 * `splitBoxSz` routes an sz object by key (`classifySzKey`), `splitBox` routes
 * the compiled class string by token (`classify`). The per-group keys of
 * font-variant-numeric, touch-action and contain had key rows but not token
 * rows, so `contain-strict` was "not a utility csszyx knows" and `normal-nums`
 * fell to the fallback node while `{ nums: 'normal' }` went inner: the same
 * style split two ways depending on which form reached the runtime.
 *
 * The key/value pairs are read from the compiler's own `CLOSED_ENUM_CLASSES`
 * and `GLOBAL_KEYWORD_GROUPS`, so a value added there is covered here without
 * an edit.
 */
import path from 'node:path';

import { transform } from '@csszyx/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- plain-JS repo script, no declarations
import { readTableSource } from '../../../scripts/extract-ts-tables.mjs';
import { classify, classifySzKey, splitBox } from '../src/split-box.js';

type TableSource = {
    objectOfStringObjects(name: string): Array<[string, Array<[string, string]>]>;
};

/**
 * A nested table as plain objects, read from compiler source.
 * @param file - The compiler source file that declares it.
 * @param name - The declared name.
 * @returns The table.
 */
function table(file: string, name: string): Record<string, Record<string, string>> {
    const source = readTableSource(
        path.resolve(import.meta.dirname, '../../compiler/src', file),
    ) as TableSource;
    return Object.fromEntries(
        source.objectOfStringObjects(name).map(([key, rows]) => [key, Object.fromEntries(rows)]),
    );
}

const closedEnumClasses = table('transform-core.ts', 'CLOSED_ENUM_CLASSES');
const globalKeywordGroups = table('keyword-families.ts', 'GLOBAL_KEYWORD_GROUPS');

/** Every closed-enum key with each value it accepts, and each boolean group flag. */
const PAIRS: Array<[string, string | boolean]> = [
    ...Object.entries(closedEnumClasses).flatMap(([key, table]) =>
        Object.keys(table).map(value => [key, value] as [string, string]),
    ),
    ...Object.values(globalKeywordGroups)
        .flatMap(({ groups }) => groups.split(' '))
        .filter(key => !(key in closedEnumClasses))
        .map(key => [key, true] as [string, boolean]),
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('closed-enum keys and their classes', () => {
    it('reads every group key the three grammars have', () => {
        const keys = new Set(PAIRS.map(([key]) => key));
        for (const key of [
            'nums',
            'numFigure',
            'numSpacing',
            'numFraction',
            'numOrdinal',
            'numSlashedZero',
            'touch',
            'touchPanX',
            'touchPanY',
            'touchPinchZoom',
            'contain',
            'containSize',
            'containLayout',
            'containPaint',
            'containStyle',
        ]) {
            expect(keys.has(key), key).toBe(true);
        }
    });

    it.each(PAIRS)('%s: %s classifies the same as a key and as its class', (key, value) => {
        const className = transform({ [key]: value }).className.trim();
        expect(className, 'one class per pair').toMatch(/^\S+$/);
        const byKey = classifySzKey(key, value === true ? undefined : value);
        const byClass = classify(className);
        expect(byKey, `classifySzKey(${key})`).toBeDefined();
        expect(byClass, `classify(${className})`).toBeDefined();
        expect({ role: byClass?.role, category: byClass?.category }).toEqual({
            role: byKey?.role,
            category: byKey?.category,
        });
    });

    it('splits the report case without a warning, each class on its key side', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(splitBox('contain-strict normal-nums')).toEqual({
            outer: 'contain-strict',
            inner: 'normal-nums',
        });
        expect(warn).not.toHaveBeenCalled();
    });
});
