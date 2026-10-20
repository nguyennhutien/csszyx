/**
 * `__resetSzWarnDedupForTests` forgets every line the runtime lowering has
 * reported, so a suite that drives one literal twice sees it reported twice.
 *
 * Each literal below lands in a different dedup set. A set the reset misses
 * makes the second run silent: a case that expects a warning fails loudly, but
 * one that expects none passes for the wrong reason, which is how the
 * runtime/engine differential could go hollow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetSzWarnDedupForTests, type SzObject, transform } from '../src/transform-core.js';

/** One literal per dedup set, by what it reports. */
const ONE_PER_SET: ReadonlyArray<readonly [string, SzObject]> = [
    ['an alignment CSS value', { justify: 'space-between' }],
    ['a mask layer value', { mask: 'radial-at-top' }],
    ['a mask slot member', { maskConic: { form: 'black' } }],
    ['an off-scale spacing step', { m: 1.3 }],
    ['a per-side border style', { borderT: 'dashed' }],
    ['a colour object with a slash opacity', { bg: { color: 'green-500/20' } }],
    ['a property holding an object', { mt: { foo: 1 } }],
    ['a closed-enum value', { position: 'stickyy' }],
    ['a slash-opacity string', { bg: 'green-500/30' }],
    ['a csszyx-owned key holding an object', { '--gap': { p: 1 } }],
    ['removed boolean sugar', { inlineGrid: true }],
    ['an unknown key', { colour: 'red' }],
    ['a numeric font weight string', { weight: '600' }],
    ['a moved value', { touch: 'pan-left' }],
    ['a stand-alone key before its group', { contain: 'strict', containLayout: true }],
];

/**
 * How many lines one transform of a literal prints.
 *
 * @param sz - The literal.
 * @returns The count.
 */
function linesFor(sz: SzObject): number {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        transform(sz);
        return warn.mock.calls.length;
    } finally {
        warn.mockRestore();
    }
}

describe('__resetSzWarnDedupForTests', () => {
    beforeEach(() => {
        // The project-scan tip prints once per process by design, not per key.
        vi.stubEnv('CSSZYX_NO_PROJECT_SCAN_HINT', '1');
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        __resetSzWarnDedupForTests();
    });

    for (const [what, sz] of ONE_PER_SET) {
        it(`forgets ${what}`, () => {
            __resetSzWarnDedupForTests();
            const first = linesFor(sz);
            expect(first, 'it reports at all').toBeGreaterThan(0);
            expect(linesFor(sz), 'deduplicated without a reset').toBe(0);
            __resetSzWarnDedupForTests();
            expect(linesFor(sz), 'reported again after the reset').toBe(first);
        });
    }
});
