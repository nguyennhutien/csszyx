/**
 * The CDN runtime's `sz` attribute parser always terminates.
 *
 * It parses author-written HTML on the page that loads it. A character its
 * grammar does not expect — `{ w: 1/2 }`, `{ p: 4; m: 2 }`, `{ color: #fff }` —
 * used to leave every branch without advancing, so the object loop spun
 * forever and the page froze. A frozen page is the one failure a script tag
 * must never cause; a parse error is reported and the element left alone.
 *
 * A spinning loop blocks the event loop, so no in-process timeout can stop it:
 * inputs that could spin run in a child process with a deadline.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { isCsszyxError } from '@csszyx/compiler/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { productionMessage, runtimeMessage } from '../../compiler/tests/engine-message.js';
import { parseSzAttribute } from '../src/parse-sz-attribute.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const MODULE = path.resolve(import.meta.dirname, '../src/parse-sz-attribute.ts');

/**
 * Run a script with `parseSzAttribute` in scope, in a child process.
 * @param body - Module code that prints one JSON value to stdout.
 * @param timeoutMs - The deadline.
 * @returns The printed value, or `'TIMEOUT'` when the deadline passed.
 */
function inChild(body: string, timeoutMs: number): unknown {
    const code = `import { parseSzAttribute } from ${JSON.stringify(MODULE)};\n${body}`;
    const run = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', code],
        {
            cwd: REPO,
            encoding: 'utf8',
            timeout: timeoutMs,
        },
    );
    if (run.error || run.signal) return 'TIMEOUT';
    return JSON.parse(run.stdout.trim());
}

/** How one input ends: the parsed object, or the error's name. */
const OUTCOME = `
const outcome = input => {
    try { return { value: parseSzAttribute(input) }; }
    catch (error) { return { error: error.name }; }
};`;

/** Set once a child process has shown the stray-character inputs end. */
let strayInputsEnd = false;

/** The args of the `sz-attribute-syntax` error `{ w: 1/2 }` throws. */
const ARGS = { form: 'char', input: '{ w: 1/2 }', char: '/', index: 6 };

afterEach(() => {
    process.env.NODE_ENV = 'test';
});

/**
 * The error one input throws.
 * @param input - An attribute the parser rejects.
 * @returns The error, with the code and args it carries.
 */
function thrownBy(input: string): SyntaxError & {
    code: string;
    args: { form: string; input: string; char?: string; index: number };
} {
    try {
        parseSzAttribute(input);
    } catch (error) {
        return error as SyntaxError & {
            code: string;
            args: { form: string; input: string; char?: string; index: number };
        };
    }
    throw new Error(`expected ${input} to throw`);
}

