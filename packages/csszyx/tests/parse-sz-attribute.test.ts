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

import { describe, expect, it } from 'vitest';

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
    it('names the character and where it is', () => {
        expect(strayInputsEnd).toBe(true);
        expect(() => parseSzAttribute('{ w: 1/2 }')).toThrow(
            new SyntaxError('[csszyx] Unexpected "/" at 6 in sz attribute "{ w: 1/2 }"'),
        );
        expect(() => parseSzAttribute('{ list: [1, /] }')).toThrow(/Unexpected "\/" at 12/);
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
        let message = '';
        try {
            parseSzAttribute(input);
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain(` at ${at} in `);
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
