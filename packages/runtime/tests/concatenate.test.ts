/**
 * Tests for concatenate module.
 */

import { transform } from '@csszyx/compiler/browser';
import { describe, expect, it } from 'vitest';

import { _sz, _sz2, _sz3, _szMerge, _szPart, szr } from '../src/concatenate.js';

describe('_sz', () => {
    it('should concatenate multiple classes', () => {
        expect(_sz('a', 'b', 'c')).toBe('a b c');
    });

    it('should filter out null values', () => {
        expect(_sz('a', null, 'b')).toBe('a b');
    });

    it('should filter out undefined values', () => {
        expect(_sz('a', undefined, 'b')).toBe('a b');
    });

    it('should filter out false values', () => {
        expect(_sz('a', false, 'b')).toBe('a b');
    });

    it('should handle empty input', () => {
        expect(_sz()).toBe('');
    });

    it('should handle all falsy values', () => {
        expect(_sz(null, undefined, false)).toBe('');
    });

    it('should handle mixed truthy and falsy', () => {
        expect(_sz('a', null, 'b', false, 'c', undefined)).toBe('a b c');
    });

    it('should work with conditionals', () => {
        const isActive = true;
        const hasError = false;
        expect(_sz('base', isActive && 'active', hasError && 'error')).toBe('base active');
    });

    it('should handle array arguments', () => {
        expect(_sz(['a', 'b'])).toBe('a b');
        expect(_sz(['a', false, 'c'])).toBe('a c');
    });

    it('should handle nested array arguments recursively', () => {
        expect(_sz(['a', ['b', 'c']])).toBe('a b c');
    });

    it('should handle array arguments with objects', () => {
        expect(_sz([{ w: 8, h: 8 }, false])).toBe('w-8 h-8');
        expect(_sz([{ w: 8, h: 8 }, { textAlign: 'right' }])).toBe('w-8 h-8 text-right');
    });
});
describe('_sz2', () => {
    it('should concatenate two classes', () => {
        expect(_sz2('a', 'b')).toBe('a b');
    });

    it('should handle empty first argument', () => {
        expect(_sz2('', 'b')).toBe('b');
    });

    it('should handle empty second argument', () => {
        expect(_sz2('a', '')).toBe('a');
    });

    it('should handle both empty', () => {
        expect(_sz2('', '')).toBe('');
    });
});

describe('_sz3', () => {
    it('should concatenate three classes', () => {
        expect(_sz3('a', 'b', 'c')).toBe('a b c');
    });

    it('should handle empty values', () => {
        expect(_sz3('a', '', 'c')).toBe('a c');
        expect(_sz3('', 'b', 'c')).toBe('b c');
        expect(_sz3('a', 'b', '')).toBe('a b');
    });

    it('should handle all empty', () => {
        expect(_sz3('', '', '')).toBe('');
    });
});

describe('_szMerge', () => {
    it('should merge multiple className strings', () => {
        expect(_szMerge('a b', 'c d')).toBe('a b c d');
    });

    it('should remove duplicates', () => {
        expect(_szMerge('a b', 'b c', 'c d')).toBe('a b c d');
    });

    it('should handle empty strings', () => {
        expect(_szMerge('a', '', 'b')).toBe('a b');
    });

    it('should handle single input', () => {
        expect(_szMerge('a b c')).toBe('a b c');
    });

    it('should handle no inputs', () => {
        expect(_szMerge()).toBe('');
    });

    it('should preserve the order of last occurrence', () => {
        expect(_szMerge('c b a', 'a b c')).toBe('a b c');
    });

    it('should let later utility groups override earlier values', () => {
        expect(_szMerge('gap-2 p-4 text-sm', 'gap-8 text-lg')).toBe('p-4 gap-8 text-lg');
    });

    it('should apply utility-aware merging after resolving sz objects', () => {
        expect(_szMerge({ p: 4, gap: 2 }, { p: 8 })).toBe('gap-2 p-8');
    });

    it('should handle multiple spaces', () => {
        expect(_szMerge('a  b   c', 'd  e')).toBe('a b c d e');
    });

    it('should handle array arguments', () => {
        expect(_szMerge(['a b', 'c d'], 'e f')).toBe('a b c d e f');
    });

    it('should handle array arguments with objects and remove duplicates', () => {
        expect(_szMerge([{ p: 4 }, [{ p: 4 }, { m: 4 }]])).toBe('p-4 m-4');
    });
});

