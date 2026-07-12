/**
 * lite.ts's assertNotObject dev guard is gated on
 * `process.env.NODE_ENV !== 'production'` in three call sites (_sz's
 * single-arg fast path, _sz's multi-arg loop, and _szMerge's loop).
 * unresolvable-guard.test.ts pins the dev (guard-active) behavior; this pins
 * the production (guard-skipped) side, which every other suite runs under
 * NODE_ENV=test and therefore never exercises.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { _sz, _szMerge } from '../src/lite.js';

describe('lite helpers in production (dev guard skipped)', () => {
    const prevEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = prevEnv;
    });

    it('_sz single-argument passthrough works without the guard', () => {
        process.env.NODE_ENV = 'production';
        expect(_sz('p-4')).toBe('p-4');
        expect(_sz(false)).toBe('');
    });

    it('_sz multi-argument concatenation works without the guard', () => {
        process.env.NODE_ENV = 'production';
        expect(_sz('a', false, 'b')).toBe('a b');
    });

    it('_szMerge works without the guard', () => {
        process.env.NODE_ENV = 'production';
        expect(_szMerge('p-4 m-2', '', 'p-4 gap-1')).toBe('p-4 m-2 gap-1');
    });
});
