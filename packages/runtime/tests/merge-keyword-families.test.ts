/**
 * Five prefixes whose values set unrelated CSS properties.
 *
 * `snap-x` sets `scroll-snap-type` and `snap-mandatory` sets the strictness
 * variable that `scroll-snap-type` reads; `list-disc` sets `list-style-type`
 * and `list-inside` sets `list-style-position`; `object-cover` sets
 * `object-fit` and `object-center` sets `object-position`; `content-none` sets
 * `content` and `content-center` sets `align-content`; `touch-pan-x` and
 * `touch-pinch-zoom` set two different variables. Every pair here is how
 * Tailwind's own documentation writes the feature, and the merge used to keep
 * only the later one — `snap-x snap-mandatory` came out as `snap-mandatory`,
 * which turns scroll snapping off.
 *
 * The groups are not invented here: each value's CSS properties were read from
 * the project's own Tailwind through `candidatesToAst`, and the cases below
 * pin one pair per property pair, in both orders where the order could hide
 * the defect.
 */
import { describe, expect, it } from 'vitest';

import { _szcn } from '../src/merge-classes.js';
import { classifyAmbiguousValue } from '../src/merge-groups.js';

describe('each keyword lands in its group, and nothing outside them does', () => {
    // The pairs below prove the groups matter. This table proves every literal
    // the classifiers name lands in the right one, so a keyword moved to the
    // wrong `case` fails here even when no pair in the file uses it. The empty
    // value is a bare prefix (`snap`, `list`), which no family can classify.
    it.each([
        ['snap', 'x', 'snap:type'],
        ['snap', 'y', 'snap:type'],
        ['snap', 'both', 'snap:type'],
        ['snap', 'none', 'snap:type'],
        ['snap', 'mandatory', 'snap:strictness'],
        ['snap', 'proximity', 'snap:strictness'],
        ['snap', 'start', 'snap:align'],
        ['snap', 'end', 'snap:align'],
        ['snap', 'center', 'snap:align'],
        ['snap', 'align-none', 'snap:align'],
        ['snap', 'normal', 'snap:stop'],
        ['snap', 'always', 'snap:stop'],
        ['snap', '', null],
        ['snap', 'sideways', null],
        ['list', 'inside', 'list:position'],
        ['list', 'outside', 'list:position'],
        ['list', 'item', 'list:display'],
        ['list', 'image-none', 'list:image'],
        ['list', 'image-[url(a.png)]', 'list:image'],
        ['list', 'disc', 'list:style'],
        ['list', '[square]', 'list:style'],
        ['list', '', null],
        ['object', 'contain', 'object:fit'],
        ['object', 'cover', 'object:fit'],
        ['object', 'fill', 'object:fit'],
        ['object', 'none', 'object:fit'],
        ['object', 'scale-down', 'object:fit'],
        ['object', 'top-left', 'object:position'],
        ['object', '[25%_75%]', 'object:position'],
        ['object', '', null],
        ['content', 'none', 'content:content'],
        ['content', "['x']", 'content:content'],
        ['content', '(--label)', 'content:content'],
        ['content', 'center', 'content:align'],
        ['content', '', null],
        ['touch', 'auto', 'touch:action'],
        ['touch', 'none', 'touch:action'],
        ['touch', 'manipulation', 'touch:action'],
        ['touch', 'pan-x', 'touch-pan-x:action'],
        ['touch', 'pan-left', 'touch-pan-x:action'],
        ['touch', 'pan-right', 'touch-pan-x:action'],
        ['touch', 'pan-y', 'touch-pan-y:action'],
        ['touch', 'pan-up', 'touch-pan-y:action'],
        ['touch', 'pan-down', 'touch-pan-y:action'],
        ['touch', 'pinch-zoom', 'touch-pinch-zoom:action'],
        ['touch', '', null],
        ['touch', 'pan', null],
    ])('%s-%s → %s', (prefix, value, group) => {
        expect(classifyAmbiguousValue(prefix, value)).toBe(group);
    });
});