describe('runtime class name mangling', () => {
    it('should mangle dynamically transformed objects using globalThis.__csszyx_ssr_mangle_map', () => {
        // Setup mangle map
        (globalThis as any).__csszyx_ssr_mangle_map = {
            'w-8': 'u4',
            'h-8': 'u3',
            'bg-linear-to-br': 'u2',
            'from-indigo-800': 'u1',
            'to-indigo-900': 'u0',
            'shrink-0': 'v6',
        };

        try {
            const res = _sz([
                {
                    w: 8,
                    h: 8,
                    bgImg: { gradient: 'linear', dir: 'to-br' },
                    from: 'indigo-800',
                    to: 'indigo-900',
                    shrink: 0,
                },
            ]);
            // 'w-8 h-8 bg-linear-to-br from-indigo-800 to-indigo-900 shrink-0' should be mangled to 'u4 u3 u2 u1 u0 v6'
            expect(res).toBe('u4 u3 u2 u1 u0 v6');
        } finally {
            // Cleanup
            delete (globalThis as any).__csszyx_ssr_mangle_map;
        }
    });

    it('should mangle dynamically transformed objects using window.__csszyx.mangleMap', () => {
        // Setup window object
        (globalThis as any).window = {
            __csszyx: {
                mangleMap: {
                    'p-4': 'x7',
                    'm-4': 'k2',
                },
            },
        };

        try {
            const res = _szMerge([{ p: 4 }, { m: 4 }]);
            expect(res).toBe('x7 k2');
        } finally {
            // Cleanup
            delete (globalThis as any).window;
        }
    });

    it('should not mangle already mangled string inputs', () => {
        (globalThis as any).__csszyx_ssr_mangle_map = {
            'w-8': 'u4',
        };

        try {
            // String inputs bypass transform, so they are returned as is
            const res = _sz('w-8');
            expect(res).toBe('w-8');
        } finally {
            delete (globalThis as any).__csszyx_ssr_mangle_map;
        }
    });
});

describe('_sz(object) matches the compiler transform (runtime ↔ build parity)', () => {
    // _sz lowers an sz OBJECT at runtime via the same browser transform the
    // compiler uses. The two must produce identical classes, or a static sz and
    // its runtime fallback (e.g. a forwarded prop) would render differently.
    const cases: Array<Record<string, unknown>> = [
        { p: 4, bg: 'blue-500' },
        { bg: { color: 'warning', op: 10 } }, // semantic color + opacity
        { color: 'warning' },
        { display: 'flex', md: { p: 8 } },
    ];

    it('agrees with transform() for each object', () => {
        for (const sz of cases) {
            const fromCompiler = transform(sz as Parameters<typeof transform>[0]).className;
            expect(_sz(sz as never), JSON.stringify(sz)).toBe(fromCompiler);
        }
    });
});

describe('szr — public alias for _sz (hand-written sz resolver)', () => {
    it('is the same resolver as the injected _sz', () => {
        expect(szr).toBe(_sz);
    });

    it('resolves sz objects to a className (the split-module use case)', () => {
        expect(szr({ p: 4 }, { m: 2 })).toBe('p-4 m-2');
    });

    it('skips falsy inputs (clsx-style) and concatenates', () => {
        expect(szr('base', false, null, undefined, { gap: 8 })).toBe('base gap-8');
    });
});

describe('_szPart — dynamic sz array element normalizer', () => {
    it('passes class strings through untouched (the forwarded-szsc-slot case)', () => {
        expect(_szPart('text-lg font-bold')).toBe('text-lg font-bold');
        expect(_szPart('')).toBe('');
    });

    it('compiles a runtime sz object', () => {
        expect(_szPart({ p: 4, bg: 'blue-500' })).toBe('p-4 bg-blue-500');
        expect(_szPart({ hover: { bg: 'blue-700' } })).toBe('hover:bg-blue-700');
    });

    it('resolves falsy guards to an empty string', () => {
        expect(_szPart(false)).toBe('');
        expect(_szPart(null)).toBe('');
        expect(_szPart(undefined)).toBe('');
        expect(_szPart(0)).toBe('');
    });

    it('joins a nested array of parts', () => {
        expect(_szPart([{ p: 4 }, 'card', false])).toBe('p-4 card');
    });
});
