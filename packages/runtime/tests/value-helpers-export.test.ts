/**
 * The value helpers compiled code imports by name: `__szSpacingVar`,
 * `__szUnitVar` and `__szFactorVar` (the last for a runtime value on a percent
 * key or `leading`). Each entry a build can inject from must export all three,
 * or the generated call is a ReferenceError.
 */
import { describe, expect, it } from 'vitest';

import * as full from '../src/index.js';
import * as lite from '../src/lite.js';

describe.each([
    ['@csszyx/runtime', full],
    ['@csszyx/runtime/lite', lite],
])('%s', (_name, entry) => {
    it('exports every value helper compiled code calls', () => {
        expect(entry.__szSpacingVar(4, 'p')).toBe('calc(4 * var(--spacing))');
        expect(entry.__szUnitVar(45, 'deg', 'rotate')).toBe('45deg');
        expect(entry.__szFactorVar(50, 'opacity')).toBe('50%');
    });
});
