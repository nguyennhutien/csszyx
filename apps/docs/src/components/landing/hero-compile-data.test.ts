/**
 * Every pair the landing hero shows compiles to the class it shows, on the
 * runtime `transform` and on both engines a build lowers through.
 */
import { transform } from 'csszyx';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectParity } from '../../../../../packages/compiler/tests/engine-parity-harness.js';
import { compileData } from './hero-compile-data.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the hero examples', () => {
    it.each(compileData.map(({ sz, tw }) => [sz, tw]))('%s compiles to %s', (sz, tw) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        // The examples are this file's own source text, written as an object literal.
        const object = new Function(`return (${sz});`)() as Record<string, unknown>;
        expect(transform(object as never).className).toBe(tw);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expectParity(sz, tw);
    });
});
