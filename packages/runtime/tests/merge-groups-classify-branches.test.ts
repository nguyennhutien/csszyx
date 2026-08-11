/**
 * Direct unit tests for the exported classifyAmbiguousValue() — merge-groups
 * test.ts exercises it only indirectly through szcn, and several of its
 * prefix sub-branches (the bg clip / origin / image groups and the
 * border/divide/ring/outline directional guard) are pre-empted by
 * merge-classes.ts's own prefix routing before they would ever reach this
 * function through szcn — `bg-clip`/`bg-origin` are registered as their own
 * single-property box-role prefixes, and directional forms like `divide-x`
 * are too, so szcn never calls classifyAmbiguousValue('bg', 'clip-...') or
 * ('divide', 'x-...') for real traffic. classifyAmbiguousValue is exported
 * specifically so its full value-classification contract (documented in its
 * JSDoc) can be tested directly regardless of which prefixes the current
 * routing table forwards to it.
 *
 * Also covers the collision-blocklist warning's category branch for a
 * non-"colors" category (registerSzcnGroups only had a "colors" collision
 * test before).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    _resetSzcnGroups,
    classifyAmbiguousValue,
    registerSzcnGroups,
} from '../src/merge-groups.js';

afterEach(() => {
    _resetSzcnGroups();
    vi.restoreAllMocks();
});

describe('classifyAmbiguousValue — unknown prefix', () => {
    it('returns null for a prefix outside the ambiguous set (switch default)', () => {
        expect(classifyAmbiguousValue('unknown-prefix', 'whatever')).toBeNull();
    });
});

describe('classifyAmbiguousValue — bg clip / origin / image groups', () => {
    it('classifies clip-* as bg:clip', () => {
        expect(classifyAmbiguousValue('bg', 'clip-padding')).toBe('bg:clip');
    });

    it('classifies origin-* as bg:origin', () => {
        expect(classifyAmbiguousValue('bg', 'origin-center')).toBe('bg:origin');
    });

    it('classifies gradient/image keywords as bg:image', () => {
        expect(classifyAmbiguousValue('bg', 'none')).toBe('bg:image');
        expect(classifyAmbiguousValue('bg', 'gradient-to-r')).toBe('bg:image');
        expect(classifyAmbiguousValue('bg', 'radial')).toBe('bg:image');
        expect(classifyAmbiguousValue('bg', 'conic')).toBe('bg:image');
        expect(classifyAmbiguousValue('bg', '[url(/x.png)]')).toBe('bg:image');
    });
});

describe('classifyAmbiguousValue — border/divide/ring/outline directional guard', () => {
    it('stays keep-both (null) for a directional/axis first segment', () => {
        expect(classifyAmbiguousValue('divide', 'x-2')).toBeNull();
        expect(classifyAmbiguousValue('border', 't-4')).toBeNull();
        expect(classifyAmbiguousValue('ring', 'y-2')).toBeNull();
    });

    it('classifies the bare (empty-value) form as :width', () => {
        expect(classifyAmbiguousValue('ring', '')).toBe('ring:width');
    });

    it('returns null for a value that matches no known group', () => {
        expect(classifyAmbiguousValue('outline', 'totally-unknown')).toBeNull();
    });
});

describe('classifyAmbiguousValue — flex fallback', () => {
    it('returns null for an unrecognized flex value', () => {
        expect(classifyAmbiguousValue('flex', 'banana')).toBeNull();
    });
});

describe('registerSzcnGroups collision blocklist — non-colors category', () => {
    it('warns "shadows a built-in value" (not "utility keyword") for fontWeights', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // 'sans' is a FONT_FAMILIES keyword, and fontWeights' blocklist includes
        // FONT_FAMILIES — registering it as a weight must be rejected.
        registerSzcnGroups({ fontWeights: ['sans'] });
        expect(warn.mock.calls.some(c => /shadows a built-in value/.test(String(c[0])))).toBe(true);
    });
});

describe('classifyAmbiguousValue — stroke and gradient-stop fallbacks', () => {
    // Both prefixes take either a colour or a measurement, and a value that is
    // neither must classify as nothing rather than being guessed into one of
    // them: a wrong group merges two classes the author meant to keep.
    it('returns null for a stroke value that is neither a colour nor a width', () => {
        expect(classifyAmbiguousValue('stroke', 'squiggly')).toBeNull();
    });

    it.each(['from', 'via', 'to'])(
        'returns null for a %s value that is neither a colour nor a position',
        prefix => {
            expect(classifyAmbiguousValue(prefix, 'halfway')).toBeNull();
        },
    );
});
