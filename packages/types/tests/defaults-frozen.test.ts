/**
 * The default configs cannot be changed by the code that imports them.
 *
 * The plugin reads `DEFAULT_BUILD_CONFIG.parser`, `.cache` and `.cacheDir`
 * when a config leaves them out, and a merge that spreads
 * `DEFAULT_CSSZYX_CONFIG` copies only its top level, so a write to the
 * copy's `build` wrote the shared default for every other instance.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_BUILD_CONFIG,
    DEFAULT_CSSZYX_CONFIG,
    DEFAULT_DEVELOPMENT_CONFIG,
    DEFAULT_HYDRATION_CONFIG,
    DEFAULT_PRODUCTION_CONFIG,
} from '../src/config.js';

describe.each([
    ['DEFAULT_BUILD_CONFIG', DEFAULT_BUILD_CONFIG],
    ['DEFAULT_CSSZYX_CONFIG', DEFAULT_CSSZYX_CONFIG],
    ['DEFAULT_DEVELOPMENT_CONFIG', DEFAULT_DEVELOPMENT_CONFIG],
    ['DEFAULT_HYDRATION_CONFIG', DEFAULT_HYDRATION_CONFIG],
    ['DEFAULT_PRODUCTION_CONFIG', DEFAULT_PRODUCTION_CONFIG],
])('%s', (_name, config) => {
    it('is frozen', () => {
        expect(Object.isFrozen(config)).toBe(true);
    });
});

it('refuses a write through a shallow copy of the whole default', () => {
    const merged = { ...DEFAULT_CSSZYX_CONFIG };
    expect(() => {
        (merged.build as { parser?: string }).parser = 'wasm';
    }).toThrow(TypeError);
    expect(DEFAULT_BUILD_CONFIG.parser).toBe('rust');
});
