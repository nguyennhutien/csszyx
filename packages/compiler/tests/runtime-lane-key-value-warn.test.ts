/**
 * The runtime lowering channel for the two 0.16.1 diagnostics.
 *
 * The build engine returns these as diagnostics; `transform-core` is the lane a
 * runtime `sz` object takes (`@csszyx/dynamic`, the browser sub-path, an SSR
 * render of a prop-API component), and it reports through `console.warn`. Both
 * must say the same thing, so a developer who moves a value from a literal to
 * a prop does not lose the report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';

beforeEach(() => {
    // The warn sets are process-wide by design, so an earlier suite probing the
    // same key would make these assertions pass or fail by test order.
    __resetSzWarnDedupForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/**
 * Lower one sz object and collect what the runtime channel said about it.
 *
 * @param sz - The sz object to lower.
 * @returns The emitted className and every `console.warn` line.
 */
function lower(sz: SzObject): { className: string; warnings: string[] } {
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnings.push(args.join(' '));
    });
    const className = transform(sz).className ?? '';
    return { className, warnings };
}

describe('closed-enum values on the runtime lane', () => {
    it('emits nothing for a value outside the set and names the legal ones', () => {
        const { className, warnings } = lower({ display: 'bogus' } as SzObject);
        expect(className).toBe('');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('"display: bogus"');
        expect(warnings[0]).toContain('nothing is emitted for it');
        expect(warnings[0]).toContain('inline-block');
    });

    it.each([
        ['display', 'flex', 'flex'],
        ['display', 'none', 'hidden'],
        ['position', 'sticky', 'sticky'],
        ['visibility', 'hidden', 'invisible'],
        ['isolation', 'auto', 'isolation-auto'],
    ])('stays silent and emits for %s: %s', (key, value, expected) => {
        const { className, warnings } = lower({ [key]: value } as SzObject);
        expect(className).toBe(expected);
        expect(warnings).toEqual([]);
    });

    it('reports a bad value nested under a variant', () => {
        const { warnings } = lower({ hover: { position: 'bogus' } } as SzObject);
        expect(warnings[0]).toContain('"position: bogus"');
    });

    it('warns once per key/value pair, however many elements repeat it', () => {
        const { warnings } = lower({
            display: 'bogus',
            hover: { display: 'bogus' },
        } as SzObject);
        expect(warnings).toHaveLength(1);
    });
});

describe('csszyx-owned keys holding an object on the runtime lane', () => {
    it.each([
        ['--v-x', { '--v-x': { p: 4 } }, '--v-x:p-4'],
        ['container', { container: { sm: { p: 4 } } }, 'container:sm:p-4'],
    ])('names %s and still emits its prefix', (key, sz, expected) => {
        const { className, warnings } = lower(sz as SzObject);
        expect(className).toBe(expected);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`"${key}"`);
        expect(warnings[0]).toContain('it holds an object');
    });

    it.each([
        ['a custom @theme breakpoint', { tablet: { p: 4 } }],
        ['a hyphenated custom breakpoint', { 'desktop-sm': { p: 4 } }],
        ['a declaration value under a custom property', { '--v-x': '0.18' }],
        ['the container utility', { container: true }],
        ['a container query', { '@sm': { p: 4 } }],
    ])('stays silent for %s', (_what, sz) => {
        expect(lower(sz as SzObject).warnings).toEqual([]);
    });
});
