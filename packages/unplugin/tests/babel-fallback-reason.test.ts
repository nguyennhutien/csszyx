import { OxcNotImplementedError } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import { babelFallbackReason } from '../src/babel-fallback-reason.js';

describe('babelFallbackReason', () => {
    it('strips the internal Phase-D slice label from not-implemented errors', () => {
        const error = new OxcNotImplementedError(
            'D2.1',
            'identifier reference in sz object at F.tsx:42',
        );
        const reason = babelFallbackReason(error);
        expect(reason).toBe('identifier reference in sz object at F.tsx:42');
        expect(reason).not.toMatch(/D2\.\d|not implemented/);
    });

    it('passes through ordinary error messages', () => {
        expect(babelFallbackReason(new Error('oxc-parser errors: unexpected token'))).toBe(
            'oxc-parser errors: unexpected token',
        );
    });

    it('stringifies non-error throwables', () => {
        expect(babelFallbackReason('boom')).toBe('boom');
    });
});
