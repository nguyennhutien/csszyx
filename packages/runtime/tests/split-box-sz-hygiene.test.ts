/**
 * The sz-object twins take the same selectors as the class toolkit and have
 * to refuse the same unusable ones — with one difference that matters: an
 * sz KEY (`minW`, `flexDir`, `gapX`) is a valid selector here and a class
 * prefix is not the vocabulary, so the check cannot be the class one. A
 * shared check was applied to `splitBoxSz` for one commit and silently
 * dropped every key-shaped override, routing `{ minW: 0 }` to `outer`
 * against an `inner: ['minW']` instruction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevWarnCache } from '../src/dev-warn.js';
import { hasSz, omitSz, pickSz, splitBoxSz } from '../src/split-box.js';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    resetDevWarnCache();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const said = (): string => warn.mock.calls.map(c => String(c[0])).join('\n');

describe('overrides written as sz keys', () => {
    it.each(['hover', '[&:hover]'])('pins the whole %s variant container', key => {
        const variant = { p: 2, m: 4 };
        expect(splitBoxSz({ [key]: variant }, { outer: [key] })).toEqual({
            outer: { [key]: variant },
            inner: {},
        });
        expect(said()).toBe('');
    });

    it('keeps the inner override precedence for a named variant', () => {
        const input = { hover: { m: 4 } };
        expect(splitBoxSz(input, { outer: ['hover'], inner: ['hover'] })).toEqual({
            outer: {},
            inner: input,
        });
        expect(said()).toBe('');
    });
    it('are honoured by splitBoxSz', () => {
        expect(splitBoxSz({ minW: 0, p: 2 }, { inner: ['minW'] })).toEqual({
            outer: {},
            inner: { minW: 0, p: 2 },
        });
        expect(splitBoxSz({ gapX: 2 }, { outer: ['gapX'] })).toEqual({
            outer: { gapX: 2 },
            inner: {},
        });
        expect(said()).toBe('');
    });

    it('are accepted by the twins without a warning', () => {
        expect(hasSz({ minW: 0 }, 'minW')).toBe(true);
        expect(hasSz({ flexDir: 'col' }, 'flexDir')).toBe(true);
        expect(Object.keys(pickSz({ gapX: 2, p: 4 }, 'gapX'))).toEqual(['gapX']);
        expect(said()).toBe('');
    });
});

describe('the twins refuse what the class toolkit refuses', () => {
    it('an empty object matches nothing', () => {
        expect(hasSz({ w: 'full', p: 2 }, {})).toBe(false);
        expect(pickSz({ w: 'full', p: 2 }, {})).toEqual({});
        expect(omitSz({ w: 'full', p: 2 }, {})).toEqual({ w: 'full', p: 2 });
        expect(said()).toContain('empty selector');
    });

    it('a misspelt selector warns', () => {
        expect(hasSz({ w: 'full' }, 'widht')).toBe(false);
        expect(said()).toContain("'widht'");
    });

    it('an array warns', () => {
        expect(hasSz({ w: 'full' }, ['w'] as unknown as string)).toBe(false);
        expect(said()).toContain('array');
    });
});
