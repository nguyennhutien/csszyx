/**
 * The texts a class attribute string can put in the DOM, on both artifacts.
 * The mangle census reads every one, so an owned class an element carries
 * under a character reference is never renamed out from under it.
 */
import { describe, expect, it } from 'vitest';
import {
    classAttributeReadings,
    classAttributeReadingsRust,
    classAttributeReadingsWasm,
} from '../src/engine.js';
import { RUST_LANE } from './engine-parity-harness.js';

const ARTIFACTS = [
    ['wasm', classAttributeReadingsWasm],
    ...(RUST_LANE ? [['rust', classAttributeReadingsRust] as const] : []),
] as const;

describe.each(ARTIFACTS)('the %s artifact', (_artifact, read) => {
    it.each([
        ['both languages agree', 'p&#45;4 a&amp;b', ['p-4 a&b']],
        ['a name JSX knows and HTML keeps', 'x&hellip;', ['x…', 'x&hellip;']],
        ['`&lt` with no `;`, which HTML alone decodes', 'x&lt y', ['x&lt y', 'x< y']],
        ['nothing to decode', 'p-4 [&_p]:m-2', ['p-4 [&_p]:m-2']],
        ['a name neither knows', 'a&bogus;b', ['a&bogus;b']],
        // JSX keeps a reference to a lone surrogate; HTML reads it as U+FFFD.
        ['a lone surrogate', 'a&#xD800;', ['a&#xD800;', 'a�']],
    ])('%s', (_case, raw, readings) => {
        expect(read(raw)).toEqual(readings);
    });
});

describe.each(['wasm', ...(RUST_LANE ? ['rust'] : [])] as const)(
    'the %s artifact a build names',
    parser => {
        it('reads the attribute on it', () => {
            expect(classAttributeReadings('p&#45;4', { parser })).toEqual(['p-4']);
        });
    },
);
