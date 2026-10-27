/**
 * A file the parser rejects is reported once per syntax error, each issue
 * carrying the parser's message at the place it points to, on both engine
 * artifacts.
 *
 * The engine used to add a summary line before the parser's lines, and a
 * `panicked` line after them when the parser stopped early, both telling the
 * reader to fix the syntax error reported for the file: three issues for one
 * mistake, two of them pointing at the third.
 */
import { describe, expect, it } from 'vitest';

import { ENGINES } from './engine-parity-harness.js';

/** A first line the parser path reads: its `sz` is not all static. */
const PARSED = 'export const A = ({ c }) => <div sz={{ p: c ? 4 : 2 }} />;\n';

/**
 * Each parse-error issue of one source as its form, message and place.
 * @param engine - The engine artifact under test.
 * @param source - The module source.
 * @returns Form, message, line and column of each parse-error issue.
 */
function parseErrors(
    engine: (typeof ENGINES)[number][1],
    source: string,
): Array<[unknown, unknown, number | undefined, number | undefined]> {
    return (engine(source, { filename: 'src/Broken.tsx' }).issues ?? [])
        .filter(issue => issue.code === 'parse-error')
        .map(issue => {
            const args = issue.args as { form?: unknown; message?: unknown };
            return [args.form, args.message, issue.line, issue.column];
        });
}

describe('a syntax error', () => {
    it.each(ENGINES)('%s reports one the parser cannot recover from once', (_name, engine) => {
        expect(parseErrors(engine, `${PARSED}const broken = ;`)).toEqual([
            ['syntax', 'Unexpected token', 2, 16],
        ]);
    });

    it.each(ENGINES)('%s reports each recoverable one at its place', (_name, engine) => {
        const message = "A 'return' statement can only be used within a function body.";
        expect(parseErrors(engine, `${PARSED}return 1;\nreturn 2;`)).toEqual([
            ['syntax', message, 2, 1],
            ['syntax', message, 3, 1],
        ]);
    });

    it.each(ENGINES)('%s leaves the file unchanged', (_name, engine) => {
        const source = `${PARSED}const broken = ;`;
        expect(engine(source, { filename: 'src/Broken.tsx' }).code).toBe(source);
    });
});
