/**
 * PROPERTY_MAP coverage gate.
 *
 * For every key in PROPERTY_MAP, at least one test file must contain
 * a usage of that key in an sz object literal. If a developer adds a
 * new property to PROPERTY_MAP without adding a test, this suite fails.
 *
 * Pattern matched: `{ key:` or `, key:` (handles both first and subsequent
 * keys in an object). Word-boundary semantics: `{ p:` does NOT match `{ pt:`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KNOWN_SPECIAL_PROPERTIES, PROPERTY_MAP } from '../src/transform-core.js';

const dir = fileURLToPath(new URL('.', import.meta.url));

// Read all sibling test files except this one
const testContent = readdirSync(dir)
    .filter(f => f.endsWith('.test.ts') && f !== 'property-map-coverage.test.ts')
    .map(f => readFileSync(join(dir, f), 'utf-8'))
    .join('\n');

// Keys whose presence is tested through another mechanism (special-case handlers
// in transform-core, not the standard PROPERTY_MAP prefix path).
const SPECIAL_CASE_EXEMPT = new Set([
    // bgImg uses a nested object syntax { gradient, dir } — tested in backgrounds.test.ts
    'bgImg',
    // group and peer are structural modifiers tested via KNOWN_VARIANTS
    'group',
    'peer',
    // @container is tested via advanced-variants
    '@container',
]);

/**
 * Every key the tests write at the start of an object entry: `{ key:` or
 * `, key:`, never part of a longer key (`p` is not found in `pt:`).
 */
const TESTED_KEYS = new Set(Array.from(testContent.matchAll(/[{,]\s*([\w$]+)\s*:/g), m => m[1]));

describe('PROPERTY_MAP — every key has test coverage', () => {
    const keys = Object.keys(PROPERTY_MAP).filter(k => !SPECIAL_CASE_EXEMPT.has(k));

    for (const key of keys) {
        it(`${key}`, () => {
            expect(
                TESTED_KEYS.has(key),
                `No test found for PROPERTY_MAP key "${key}". Add a test in packages/compiler/tests/.`,
            ).toBe(true);
        });
    }
});

// Special-cased keys live OUTSIDE PROPERTY_MAP (their handlers are bespoke, not
// the prefix path), which put them outside the gate above — the mask layer keys
// shipped with hand-written suites only because someone remembered. Same
// mechanism, second key source, so forgetting is no longer possible.
describe('KNOWN_SPECIAL_PROPERTIES — every key has test coverage', () => {
    for (const key of KNOWN_SPECIAL_PROPERTIES) {
        it(`${key}`, () => {
            expect(
                TESTED_KEYS.has(key),
                `No test found for special-cased key "${key}". Add a test in packages/compiler/tests/.`,
            ).toBe(true);
        });
    }
});
