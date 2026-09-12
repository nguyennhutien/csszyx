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

describe('classifyAmbiguousValue — border/divide/ring/outline side and offset segments', () => {
    it('reads a directional/axis first segment as a utility of its own', () => {
        // This used to answer null — a give-up that sent the token to the
        // prefix bucket, where `border-t-4` and `border-t-transparent` shared
        // one key and the colour deleted the width.
        expect(classifyAmbiguousValue('divide', 'x-2')).toBe('divide-x:width');
        expect(classifyAmbiguousValue('border', 't-4')).toBe('border-t:width');
        expect(classifyAmbiguousValue('border', 't-transparent')).toBe('border-t:color');
        expect(classifyAmbiguousValue('ring', 'y-2')).toBe('ring-y:width');
    });

    it('reads an offset segment as a utility of its own', () => {
        // `ring-offset-*` sets the offset's width and colour, not the ring's.
        expect(classifyAmbiguousValue('ring', 'offset-2')).toBe('ring-offset:width');
        expect(classifyAmbiguousValue('ring', 'offset-gray-800')).toBe('ring-offset:color');
        expect(classifyAmbiguousValue('outline', 'offset-4')).toBe('outline-offset:width');
    });

    it('still gives up when the rest of the value names no group', () => {
        expect(classifyAmbiguousValue('divide', 'x-reverse')).toBeNull();
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
