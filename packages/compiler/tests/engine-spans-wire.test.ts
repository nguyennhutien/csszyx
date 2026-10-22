/**
 * The engine's spans text, read by the one decoder both artifacts share.
 *
 * The text is length-prefixed: `<digits>,` is a number, `<digits>:<text>` a
 * string of that many UTF-16 units, so no character needs escaping. These
 * tests pin the grammar on a hand-written example, then check the decoder
 * against an independent writer on generated spans (round trip, shrunk on
 * failure), and against truncated, garbled and hostile text: every such
 * input is refused with the decoder's own error, never read past its end and
 * never answered with an array the size of a number it was handed.
 */
import { describe, expect, it } from 'vitest';

import { createRng, fuzzBudget } from '../../core/tests/helpers/sz-fuzz.js';
import {
    decodeEngineSpans,
    ENGINE_SPANS_FORMAT,
    EngineSpansWireError,
    storeEngineSpans,
} from '../src/engine-spans.js';
import {
    encodeSpansWire,
    randomWireSpans,
    shrinkWireSpans,
    type WireSpans,
} from './helpers/engine-spans-wire.js';

/** The four lists of a file with nothing to report. */
const EMPTY: WireSpans = { issues: [], mergeGroups: [], singleClassGroups: [], mergeOverrides: [] };

/**
 * What a store keeps of the decoded spans: the decoder's output as offsets.
 *
 * @param text - The spans text.
 * @returns The stored form.
 */
function decoded(text: string): object {
    return storeEngineSpans(decodeEngineSpans('', text));
}

/**
 * The error decoding `text` throws.
 *
 * @param text - Spans text.
 * @returns What was thrown, or `undefined` when it decoded.
 */
function thrownBy(text: string): unknown {
    try {
        decodeEngineSpans('', text);
        return undefined;
    } catch (error) {
        return error;
    }
}

describe('decodeEngineSpans', () => {
    it('reads each list of the text, located against the source', () => {
        const text =
            '1,' +
            '1,11:unknown-key2,13:[{"key":"k"}]' +
            '1,2,1:m0,3:m-11:p2,3:p-4' +
            '1,1,1:m2,3:m-2' +
            '1,2,1,1:a1,1:b';

        expect(JSON.parse(JSON.stringify(decodeEngineSpans('x\ny', text)))).toEqual({
            issues: [{ code: 'unknown-key', args: { key: 'k' }, line: 2, column: 1 }],
            mergeGroups: [
                {
                    keys: ['m', 'p'],
                    positions: [
                        { line: 1, column: 1 },
                        { line: 2, column: 1 },
                    ],
                    classes: ['m-1', 'p-4'],
                },
            ],
            singleClassGroups: [
                { keys: ['m'], positions: [{ line: 2, column: 1 }], classes: ['m-2'] },
            ],
            mergeOverrides: [{ line: 2, column: 1, base: ['a'], over: ['b'] }],
        });
        expect(decoded(text)).toEqual({
            issues: [{ code: 'unknown-key', start: 2, args: { key: 'k' } }],
            mergeGroups: [{ keys: ['m', 'p'], keyStarts: [0, 2], classes: ['m-1', 'p-4'] }],
            singleClassGroups: [{ keys: ['m'], keyStarts: [2], classes: ['m-2'] }],
            mergeOverrides: [{ start: 2, base: ['a'], over: ['b'] }],
        });
    });

    it('reads a file with nothing to report as four empty lists, never as absent ones', () => {
        // `mergeGroupsOf` reads an absent list as the whole file in one group.
        expect(decodeEngineSpans('x', '1,0,0,0,0,')).toEqual({
            issues: [],
            mergeGroups: [],
            singleClassGroups: [],
            mergeOverrides: [],
        });
    });

    it('counts a length in UTF-16 units, as the engine writes it', () => {
        const text = '1,0,1,2,3:😀é0,2:p:1:\uD8001,2:,,0,0,';

        expect(decoded(text)).toEqual({
            ...EMPTY,
            mergeGroups: [{ keys: ['😀é', '\uD800'], keyStarts: [0, 1], classes: ['p:', ',,'] }],
        });
    });

    it('tells apart two names that land in the same cache slot', () => {
        // `Aa` and `BB` hash alike; a third read of `Aa` must still be `Aa`.
        const text = '1,0,1,3,1:a0,2:Aa1:b1,2:BB1:c2,2:Aa0,0,';

        expect(decoded(text)).toMatchObject({
            mergeGroups: [{ classes: ['Aa', 'BB', 'Aa'] }],
        });
    });

    it('reads every one of ten thousand different names, more than the cache holds', () => {
        const classes = Array.from({ length: 10_000 }, (_, index) => `c-${index}`);
        const spans: WireSpans = {
            ...EMPTY,
            mergeGroups: [
                { keys: classes.map(() => 'k'), keyStarts: classes.map(() => 0), classes },
                { keys: ['k'], keyStarts: [0], classes: ['c-0'] },
            ],
        };

        expect(decoded(encodeSpansWire(spans, ENGINE_SPANS_FORMAT))).toEqual(spans);
    });
});

describe('the spans format', () => {
    it('is refused by number when it is not the one this compiler reads', () => {
        const error = thrownBy(`${ENGINE_SPANS_FORMAT + 1},0,0,0,0,`);

        expect(error).toBeInstanceOf(EngineSpansWireError);
        expect((error as Error).message).toContain(
            `format ${ENGINE_SPANS_FORMAT + 1}; this compiler reads format ${ENGINE_SPANS_FORMAT}`,
        );
    });

    it('is refused when the text starts with no format number at all', () => {
        // What an engine that wrote the spans as JSON would hand over.
        const error = thrownBy('{"issues":[]}');

        expect(error).toBeInstanceOf(EngineSpansWireError);
        expect((error as Error).message).toContain('no format number');
    });
});

