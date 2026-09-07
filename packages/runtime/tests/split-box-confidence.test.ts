/**
 * `classify` says how sure it is, because the answer is not always as certain
 * as its shape suggests.
 *
 * The table matches by class PREFIX and holds no knowledge of which values a
 * prefix accepts, so an app's own `tab-items-wrapper` comes back as a `text`
 * utility with the same shape a real `text-sm` does. Measured against the
 * installed Tailwind, every prefix in the generated table accepts at least one
 * suffix Tailwind does not serve — so this is the ordinary case, not an edge.
 *
 * Only an oracle can say which of the two a token is, and the runtime has
 * none: it ships to a browser where Tailwind is not present. What it CAN say
 * without guessing is how it arrived at the answer, and that is what this
 * field is. `exact` means the whole name is in the table; `prefix` means only
 * the part before the value was, and the value was taken on trust.
 *
 * See `.agent/decisions/0022-class-diagnosis-four-surfaces.md`.
 */
import { describe, expect, it } from 'vitest';
import { classify } from '../src/split-box.js';

describe('a name the table holds in full', () => {
    it.each([
        ['block', 'value-keyed sugar'],
        ['italic', 'value-keyed sugar'],
        ['truncate', 'a boolean shorthand'],
        ['overflow-hidden', 'one closed value of a prefixed key'],
        ['group', 'a scope marker'],
        ['group/item', 'a named scope marker'],
        ['flex', 'a prefix that is also a whole utility'],
    ])('%s is exact — %s', token => {
        expect(classify(token)?.confidence).toBe('exact');
    });
});

describe('a name matched only by its prefix', () => {
    it.each([
        ['p-4', 'a real utility whose value the table never checked'],
        ['text-red-500', 'a real utility'],
        ['tab-items-wrapper', "an app's own class that collides with tab-"],
        ['list-member-in-group', "an app's own class that collides with list-"],
        ['bg-[url(https://x/y.png)]', 'an arbitrary value'],
    ])('%s is prefix — %s', token => {
        expect(classify(token)?.confidence).toBe('prefix');
    });

    it('does not pretend a real utility is more certain than a made-up one', () => {
        // The point of the field: these two are indistinguishable to the
        // runtime, and saying so is the honest answer.
        expect(classify('tab-4')?.confidence).toBe(classify('tab-items-wrapper')?.confidence);
    });
});

describe('what the field does not do', () => {
    it('is absent when nothing classified the token', () => {
        expect(classify('dems-panel')).toBeUndefined();
    });

    it('never changes which node a token routes to', () => {
        // Confidence is information about the answer, not a vote on it.
        expect(classify('tab-items-wrapper')?.role).toBe(classify('tab-4')?.role);
    });

    it('survives a variant and an important marker', () => {
        expect(classify('md:p-4')?.confidence).toBe('prefix');
        expect(classify('hover:block')?.confidence).toBe('exact');
        expect(classify('p-4!')?.confidence).toBe('prefix');
        expect(classify('-mt-4')?.confidence).toBe('prefix');
    });
});
