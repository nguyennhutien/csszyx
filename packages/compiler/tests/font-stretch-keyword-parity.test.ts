/**
 * `fontStretch` keywords, on every engine.
 *
 * `{ fontStretch: 'condensed' }` has to become `font-stretch-condensed`.
 * Both engines emitted `font-condensed`, and a test pinned that output. Asked
 * directly, Tailwind 4.3 generates CSS for `font-stretch-condensed` and
 * nothing at all for `font-condensed` — `font-*` is the weight and family
 * namespace, and `condensed` is neither. So the class reached the safelist,
 * Tailwind had no utility for it, and the text rendered at its normal width
 * with nothing in any log.
 *
 * The percentage forms were right all along (`font-stretch-50%`), which is
 * how the keyword form hid: the spec rows only list percentages, so the
 * generated key matrix never asked about a keyword.
 */
import { describe, it } from 'vitest';

import { expectParity } from './engine-parity-harness.js';

describe('fontStretch keywords keep the font-stretch prefix', () => {
    it.each([
        ["{ fontStretch: 'condensed' }", 'font-stretch-condensed'],
        ["{ fontStretch: 'expanded' }", 'font-stretch-expanded'],
        ["{ fontStretch: 'ultra-condensed' }", 'font-stretch-ultra-condensed'],
        ["{ fontStretch: 'semi-expanded' }", 'font-stretch-semi-expanded'],
        ["{ fontStretch: 'normal' }", 'font-stretch-normal'],
        // The forms that were already right must stay right.
        ["{ fontStretch: '50%' }", 'font-stretch-50%'],
        ["{ fontStretch: '50.5%' }", 'font-stretch-[50.5%]'],
        ["{ fontStretch: '--s' }", 'font-stretch-(--s)'],
        ["{ fontStretch: 'wide' }", 'font-stretch-[wide]'],
        ["{ hover: { fontStretch: 'condensed' } }", 'hover:font-stretch-condensed'],
    ])('%s → %s', (sz, expected) => {
        expectParity(sz, expected);
    });
});
