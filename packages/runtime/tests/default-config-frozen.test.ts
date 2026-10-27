/** The runtime's default config cannot be changed by the code that imports it. */
import { expect, it } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG } from '../src/index.js';

it('freezes the default every init and reset copies', () => {
    expect(Object.isFrozen(DEFAULT_RUNTIME_CONFIG)).toBe(true);
    expect(() => {
        (DEFAULT_RUNTIME_CONFIG as { strictHydration: boolean }).strictHydration = false;
    }).toThrow(TypeError);
});
