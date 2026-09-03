/**
 * The TypeScript lowering — `transform()` from the compiler and the runtime
 * `_sz` path that reuses it — has to refuse a per-side border style the same
 * way the native engine does.
 *
 * `border-side-style-value.test.ts` pins the refusal on the wasm and native
 * engines. The TypeScript lane was left out, so `_sz({ borderB: 'none' })` on
 * a page kept emitting `border-b-none`, a class Tailwind serves no rule for,
 * with no warning — while the same object in a compiled `sz` prop was dropped
 * and reported. Same input, two answers, and only the runtime one was wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transform } from '../src/index.js';
import { __resetSzWarnDedupForTests, setSzWarnLocation } from '../src/transform-core.js';

/** Every per-side border key, including the logical ones. */
const SIDE_KEYS = [
    'borderT',
    'borderR',
    'borderB',
    'borderL',
    'borderX',
    'borderY',
    'borderS',
    'borderE',
    'borderBs',
    'borderBe',
] as const;

/** The style keywords Tailwind spells at the root and nowhere else. */
const STYLE_VALUES = ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'] as const;

describe('a style keyword on a side border key (TypeScript lowering)', () => {
    // The refusal reports once per pair for a process; each test owns its own
    // first report.
    beforeEach(() => __resetSzWarnDedupForTests());
    afterEach(() => vi.restoreAllMocks());

    const pairs = SIDE_KEYS.flatMap(key => STYLE_VALUES.map(value => [key, value] as const));

    it.each(pairs)('drops the dead class for %s: %s', (key, value) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(transform({ [key]: value }).className).toBe('');
    });

    it('says which key, and what to write instead, once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        transform({ borderB: 'none' });
        transform({ borderB: 'none' });

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]?.[0]);
        expect(message).toContain('"borderB"');
        expect(message).toContain('no per-side border style');
        expect(message).toContain('borderStyle');
    });

    it('keeps the width, the colour and the canonical style key', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(transform({ borderB: 2 }).className).toBe('border-b-2');
        expect(transform({ borderB: 'red-500' }).className).toBe('border-b-red-500');
        expect(transform({ borderStyle: 'none' }).className).toBe('border-none');
        expect(warn).not.toHaveBeenCalled();
    });

    it('refuses inside a variant as well', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(transform({ hover: { borderB: 'dashed' } }).className).toBe('');
    });

    it('names the place the value was written when the build supplies one', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setSzWarnLocation('App.tsx:12');
        try {
            transform({ borderL: 'double' });
            expect(String(warn.mock.calls[0]?.[0])).toContain('at App.tsx:12');
        } finally {
            setSzWarnLocation(undefined);
        }
    });

    it('still drops the class, silently, when dev warnings are off', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        try {
            expect(transform({ borderT: 'hidden' }).className).toBe('');
            expect(warn).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
