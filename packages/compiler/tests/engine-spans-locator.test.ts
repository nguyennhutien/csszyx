/**
 * The byte-offset locator, held against an oracle that encodes text with
 * `Buffer` one character at a time, over generated sources.
 *
 * The engine reports UTF-8 byte offsets into the source as the native binding
 * encodes it: an unpaired surrogate becomes U+FFFD, which `Buffer` writes the
 * same way. The generator mixes every UTF-8 width, CRLF and lone CR, U+2028
 * (not a line break here: only `\n` starts a line, as in the engine), both
 * lone halves of a pair, pairs, and runs long enough to cross many 64-byte
 * steps on one line, then asks for offsets inside characters and past the end.
 */
import { describe, expect, it } from 'vitest';

import { createByteOffsetLocator } from '../src/engine-spans.js';

/**
 * Where a byte offset falls, by encoding each character until it is reached.
 *
 * An offset inside a character resolves to the character after it, and one
 * past the end to the end.
 *
 * @param text - The source.
 * @param offset - A UTF-8 byte offset.
 * @returns The 1-based line and UTF-16 column.
 */
function oracle(text: string, offset: number): { line: number; column: number } {
    let byte = 0;
    let unit = 0;
    let line = 1;
    let lineStart = 0;
    // `for…of` yields code points, and a lone half of a pair on its own.
    for (const char of text) {
        if (byte >= offset) break;
        byte += Buffer.byteLength(char);
        unit += char.length;
        if (char === '\n') {
            line += 1;
            lineStart = unit;
        }
    }
    return { line, column: unit - lineStart + 1 };
}

/** Pieces the generator joins: every width, line ends, lone halves, long runs. */
const ATOMS = [
    'a',
    ' ',
    '\n',
    '\r\n',
    '\r',
    'é',
    '中',
    ' ',
    '😀',
    '\uD800',
    '\uDC00',
    '􏿿',
    'x'.repeat(70),
    '😀'.repeat(20),
    'é中'.repeat(40),
    '\uDC00'.repeat(30),
];

/**
 * A seeded generator, so a failure names the same text on every run.
 *
 * @param seed - The seed.
 * @returns A function giving an integer below its bound.
 */
function random(seed: number): (bound: number) => number {
    let state = seed;
    return bound => {
        state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
        return state % bound;
    };
}

describe('createByteOffsetLocator against a Buffer oracle', () => {
    it('places every offset of short sources, inside characters and past the end too', () => {
        const next = random(11);
        for (let round = 0; round < 400; round++) {
            const text = Array.from({ length: next(12) }, () => ATOMS[next(ATOMS.length)]).join('');
            const total = Buffer.byteLength(text);
            const locate = createByteOffsetLocator(text);
            // One comparison per source: an `expect` per offset took a CI
            // runner past the test's time limit.
            const offsets = Array.from({ length: total + 3 }, (_, offset) => offset);
            expect(
                offsets.map(offset => locate(offset)),
                JSON.stringify(text),
            ).toEqual(offsets.map(offset => oracle(text, offset)));
        }
    });

    it('places sampled offsets of long sources, in any order', () => {
        const next = random(29);
        for (let round = 0; round < 1500; round++) {
            const text = Array.from({ length: next(60) }, () => ATOMS[next(ATOMS.length)]).join('');
            const total = Buffer.byteLength(text);
            const locate = createByteOffsetLocator(text);
            const offsets = [
                0,
                total,
                total + 5,
                ...Array.from({ length: 20 }, () => next(total + 1)),
            ];
            expect(
                offsets.map(offset => locate(offset)),
                JSON.stringify(text),
            ).toEqual(offsets.map(offset => oracle(text, offset)));
        }
    });
});

