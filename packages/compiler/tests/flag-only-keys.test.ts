/**
 * A key that takes only `true` or `false` emits nothing for any other value.
 *
 * `truncate`, `srOnly`, `numOrdinal` and the other {@link FLAG_ONLY_KEYS} are
 * typed `boolean` in `SzProps`. A number or a string on one used to lower to a
 * class such as `truncate-2` or `sr-only-yes`, which no Tailwind serves, with
 * no report. Every lane now drops the value and reports `closed-enum-value`,
 * form `flag`, the way a runtime value on the same key is dropped by
 * `__szBoolClass`. Whether a value is a boolean is the key's type, not a
 * question for Tailwind, so the answer is the same on every version.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOOLEAN_SHORTHANDS, FLAG_ONLY_KEYS } from '../src/sz-key-tables.js';
import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';
import { ENGINES } from './engine-parity-harness.js';
import { szCodeOf } from './helpers/sz-console-line.js';

/** sz object, the class every lane writes for it, and whether it is reported. */
const CASES: ReadonlyArray<readonly [Record<string, unknown>, string, boolean]> = [
    [{ truncate: 2 }, '', true],
    [{ truncate: 'yes' }, '', true],
    [{ numOrdinal: 0 }, '', true],
    [{ hover: { srOnly: 1 } }, '', true],
    [{ containPaint: 'paint' }, '', true],
    [{ spaceXReverse: 1, p: 4 }, 'p-4', true],
    // `true` is the class and `false` is none, as before.
    [{ truncate: true }, 'truncate', false],
    [{ hover: { srOnly: true } }, 'hover:sr-only', false],
    [{ truncate: false, p: 4 }, 'p-4', false],
    // A shorthand that also takes a value keeps it.
    [{ ring: 2 }, 'ring-2', false],
    [{ grow: 2 }, 'grow-2', false],
];

/** Plugin components: their names are the plugin's to define. */
const PLUGIN_KEYS = new Set(['container', 'prose', 'proseInvert']);

describe.each(CASES)('%j', (sz, expected, reported) => {
    beforeEach(() => {
        __resetSzWarnDedupForTests();
    });

    it('lowers in the runtime core, and reports a non-boolean value', () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((line: string) => {
            lines.push(line);
        });
        try {
            expect(transform(sz as SzObject).className).toBe(expected);
        } finally {
            spy.mockRestore();
        }
        const flagged = lines.filter(
            line => szCodeOf(line) === 'closed-enum-value' && line.includes('takes only `true`'),
        );
        expect(flagged).toHaveLength(reported ? 1 : 0);
    });

    it.each(ENGINES)('lowers through the %s engine, and reports it', (_name, engine) => {
        const source = `export const A = () => <div sz={${JSON.stringify(sz)}} />;`;
        const { code = '', issues = [] } = engine(source, { filename: '/p/src/Flag.tsx' });
        expect(code).toContain(expected === '' ? 'export const A' : `className="${expected}"`);
        if (expected === '') expect(code).not.toMatch(/className="[^"]+"/);
        const flagged = issues.filter(
            issue => issue.code === 'closed-enum-value' && issue.args?.form === 'flag',
        );
        expect(flagged).toHaveLength(reported ? 1 : 0);
    });
});

describe('the flag-only keys', () => {
    const types = readFileSync(new URL('../src/types/sz-props.ts', import.meta.url), 'utf8');
    const lines = types.split('\n').map(line => line.trim());
    const typeOf = (key: string): string | undefined => {
        const line = lines.find(text => text.startsWith(`${key}?:`) && text.endsWith(';'));
        return line?.slice(key.length + 2, -1).trim();
    };

    it('are typed `boolean` alone', () => {
        for (const key of FLAG_ONLY_KEYS) expect(typeOf(key), key).toBe('boolean');
    });

    it('are every boolean shorthand typed `boolean` alone, plugin components aside', () => {
        const typedBoolean = [...BOOLEAN_SHORTHANDS].filter(
            key => typeOf(key) === 'boolean' && !PLUGIN_KEYS.has(key),
        );
        expect(new Set(typedBoolean)).toEqual(FLAG_ONLY_KEYS);
    });
});
