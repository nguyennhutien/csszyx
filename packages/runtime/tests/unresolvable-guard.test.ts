/**
 * Locks the runtime guard that fires when the compiler could not statically
 * resolve an sz prop and fell back to `_sz(objectExpr)`. The guard is dev-only
 * (gated on NODE_ENV); detecting the unresolvable case at build time instead is
 * a tracked follow-up, so this pins the present behavior.
 */
import { describe, expect, it } from 'vitest';

import { _sz } from '../src/lite.js';

describe('_sz unresolvable-object guard', () => {
    it('passes strings through unchanged', () => {
        expect(_sz('p-4')).toBe('p-4');
        expect(_sz('p-4', false, 'bg-red-500')).toBe('p-4 bg-red-500');
    });

    it('throws a helpful error when a plain object reaches the helper (non-production)', () => {
        // vitest runs with NODE_ENV !== 'production', so the dev guard is active.
        expect(() => _sz({ p: 4 } as never)).toThrow(
            /could not resolve this sz prop at build time/,
        );
    });
});
