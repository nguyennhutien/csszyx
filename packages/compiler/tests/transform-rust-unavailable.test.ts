/**
 * transform-rust's error mapping for hosts WITHOUT the native addon — the
 * exact path a user on an unsupported platform hits. This container has the
 * binding installed, so the native module is mocked to produce each failure.
 */
import { describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => ({
    mode: 'unavailable' as 'unavailable' | 'other' | 'no-result' | 'ok',
}));

vi.mock('@csszyx/core/native', () => {
    class CsszyxNativeUnavailableError extends Error {
        packageName?: string;
        constructor(message?: string, packageName?: string) {
            super(message ?? 'native binding unavailable');
            this.name = 'CsszyxNativeUnavailableError';
            this.packageName = packageName;
        }
    }
    return {
        CsszyxNativeUnavailableError,
        transformBatch: () => {
            if (control.mode === 'unavailable') {
                throw new CsszyxNativeUnavailableError('no binding', '@csszyx/core-test-platform');
            }
            if (control.mode === 'other') {
                throw new Error('native parse failure');
            }
            if (control.mode === 'no-result') {
                return [];
            }
            return [];
        },
    };
});

import {
    ensureRustTransformAvailable,
    isRustTransformAvailable,
    OxcRustNotImplementedError,
    transformRust,
    transformRustBatch,
} from '../src/transform-rust.js';

describe('transform-rust without a native binding', () => {
    it('maps the unavailable error onto OxcRustNotImplementedError with the package name', () => {
        control.mode = 'unavailable';
        expect(() => transformRust('const x = 1;', 'a.tsx')).toThrow(OxcRustNotImplementedError);
        expect(() => transformRustBatch([{ source: 'const x = 1;' }])).toThrow(
            /@csszyx\/core-test-platform/,
        );
    });

    it('ensureRustTransformAvailable throws the mapped error too', () => {
        control.mode = 'unavailable';
        expect(() => ensureRustTransformAvailable()).toThrow(OxcRustNotImplementedError);
    });

    it('rethrows genuine native failures unchanged', () => {
        control.mode = 'other';
        expect(() => transformRustBatch([{ source: 'const x = 1;' }])).toThrow(
            'native parse failure',
        );
    });

    it('throws when the native transform returns no result', () => {
        control.mode = 'no-result';
        expect(() => transformRust('const x = 1;', 'a.tsx')).toThrow(/returned no result/);
    });

    it('isRustTransformAvailable reports false and caches the probe', () => {
        control.mode = 'unavailable';
        expect(isRustTransformAvailable()).toBe(false);
        // Cached: even if the binding would now work, the probe result sticks.
        control.mode = 'ok';
        expect(isRustTransformAvailable()).toBe(false);
    });
});
