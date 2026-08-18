/**
 * The `!` important modifier, on every engine.
 *
 * `{ text: '14px!' }` has to become `text-[14px]!` — brackets around the
 * VALUE, the bang outside them, because that is the only spelling Tailwind
 * generates. The native engine never separated the two: it asked "does this
 * value need brackets?" of the string with the bang still attached, so a unit
 * value stopped looking like one (`text-14px!`, no brackets, no CSS) and a
 * value that brackets for another reason swallowed the bang instead
 * (`bg-[#fff!]`).
 *
 * It survived because the shape everybody tests is a named token — `text-base!`
 * is correct by accident, since a name needs no brackets either way. Found from
 * a real page: an icon with `font-size: 14px !important` that rendered at the
 * inherited size, because `text-14px!` reached the safelist and Tailwind has no
 * such utility.
 *
 * A build can switch engines with `build.parser`, so a divergence here means
 * the same source ships different CSS depending on a setting that is supposed
 * to be an implementation detail.
 */
import { describe, it } from 'vitest';

import { expectParity } from './engine-parity-harness.js';

describe('an important modifier keeps its brackets outside the bang', () => {
    it.each([
        // A bare unit value: brackets come from the unit, and looking for the
        // unit at the END of the string is what the bang broke.
        ["{ text: '14px!' }", 'text-[14px]!'],
        ["{ w: '50dvh!' }", 'w-[50dvh]!'],
        ["{ p: '2rem!' }", 'p-[2rem]!'],
        // Bracketed for a different reason each time — a hash colour, a
        // function call, a value with a space. Here the bang was landing
        // INSIDE the brackets, which is a class Tailwind never emits.
        ["{ bg: '#fff!' }", 'bg-[#fff]!'],
        ["{ text: 'calc(1px + 2px)!' }", 'text-[calc(1px_+_2px)]!'],
        ["{ gridCols: '1fr 2fr!' }", 'grid-cols-[1fr_2fr]!'],
        // A fraction takes no brackets at all, and must still not be read as
        // one value ending in `2!`.
        ["{ w: '1/2!' }", 'w-1/2!'],
        // Named tokens: correct before this fix, pinned so it stays that way.
        ["{ text: 'base!' }", 'text-base!'],
        ["{ bg: 'blue-500!' }", 'bg-blue-500!'],
        // The bang belongs to the utility, so a variant prefix stays in front.
        ["{ hover: { w: '3px!' } }", 'hover:w-[3px]!'],
        ["{ md: { bg: '#abc!' } }", 'md:bg-[#abc]!'],
        // A negative LENGTH stays inside the bracket — the minus is part of
        // the value, not a negative-utility prefix. Pinned with the bang
        // because that is the pair the fix had to keep apart.
        ["{ mt: '-4px!' }", 'mt-[-4px]!'],
    ])('compiles %s to %s on every engine', (sz, expected) => {
        expectParity(sz, expected);
    });

    it('leaves a bang that is part of the value alone', () => {
        // Only a TRAILING bang is the modifier; one inside an arbitrary value
        // belongs to the value. (The quotes normalize to single, which is the
        // existing content-value contract, not part of this fix.)
        expectParity('{ content: \'"!"\' }', "content-['!']");
    });

    it('strips exactly one bang, so a doubled one cannot lower per engine', () => {
        // Garbage either way, but the engines have to agree on which garbage:
        // taking bangs off in a loop would bracket the value on one lane only.
        expectParity("{ w: '14px!!' }", 'w-14px!!');
    });
});