describe('malformed spans text', () => {
    // Each of these is refused with the decoder's error: nothing past the
    // end is read, no number runs on, and no array is sized from a count the
    // rest of the text cannot hold.
    it.each([
        ['empty text', '', 'no format number'],
        ['a number with no end', '1', 'no format number'],
        ['a missing list', '1,0,0,0,', 'no digit'],
        ['an unterminated last count', '1,0,0,0,0', 'no `,` after a number'],
        ['text after the last list', '1,0,0,0,0,0,', 'text after the last list'],
        ['a sign', '1,-1,0,0,0,', 'no digit'],
        ['a plus', '1,+1,0,0,0,', 'no digit'],
        ['a letter for a digit', '1,0,x,0,0,', 'no digit'],
        ['a count the text cannot hold', '1,0,4294967295,', 'a count the rest cannot hold'],
        ['a count of a hundred million', '1,0,100000000,', 'a count the rest cannot hold'],
        ['a number past 32 bits', '1,0,0,0,1,4294967296,0,0,', 'a number past 32 bits'],
        [
            'a run of digits that would lose precision',
            `1,0,0,0,1,${'9'.repeat(40)},0,0,`,
            'a number past 32 bits',
        ],
        ['a string longer than the text', '1,0,1,1,5:ab', 'a string past the end'],
        ['a string length with no colon', '1,0,1,1,1,a0,1:b0,0,', 'no `:` after a length'],
        ['a group with no entries left', '1,0,1,2,1:a0,1:b0,0,', 'no `:` after a length'],
        ['args that are not JSON', '1,1,1:x0,1:[0,0,0,', 'args that are not JSON'],
        ['args that are not a list', '1,1,1:x0,2:{}0,0,0,', 'not one entry per issue'],
        ['args one short', '1,1,1:x0,2:[]0,0,0,', 'not one entry per issue'],
        ['args that are not objects', '1,1,1:x0,3:[1]0,0,0,', 'args that are not an object'],
        ['null args', '1,1,1:x0,6:[null]0,0,0,', 'args that are not an object'],
    ])('refuses %s', (_, text, why) => {
        const error = thrownBy(text);

        expect(error).toBeInstanceOf(EngineSpansWireError);
        expect((error as Error).message).toContain(why);
    });

    it('reads a valid text after refusing a malformed one', () => {
        expect(thrownBy('1,0,1,1,5:ab')).toBeInstanceOf(EngineSpansWireError);
        expect(decoded('1,0,1,1,1:a0,1:b0,0,')).toMatchObject({
            mergeGroups: [{ keys: ['a'], classes: ['b'] }],
        });
    });
});

describe('the decoder against the reference writer', () => {
    const { seed, cases } = fuzzBudget(400);

    it(`reads back every generated spans value it is written (seed ${seed}, ${cases} cases)`, () => {
        const fails = (spans: WireSpans): boolean => {
            try {
                expect(decoded(encodeSpansWire(spans, ENGINE_SPANS_FORMAT))).toEqual(spans);
                return false;
            } catch {
                return true;
            }
        };
        for (let index = 0; index < cases; index++) {
            const spans = randomWireSpans(seed + index);
            if (!fails(spans)) continue;
            const smallest = shrinkWireSpans(spans, fails);
            expect(
                decoded(encodeSpansWire(smallest, ENGINE_SPANS_FORMAT)),
                `seed ${seed + index}, shrunk to ${JSON.stringify(smallest)}`,
            ).toEqual(smallest);
        }
    });

    // Quadratic in a text's length, so the check stays out of the inner loop
    // and the budget is the fuzz suites' rather than the default 5 s.
    it(`refuses every strict prefix of a valid text (seed ${seed})`, () => {
        for (let index = 0; index < Math.min(cases, 100); index++) {
            const text = encodeSpansWire(randomWireSpans(seed + index), ENGINE_SPANS_FORMAT);
            for (let end = 0; end < text.length; end++) {
                const error = thrownBy(text.slice(0, end));
                if (!(error instanceof EngineSpansWireError)) {
                    expect(error, `seed ${seed + index}, cut at ${end}`).toBeInstanceOf(
                        EngineSpansWireError,
                    );
                }
            }
        }
    }, 30000);

    it(`decodes or refuses garbled text, and never throws anything else (seed ${seed})`, () => {
        const rng = createRng(seed);
        const below = (bound: number): number => Math.floor(rng() * bound);
        const noise = ['0', '1', '9', ',', ':', '[', ']', '{', '"', 'x', '\uD800', ''];
        for (let index = 0; index < cases; index++) {
            const text = encodeSpansWire(randomWireSpans(seed + index), ENGINE_SPANS_FORMAT);
            for (let edit = 0; edit < 20; edit++) {
                const at = below(text.length + 1);
                const garbled =
                    text.slice(0, at) + noise[below(noise.length)] + text.slice(at + below(3));
                const error = thrownBy(garbled);
                if (error !== undefined) {
                    expect(
                        error,
                        `seed ${seed + index}: ${JSON.stringify(garbled)}`,
                    ).toBeInstanceOf(EngineSpansWireError);
                }
            }
        }
    });
});
