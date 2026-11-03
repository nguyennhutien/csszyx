import { expect, it } from 'vitest';

import { sortStrings } from '../src/sort.js';

it('sorts identifiers by code unit without changing the input or dropping duplicates', () => {
    const input = ['z', 'a', 'a', 'Z', '10', '2'];
    expect(sortStrings(input)).toEqual(['10', '2', 'Z', 'a', 'a', 'z']);
    expect(input).toEqual(['z', 'a', 'a', 'Z', '10', '2']);
    expect(sortStrings(new Set(['b', 'a']))).toEqual(['a', 'b']);
    expect(sortStrings([])).toEqual([]);
});
