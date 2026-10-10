/**
 * Byte offsets from the engine, read back as the line and column an editor shows.
 *
 * The engine counts bytes of UTF-8; a JavaScript string counts UTF-16 code
 * units, and an editor's column is the latter. Every width of character is
 * pinned here, because a column that drifts by one per accented letter is the
 * bug a reader of the build log notices last.
 */
import { describe, expect, it } from 'vitest';

import {
    createByteOffsetLocator,
    locateEngineSpans,
    restoreEngineSpans,
    storeEngineSpans,
} from '../src/engine-spans.js';

/**
 * The UTF-8 byte offset of a UTF-16 index.
 *
 * @param source - The text.
 * @param index - A UTF-16 index into it.
 * @returns How many UTF-8 bytes precede it.
 */
function byteOffsetOf(source: string, index: number): number {
    return new TextEncoder().encode(source.slice(0, index)).length;
}

describe('createByteOffsetLocator', () => {
    // One, two, three and four bytes of UTF-8 before the marker, then a line.
    const source = 'a é — 😀 X\nsecond Y\n\nZ';

    it.each(['a', 'X', 'Y', 'Z'])('places %s where a JavaScript index would', marker => {
        const index = source.indexOf(marker);
        const before = source.slice(0, index).split('\n');

        expect(createByteOffsetLocator(source)(byteOffsetOf(source, index))).toEqual({
            line: before.length,
            column: (before.at(-1) ?? '').length + 1,
        });
    });

    it('agrees with a slice-and-encode reading at every character of mixed text', () => {
        // A fixed seed, so a failure names the same text on every run.
        let seed = 7;
        const next = (bound: number): number => {
            seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
            return seed % bound;
        };
        const alphabet = ['a', 'é', '—', '😀', '\n', ' '];
        for (let round = 0; round < 50; round++) {
            const text = Array.from({ length: 1 + next(40) }, () => alphabet[next(6)]).join('');
            const locate = createByteOffsetLocator(text);
            for (const [index] of [...text].entries()) {
                const unit = [...text].slice(0, index).join('').length;
                const before = text.slice(0, unit).split('\n');
                expect(locate(byteOffsetOf(text, unit)), JSON.stringify(text)).toEqual({
                    line: before.length,
                    column: (before.at(-1) ?? '').length + 1,
                });
            }
        }
    });

    it('places an offset past the end at the end', () => {
        expect(createByteOffsetLocator('ab\ncd')(99)).toEqual({ line: 2, column: 3 });
    });

    it('builds its index once, on the first lookup', () => {
        let reads = 0;
        const text = new Proxy(new String('ab\ncd'), {
            get(target, property, receiver) {
                if (property === 'codePointAt') reads++;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as string;
        const locate = createByteOffsetLocator(text);

        expect(reads).toBe(0);
        locate(4);
        const afterFirst = reads;
        locate(4);

        expect(afterFirst).toBeGreaterThan(0);
        // The second lookup only walks its own line.
        expect(reads - afterFirst).toBeLessThan(afterFirst);
    });
});

describe('locateEngineSpans', () => {
    it('reads each span at its offset, and only when asked', () => {
        const source = 'x\ny';
        const located = locateEngineSpans(source, {
            issues: [{ code: 'unknown-key', start: 2 }],
            mergeGroups: [{ keys: ['m', 'p'], keyStarts: [0, 2], classes: ['m-1', 'p-4'] }],
            mergeOverrides: [{ start: 2, base: ['a'], over: ['b'] }],
        });

        // Read through JSON: a position is an accessor, not an own field.
        expect(JSON.parse(JSON.stringify(located))).toEqual({
            issues: [{ code: 'unknown-key', line: 2, column: 1 }],
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
            mergeOverrides: [{ line: 2, column: 1, base: ['a'], over: ['b'] }],
        });
        expect(located.issues[0]?.line).toBe(2);
        expect(located.mergeGroups[0]?.positions[0]?.column).toBe(1);
        expect(located.mergeOverrides[0]?.line).toBe(2);
        expect(JSON.parse(JSON.stringify(located.issues))).toEqual([
            { code: 'unknown-key', line: 2, column: 1 },
        ]);
        // Each class's place survives a cache write as plain fields.
        expect(JSON.parse(JSON.stringify(located.mergeGroups[0]?.positions))).toEqual([
            { line: 1, column: 1 },
            { line: 2, column: 1 },
        ]);
    });

    it('resolves the line index once for the whole file, on the first read', () => {
        let reads = 0;
        const source = new Proxy(new String('x\ny'), {
            get(target, property, receiver) {
                if (property === 'codePointAt') reads++;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as string;
        const located = locateEngineSpans(source, {
            issues: [{ code: 'unknown-key', start: 2 }],
            mergeGroups: [{ keys: ['m'], keyStarts: [2], classes: ['m-1'] }],
            mergeOverrides: [],
        });

        expect(reads).toBe(0);
        expect(located.issues[0]?.line).toBe(2);
        const afterFirst = reads;
        // Another entry of the same file shares the index already built.
        expect(located.mergeGroups[0]?.positions[0]?.line).toBe(2);
        expect(reads - afterFirst).toBeLessThan(afterFirst);
    });

    it('reads a deep-cloned entry as having no position instead of throwing', () => {
        const [issue] = locateEngineSpans('x\ny', {
            issues: [{ code: 'unknown-key', start: 2 }],
            mergeGroups: [],
            mergeOverrides: [],
        }).issues;
        // What a clone helper builds: the prototype, then each own field.
        const copy = Object.assign(Object.create(Object.getPrototypeOf(issue)), issue);

        expect(copy.code).toBe('unknown-key');
        expect(copy.line).toBeUndefined();
        expect(storeEngineSpans({ issues: [copy] }).issues?.[0]).toBe(copy);
    });
});

describe('storeEngineSpans and restoreEngineSpans', () => {
    /**
     * A source whose every character read is counted.
     *
     * @param text - The source.
     * @returns The counting source and a reader of the count.
     */
    function counted(text: string): { source: string; reads: () => number } {
        let reads = 0;
        const source = new Proxy(new String(text), {
            get(target, property, receiver) {
                if (property === 'codePointAt') reads++;
                const value = Reflect.get(target, property, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        }) as unknown as string;
        return { source, reads: () => reads };
    }

    const raw = {
        issues: [{ code: 'unknown-key', start: 2 }],
        mergeGroups: [{ keys: ['m', 'p'], keyStarts: [0, 2], classes: ['m-1', 'p-4'] }],
        mergeOverrides: [{ start: 2, base: ['a'], over: ['b'] }],
    };

    it('stores the offsets the engine reported, without resolving a position', () => {
        const { source, reads } = counted('x\ny');
        const stored = storeEngineSpans(locateEngineSpans(source, raw));

        expect(stored).toEqual(raw);
        expect(reads()).toBe(0);
    });

    it('reads stored offsets back in place, still only when asked', () => {
        const { source, reads } = counted('x\ny');
        const restored = restoreEngineSpans(
            source,
            storeEngineSpans(locateEngineSpans(source, raw)),
        );

        expect(reads()).toBe(0);
        expect(JSON.stringify(restored)).toBe(JSON.stringify(locateEngineSpans('x\ny', raw)));
        expect(restored.issues?.[0]?.line).toBe(2);
        // A second store of what was read back gives the offsets again.
        expect(storeEngineSpans(restored)).toEqual(raw);
    });

    it('keeps an entry it did not locate as it is', () => {
        const plain = {
            issues: [{ code: 'unknown-key' as const, line: 2, column: 1 }],
            mergeGroups: [{ keys: ['p'], positions: [{ line: 1, column: 1 }], classes: ['p-4'] }],
            mergeOverrides: [{ line: 2, column: 1, base: ['a'], over: ['b'] }],
        };

        expect(storeEngineSpans(plain)).toEqual(plain);
        expect(restoreEngineSpans('x\ny', plain)).toEqual(plain);
        expect(storeEngineSpans({})).toEqual({});
        expect(restoreEngineSpans('x\ny', {})).toEqual({});
    });
});
