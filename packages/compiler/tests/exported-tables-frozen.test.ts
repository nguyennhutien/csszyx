/**
 * The tables an entry exports cannot be changed by the code that imports them.
 *
 * A table the lowering reads was a plain object or `Set`, so an importer could
 * add a key and change every class the process wrote after it. Freezing one
 * later would make that write throw, a break for whoever relied on it; they
 * are frozen now, and typed readonly.
 */
import { describe, expect, it } from 'vitest';
import { CLOSED_ENUM_CLASSES, CLOSED_ENUM_VALUE_MOVES } from '../src/closed-enum-tables.js';
import { PROPERTY_MAP, SUGGESTION_MAP } from '../src/index.js';
import { GLOBAL_KEYWORD_GROUPS } from '../src/keyword-families.js';
import { PROPERTY_CATEGORY_MAP } from '../src/property-types.js';
import { MIGRATION_NOTES, SPLIT_SHORTHAND_KEYS } from '../src/sz-key-tables.js';
import {
    BOOLEAN_TO_CLASS,
    MASK_SIDES,
    REMOVED_BOOLEAN_SUGAR,
    VARIANT_MAP,
} from '../src/transform-core.js';

const TABLES: ReadonlyArray<readonly [string, object]> = [
    ['PROPERTY_MAP', PROPERTY_MAP],
    ['SUGGESTION_MAP', SUGGESTION_MAP],
    ['MIGRATION_NOTES', MIGRATION_NOTES],
    ['VARIANT_MAP', VARIANT_MAP],
    ['BOOLEAN_TO_CLASS', BOOLEAN_TO_CLASS],
    ['REMOVED_BOOLEAN_SUGAR', REMOVED_BOOLEAN_SUGAR],
    ['CLOSED_ENUM_CLASSES', CLOSED_ENUM_CLASSES],
    ['CLOSED_ENUM_VALUE_MOVES', CLOSED_ENUM_VALUE_MOVES],
    ['PROPERTY_CATEGORY_MAP', PROPERTY_CATEGORY_MAP],
    ['GLOBAL_KEYWORD_GROUPS', GLOBAL_KEYWORD_GROUPS],
    ['SPLIT_SHORTHAND_KEYS', SPLIT_SHORTHAND_KEYS],
    ['MASK_SIDES', MASK_SIDES],
];

describe.each(TABLES)('%s', (_name, table) => {
    it('is frozen', () => {
        expect(Object.isFrozen(table)).toBe(true);
    });

    it('refuses a new key', () => {
        expect(() => {
            (table as Record<string, unknown>).zz = 'x';
        }).toThrow(TypeError);
        expect(Object.hasOwn(table, 'zz')).toBe(false);
    });
});
