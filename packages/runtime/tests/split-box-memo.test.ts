/**
 * The whole-partition memo admission-stopped at its cap: the first 512
 * classNames were cached for the life of the page and no later one ever was.
 * Measured, the same className repeated after the cap cost 625 ns per call —
 * forever — against 83 ns for one admitted before it. A component first
 * rendered late, a modal say, paid the uncached split on every render.
 */
import { expect, it } from 'vitest';
import { _splitMemoSize, splitBox } from '../src/split-box.js';

it('caches a className first seen after the cap', () => {
    for (let i = 0; i < 512; i++) splitBox(`fill-${i} p-4 m-2`);
    expect(_splitMemoSize()).toBe(512);
    // The memo is full. A newcomer must still be able to get in, and once in,
    // the next call for it must be a hit — which the size can show: a clear
    // followed by one insert is 1, a refused insert leaves it at the cap.
    splitBox('late-arrival p-4 m-2');
    splitBox('late-arrival p-4 m-2');
    expect(_splitMemoSize()).toBe(1);
});
