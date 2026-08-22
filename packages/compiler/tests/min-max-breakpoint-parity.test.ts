/**
 * `min` and `max` breakpoint variants, on every engine.
 *
 * `{ min: { '330px': { display: 'grid' } } }` has to become
 * `min-[330px]:grid`, and `{ min: { md: { p: 4 } } }` has to become
 * `min-md:p-4`: the breakpoint joins its stem with a dash, bracketed when it
 * is a length, and the whole thing is one variant. The JavaScript engine has
 * done this since the keys were documented. The native engine had no branch
 * for the two stems at all, so they fell through to the plain-variant path
 * and came out as `min:330px:grid` — three colon-separated variants, none of
 * which Tailwind has, so the rule generated no CSS and nothing said so.
 *
 * Found through the MCP server: `csszyx_reverse` hands an assistant
 * `{ min: { '330px': … } }` for `min-[330px]:grid`, which is right, and the
 * build then compiled it wrong on the default lane. A build can switch engines
 * with `build.parser`, so a divergence here means the same source ships
 * different CSS depending on a setting that is supposed to be an
 * implementation detail.
 */
import { describe, it } from 'vitest';

import { expectParity } from './engine-parity-harness.js';

describe('min and max breakpoints join their stem with a dash', () => {
    it.each([
        // Arbitrary lengths are bracketed.
        ["{ min: { '330px': { display: 'grid' } } }", 'min-[330px]:grid'],
        ["{ max: { '900px': { display: 'none' } } }", 'max-[900px]:hidden'],
        ["{ min: { '40rem': { p: 4 } } }", 'min-[40rem]:p-4'],
        // Named breakpoints are not.
        ['{ min: { md: { p: 4 } } }', 'min-md:p-4'],
        ["{ max: { lg: { display: 'none' } } }", 'max-lg:hidden'],
        // Several breakpoints on one key keep source order.
        ["{ min: { '330px': { p: 1 }, md: { p: 2 } } }", 'min-[330px]:p-1 min-md:p-2'],
        // Nested under another variant, the breakpoint stays one segment.
        ["{ hover: { min: { '330px': { p: 4 } } } }", 'hover:min-[330px]:p-4'],
        ["{ min: { '330px': { hover: { p: 4 } } } }", 'min-[330px]:hover:p-4'],
    ])('%s → %s', (sz, expected) => {
        expectParity(sz, expected);
    });
});