describe('createByteOffsetLocator on one long line', () => {
    it('reads a bounded stretch of the line per lookup, not the line up to it', () => {
        // 40,000 UTF-16 units on one line; a lookup that walked from the line
        // start would read about 20,000 of them on average.
        const line = 'é中x😀'.repeat(8_000);
        let reads = 0;
        const text = new Proxy(new String(line), {
            get(target, property, receiver) {
                if (property === 'codePointAt') reads++;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as string;
        const locate = createByteOffsetLocator(text);
        const total = Buffer.byteLength(line);
        locate(0);
        const afterIndex = reads;
        const lookups = 200;
        for (let k = 1; k <= lookups; k++) {
            const offset = Math.floor((total * k) / (lookups + 1));
            expect(locate(offset)).toEqual(oracle(line, offset));
        }

        expect((reads - afterIndex) / lookups).toBeLessThan(200);
    });
});

/**
 * Counts every per-character read the locator makes of a source.
 *
 * @param source - The text.
 * @returns The text behind a proxy, and the read count so far.
 */
function counted(source: string): { text: string; reads: () => number } {
    let reads = 0;
    const text = new Proxy(new String(source), {
        get(target, property, receiver) {
            if (property === 'codePointAt' || property === 'charCodeAt') reads++;
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as unknown as string;
    return { text, reads: () => reads };
}

describe('createByteOffsetLocator by shape of source', () => {
    it('places every offset of an ASCII source without reading a character', () => {
        // An ASCII byte is one UTF-16 unit, so a column is a subtraction from
        // the line start, and lines come from searching for `\n`.
        const source = `${'const a = 1;\n'.repeat(500)}${'x'.repeat(5000)}`;
        const { text, reads } = counted(source);
        const locate = createByteOffsetLocator(text);
        for (const offset of [0, 13, 4000, source.length - 1, source.length, source.length + 9]) {
            expect(locate(offset)).toEqual(oracle(source, offset));
        }

        expect(reads()).toBe(0);
    });

    it('reads each line once to index it, and a lookup only its own line', () => {
        const lines = Array.from({ length: 200 }, (_, row) =>
            row % 4 === 0 ? `  // dòng ${row} có dấu` : `  const v${row} = ${row};`,
        );
        const source = lines.join('\n');
        const { text, reads } = counted(source);
        const locate = createByteOffsetLocator(text);
        locate(0);
        const indexed = reads();
        expect(indexed).toBeLessThanOrEqual(source.length);
        const total = Buffer.byteLength(source);
        for (let k = 1; k <= 100; k++) {
            const offset = Math.floor((total * k) / 101);
            const before = reads();
            expect(locate(offset)).toEqual(oracle(source, offset));
            expect(reads() - before).toBeLessThanOrEqual(40);
        }
    });

    it('reads only the lines holding non-ASCII text when indexing', () => {
        // Source code: an em dash in one comment among hundreds of ASCII lines.
        const comment = '// one — two';
        const lines = Array.from({ length: 400 }, (_, row) =>
            row === 250 ? comment : `const v${row} = ${row};`,
        );
        const source = lines.join('\n');
        const { text, reads } = counted(source);
        const locate = createByteOffsetLocator(text);
        const total = Buffer.byteLength(source);
        for (const offset of [0, total >> 1, total - 1, total]) {
            expect(locate(offset)).toEqual(oracle(source, offset));
        }

        expect(reads()).toBeLessThanOrEqual(comment.length);
    });

    it.each([
        ['only newlines', '\n'.repeat(3000)],
        ['one non-ASCII character as the last byte', `${'x'.repeat(4000)}é`],
        ['a non-ASCII character as the first byte', `é${'x'.repeat(4000)}\nend`],
        [
            'long ASCII and long non-ASCII lines',
            `${'a'.repeat(3000)}\n${'é中'.repeat(1500)}\n${'b'.repeat(3000)}`,
        ],
        ['CR without LF', `a\rb\rc\r\n${'é\r'.repeat(600)}z`],
        ['empty', ''],
    ])('places sampled offsets of %s', (_, source) => {
        const total = Buffer.byteLength(source);
        const locate = createByteOffsetLocator(source);
        const offsets = [
            0,
            1,
            total - 1,
            total,
            total + 1,
            ...Array.from({ length: 50 }, (_, k) => Math.floor((total * k) / 50)),
        ];
        expect(offsets.map(offset => locate(offset))).toEqual(
            offsets.map(offset => oracle(source, offset)),
        );
    });
});
