/** The compiler's default options cannot be changed by the code that imports them. */
import { expect, it } from 'vitest';
import { DEFAULT_COMPILER_OPTIONS } from '../src/index.js';

it('freezes the default options every merge reads', () => {
    expect(Object.isFrozen(DEFAULT_COMPILER_OPTIONS)).toBe(true);
});
