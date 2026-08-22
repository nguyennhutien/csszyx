/**
 * `csszyx_reverse` answers "which sz object is this class string?", and an
 * assistant pastes the answer into code. The answer is only worth pasting if
 * compiling it gives the classes back — which is a check the tool can run
 * itself, since the compiler is already a dependency. An sz object that
 * compiles to something else is a wrong answer delivered with confidence,
 * which is how `min-[330px]:grid` reached a user as `min:330px:grid`.
 */
import { describe, expect, it } from 'vitest';

import { handleReverse, roundTrip } from '../src/tools/reverse';

function reverse(classes: string) {
    return JSON.parse(handleReverse({ classes }).content[0].text);
}

describe('csszyx_reverse tool', () => {
    it('should convert Tailwind classes to sz object', () => {
        const data = reverse('p-4 bg-red-500');

        expect(data.szObject.p).toBe(4);
        expect(data.szObject.bg).toBe('red-500');
    });

    it('should report unrecognized classes', () => {
        const data = reverse('p-4 unknown-class');

        expect(data.szObject.p).toBe(4);
        expect(data.unrecognized).toContain('unknown-class');
    });
});

describe('the answer proves itself by compiling back to the input', () => {
    it('reports a clean round trip for a plain class list', () => {
        const data = reverse('p-4 bg-red-500 hover:text-white');

        expect(data.roundTrip).toEqual({ ok: true, emitted: 'p-4 bg-red-500 hover:text-white' });
    });

    it.each([
        'min-[330px]:grid',
        'max-[900px]:hidden',
        'supports-[display:grid]:grid',
        'data-[state=open]:bg-red-500',
        'font-stretch-condensed',
        '[&>span]:text-blue-500',
    ])('round-trips %s', classes => {
        expect(reverse(classes).roundTrip.ok).toBe(true);
    });

    it('keeps the order-independent comparison: same classes, any order, is ok', () => {
        const data = reverse('hover:text-white p-4');

        expect(data.roundTrip.ok).toBe(true);
    });

    it('leaves unrecognized classes out of the comparison and still reports them', () => {
        const data = reverse('p-4 unknown-class');

        expect(data.roundTrip).toEqual({ ok: true, emitted: 'p-4' });
        expect(data.unrecognized).toEqual(['unknown-class']);
    });

    it('says so when the object compiles to something else', () => {
        // Exercised on the pure helper: after the parser fixes that motivated
        // this check, no real class string produces a bad answer any more,
        // which is the point — but the report must still be able to say no.
        const report = roundTrip({ p: 4 }, ['p-4', 'bg-red-500']);

        expect(report).toEqual({ ok: false, emitted: 'p-4' });
    });

    it('says so when the object compiles to more than was asked', () => {
        const report = roundTrip({ p: 4, bg: 'red-500' }, ['p-4']);

        expect(report.ok).toBe(false);
    });
});