describe('parseSzAttribute', () => {
    it.each([
        ['{ p: 4 }', { p: 4 }],
        ["p: 4, bg: 'red-500'", { p: 4, bg: 'red-500' }],
        ["{ w: '1/2' }", { w: '1/2' }],
        ['{ md: { p: 2 }, hover: { opacity: 50 } }', { md: { p: 2 }, hover: { opacity: 50 } }],
        [
            "{ '[&>span]': { p: 1 }, flag: true, none: null }",
            { '[&>span]': { p: 1 }, flag: true, none: null },
        ],
        ['{ list: [1, 2, 3] }', { list: [1, 2, 3] }],
        // An escaped quote stays in the string; an escape with nothing after
        // it ends the string at the end of the input.
        ["{ content: 'it\\'s' }", { content: "it's" }],
        ["{ content: 'x\\", { content: 'x' }],
    ])('parses %s as before', (input, expected) => {
        expect(parseSzAttribute(input)).toEqual(expected);
    });

    it.each([
        ['{ w: 1/2 }'],
        ['{ p: 4; m: 2 }'],
        ['{ color: #fff }'],
        ['{ w: calc(1px) }'],
        ['{ list: [1, /] }'],
    ])('reports %s as a syntax error instead of spinning', input => {
        expect(
            inChild(
                `${OUTCOME}\nconsole.log(JSON.stringify(outcome(${JSON.stringify(input)})));`,
                5_000,
            ),
        ).toEqual({
            error: 'SyntaxError',
        });
        strayInputsEnd = true;
    });

    // In this process too, so coverage sees the throw — but only once a child
    // has shown it ends: a regression would otherwise hang the suite here.
    // The error keeps its class, so a caller testing `instanceof SyntaxError`
    // still matches, and carries the code and args of the runtime's line.
    it('names the character and where it is', () => {
        expect(strayInputsEnd).toBe(true);
        process.env.NODE_ENV = 'development';
        const error = thrownBy('{ w: 1/2 }');
        expect(error).toBeInstanceOf(SyntaxError);
        expect(isCsszyxError(error)).toBe(true);
        expect(error.code).toBe('sz-attribute-syntax');
        expect(error.args).toEqual(ARGS);
        expect(error.message).toBe(
            runtimeMessage(
                'sz-attribute-syntax',
                'The `sz` attribute `{ w: 1/2 }` has an unexpected `/` at offset 6, so the element gets no classes from it.',
                'help: write it as an object literal with commas between keys, such as `sz="p: 4, w: \'1/2\'"`; quote a value that holds `/` or `#`.',
            ),
        );
        expect(thrownBy('{ list: [1, /] }').args).toMatchObject({ char: '/', index: 12 });
    });

    it('names where an attribute ends before a key or value is complete, with no character to name', () => {
        process.env.NODE_ENV = 'development';
        // `[` reads as a key that never reaches its `:`; the end is after
        // the attribute's last character, the trailing space aside.
        const error = thrownBy(' [ ');
        expect(error).toBeInstanceOf(SyntaxError);
        expect(error.args).toEqual({ form: 'end', input: ' [ ', index: 2 });
        expect(error.message).toBe(
            runtimeMessage(
                'sz-attribute-syntax',
                'The `sz` attribute ` [ ` ends at offset 2 before a key or value is complete, so the element gets no classes from it.',
                'help: give every key a `:` and a value, and close every `[` and quote, such as `sz="p: 4, [&>span]: { m: 2 }"`.',
            ),
        );
        expect(thrownBy('{ p').args).toEqual({ form: 'end', input: '{ p', index: 3 });
    });

    // Brace-less input is parsed inside a `{ }` the parser adds. That `}` is
    // not the author's, so it is never the character a report names: input
    // that runs into it ends there, at the end of the attribute as written.
    it.each([
        ['p', 1],
        ['w: [1, 2', 8],
        ['  p: 4, m  ', 9],
    ])('reports %j as ending at offset %i, not at the `}` the parser added', (input, at) => {
        expect(strayInputsEnd).toBe(true);
        expect(thrownBy(input).args).toEqual({ form: 'end', input, index: at });
    });

    it('is the compact line in production', () => {
        process.env.NODE_ENV = 'production';
        const error = thrownBy('{ w: 1/2 }');
        expect(error).toBeInstanceOf(SyntaxError);
        expect(error.code).toBe('sz-attribute-syntax');
        expect(error.message).toBe(productionMessage('sz-attribute-syntax', ARGS));
    });

    // The position indexes the attribute as written, so it points at the
    // character: not shifted by the `{` added around brace-less input, nor by
    // the leading whitespace trimmed before parsing.
    it.each([
        ['w: 1/2', 4],
        ['p: 4; m: 2', 4],
        ['bg: #fff', 4],
        ['  w: 1/2', 6],
        ['  { w: 1/2 }', 8],
    ])('points the position of %s at the stray character', (input, at) => {
        expect(strayInputsEnd).toBe(true);
        expect(thrownBy(input).args.index).toBe(at);
        expect(input[at]).toMatch(/[/;#]/);
    });

    it('ends on every input: 5,000 generated strings over the grammar characters', () => {
        const result = inChild(
            `${OUTCOME}
let seed = 0x5eed;
const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const alphabet = [...'{}[]:,\\'"\\\\ /;#()ap4.-+_$@&>\\n'];
const tally = { value: 0, SyntaxError: 0, RangeError: 0, other: [] };
for (let i = 0; i < 5000; i++) {
    let input = '';
    for (let n = Math.floor(random() * 40); n > 0; n--) input += alphabet[Math.floor(random() * alphabet.length)];
    const end = outcome(input);
    if ('value' in end) tally.value++;
    else if (end.error in tally) tally[end.error]++;
    else tally.other.push([input, end.error]);
}
console.log(JSON.stringify(tally));`,
            20_000,
        ) as { value: number; SyntaxError: number; other: unknown[] };

        expect(result).not.toBe('TIMEOUT');
        expect(result.other).toEqual([]);
        // Both outcomes occur, so the generator reaches each side.
        expect(result.value).toBeGreaterThan(0);
        expect(result.SyntaxError).toBeGreaterThan(0);
    });

    it('ends on adversarial sizes: a million stray characters, a hundred thousand open braces', () => {
        const result = inChild(
            `${OUTCOME}
console.log(JSON.stringify([
    outcome('{ p: ' + '/'.repeat(1_000_000) + ' }'),
    outcome('{a:'.repeat(100_000)),
]));`,
            20_000,
        );

        expect(result).not.toBe('TIMEOUT');
        const [stray, deep] = result as Array<{ error?: string }>;
        expect(stray).toEqual({ error: 'SyntaxError' });
        // Too deep for the call stack is a thrown RangeError, which the
        // runtime reports like any parse error — never a hang.
        expect(['SyntaxError', 'RangeError']).toContain(deep?.error);
    });
});

describe('parseSzAttribute own keys', () => {
    it('keeps `__proto__` as a key of the parsed object, not its prototype', () => {
        // An assignment to `__proto__` sets the prototype, so the key vanished
        // from the object and its value became what every lookup fell back to.
        const parsed = parseSzAttribute('{__proto__: {p: 4}, m: 2}');

        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.keys(parsed)).toEqual(['__proto__', 'm']);
        expect(Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value).toEqual({ p: 4 });
        expect((parsed as { p?: unknown }).p).toBeUndefined();
    });
});

describe('parseSzAttribute keys without a value', () => {
    it.each(['flex gap-2', 'flex', '{ p: 4, flex }'])('rejects %j', raw => {
        // A key must be followed by `:`; without one the text is a class list.
        expect(() => parseSzAttribute(raw)).toThrow(SyntaxError);
    });
});