describe('scroll snap keeps its axis, strictness, alignment and stop', () => {
    it('keeps the axis beside the strictness', () => {
        expect(_szcn('snap-x', 'snap-mandatory')).toBe('snap-x snap-mandatory');
        expect(_szcn('snap-mandatory', 'snap-x')).toBe('snap-mandatory snap-x');
    });

    it('keeps the axis beside an alignment and a stop', () => {
        expect(_szcn('snap-x', 'snap-center')).toBe('snap-x snap-center');
        expect(_szcn('snap-center', 'snap-always')).toBe('snap-center snap-always');
    });

    it('still replaces an axis with an axis, and a strictness with a strictness', () => {
        expect(_szcn('snap-x', 'snap-y')).toBe('snap-y');
        expect(_szcn('snap-x', 'snap-none')).toBe('snap-none');
        expect(_szcn('snap-mandatory', 'snap-proximity')).toBe('snap-proximity');
        expect(_szcn('snap-start', 'snap-end')).toBe('snap-end');
        expect(_szcn('snap-normal', 'snap-always')).toBe('snap-always');
    });
});

describe('a list marker keeps its type, position and image apart', () => {
    it('keeps the marker type beside its position', () => {
        expect(_szcn('list-disc', 'list-inside')).toBe('list-disc list-inside');
        expect(_szcn('list-inside', 'list-disc')).toBe('list-inside list-disc');
    });

    it('keeps the display utility out of the marker groups', () => {
        expect(_szcn('list-item', 'list-disc')).toBe('list-item list-disc');
    });

    it('still replaces a type with a type, and a position with a position', () => {
        expect(_szcn('list-disc', 'list-decimal')).toBe('list-decimal');
        expect(_szcn('list-disc', 'list-none')).toBe('list-none');
        expect(_szcn('list-inside', 'list-outside')).toBe('list-outside');
    });
});

describe('an object fit is not an object position', () => {
    it('keeps the fit beside the position', () => {
        expect(_szcn('object-cover', 'object-center')).toBe('object-cover object-center');
        expect(_szcn('object-center', 'object-cover')).toBe('object-center object-cover');
    });

    it('still replaces a fit with a fit, and a position with a position', () => {
        expect(_szcn('object-cover', 'object-contain')).toBe('object-contain');
        expect(_szcn('object-cover', 'object-none')).toBe('object-none');
        expect(_szcn('object-center', 'object-top-left')).toBe('object-top-left');
    });
});

describe('generated content is not align-content', () => {
    it('keeps the content beside the alignment', () => {
        expect(_szcn('content-none', 'content-center')).toBe('content-none content-center');
        expect(_szcn('content-center', 'content-none')).toBe('content-center content-none');
    });

    it('still replaces an alignment with an alignment', () => {
        expect(_szcn('content-center', 'content-between')).toBe('content-between');
        expect(_szcn('content-start', 'content-end-safe')).toBe('content-end-safe');
    });
});

describe('touch actions compose from independent variables', () => {
    it('keeps the two pan axes and the pinch flag together', () => {
        expect(_szcn('touch-pan-x', 'touch-pinch-zoom')).toBe('touch-pan-x touch-pinch-zoom');
        expect(_szcn('touch-pan-x', 'touch-pan-y')).toBe('touch-pan-x touch-pan-y');
        expect(_szcn('touch-pan-left touch-pan-up touch-pinch-zoom')).toBe(
            'touch-pan-left touch-pan-up touch-pinch-zoom',
        );
    });

    it('still replaces a pan on the same axis, and one plain action with another', () => {
        expect(_szcn('touch-pan-left', 'touch-pan-right')).toBe('touch-pan-right');
        expect(_szcn('touch-auto', 'touch-none')).toBe('touch-none');
        expect(_szcn('touch-auto', 'touch-manipulation')).toBe('touch-manipulation');
    });
});
