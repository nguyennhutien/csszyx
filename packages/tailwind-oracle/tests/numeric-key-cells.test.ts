/**
 * The four numeric-key tables hold on the pinned Tailwind (ADR 0037).
 *
 * `check-tailwind-versions.mjs` asks the same of every version in the matrix
 * (`cells`); this is the fast check on the pin, run with the unit tests.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { numericKeyCellFindings } from '../../../scripts/numeric-key-cells.mjs';
import {
    CLAMPED_FACTOR_KEYS,
    DECIMAL_BRACKET_KEYS,
    FACTOR_STRING_KEYS,
    NUMBER_BRACKET_KEYS,
    PROPERTY_MAP,
} from '../../compiler/src/sz-key-tables.js';
import { createEmittedClassOracle } from '../src/index.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const TABLES = {
    decimalBracket: DECIMAL_BRACKET_KEYS,
    numberBracket: NUMBER_BRACKET_KEYS,
    factorString: FACTOR_STRING_KEYS,
    clampedFactor: CLAMPED_FACTOR_KEYS,
};

describe('the numeric-key tables', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);
    const cssFor = (classes: string[]) => oracle.cssFor(classes);

    it('put every listed key where the pinned Tailwind does', () => {
        expect(numericKeyCellFindings(TABLES, PROPERTY_MAP, cssFor)).toEqual([]);
    });

    it('name a key in the wrong cell', () => {
        // Metamorphic: move one key of each table to another, and the check
        // must say so for that key.
        const moved = {
            decimalBracket: new Set(['opacity']),
            numberBracket: new Set(['grow']),
            factorString: new Set(['z']),
            clampedFactor: new Set(['p']),
        };
        expect(numericKeyCellFindings(moved, PROPERTY_MAP, cssFor)).toEqual([
            'grow: the bare number is not dead',
            'opacity: a decimal does not need the bracket',
            'opacity: bare and bracket integers differ',
            'p: clamped but not a factor key',
            'z: bare and bracket do not mean two things',
        ]);
    });
});
