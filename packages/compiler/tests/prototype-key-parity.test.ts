/**
 * A key named like a member of `Object.prototype` is an unknown key like any
 * other: `{ constructor: 'inherit' }` writes `constructor-inherit` and reports
 * `unknown-key` on every lane.
 *
 * The runtime lowering looked such a key up in its tables with `in` and by
 * index, both of which read the prototype, so it wrote nothing and named
 * `Object` in a `removed-key` line while both engines wrote the class.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { PROPERTY_MAP } from '../src/sz-key-tables.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';
import { szReportedCodes } from './helpers/sz-console-line.js';

/** What one lane wrote for an sz object, and the kinds it reported. */
interface LaneResult {
    className: string;
    kinds: string[];
}

/**
 * The runtime lowering, its console warnings read back as their codes.
 *
 * @param json - The sz object as JSON, so `__proto__` stays an own key.
 * @returns What it wrote and reported.
 */
function runtimeLane(json: string): LaneResult {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        return {
            className: transform(JSON.parse(json) as never).className,
            kinds: szReportedCodes(warnings),
        };
    } finally {
        console.warn = original;
    }
}

/**
 * One engine artifact, reading the same object as a JSX expression.
 *
 * @param engine - The artifact.
 * @param json - The sz object as JSON.
 * @returns What it wrote and reported.
 */
function engineLane(engine: (typeof ENGINES)[number][1], json: string): LaneResult {
    const run = captureWarnings(
        engine,
        `export const A = () => <p sz={${escapeUnsafeChars(json)}} />;`,
        '/p/src/Prototype.jsx',
    );
    return {
        className: run.className ?? '',
        kinds: (run.result.issues ?? []).map(issue => issue.code),
    };
}

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

/**
 * Every lane's answer for one object; the first engine is the reference.
 *
 * @param json - The sz object as JSON.
 * @returns The reference answer, every engine's and the runtime's.
 */
function everyLane(json: string): { expected: LaneResult; lanes: LaneResult[] } {
    const engines = ENGINES.map(([, engine]) => engineLane(engine, json));
    return { expected: engines[0] as LaneResult, lanes: [...engines, runtimeLane(json)] };
}

describe('a key named like an Object.prototype member', () => {
    const names = Object.getOwnPropertyNames(Object.prototype);
    const cases = (values: readonly string[]) =>
        names.flatMap(name => values.map(value => [name, value] as const));

    it.each(cases(['"inherit"', 'true', '4']))(
        '%s: %s lowers the same on every lane, as an unknown key',
        (name, value) => {
            const { expected, lanes } = everyLane(`{${JSON.stringify(name)}:${value}}`);

            expect(expected.className).not.toBe('');
            expect(expected.kinds).toContain('unknown-key');
            for (const lane of lanes) expect(lane).toEqual(expected);
        },
    );

    // An object under the key is read as a variant, which the engine does not
    // judge: the lanes agree on the class and report nothing.
    it.each(cases(['{"p":4}']))(
        '%s: %s lowers the same on every lane, as a variant',
        (name, value) => {
            const { expected, lanes } = everyLane(`{${JSON.stringify(name)}:${value}}`);

            expect(expected.className).toMatch(/:p-4$/);
            for (const lane of lanes) expect(lane).toEqual(expected);
        },
    );
});

describe.each([
    ['runtime', runtimeLane] as const,
    ...ENGINES.map(([name, engine]) => [name, (json: string) => engineLane(engine, json)] as const),
])('a value named like an Object.prototype member — %s', (_name, lower) => {
    // Read as any other word: `{ wrap: 'constructor' }` wrote the text of
    // `Object` into the class attribute. The same word behind a prefix is not
    // a member, so the two must lower alike once the prefix is taken out.
    it('lowers like the same word behind a prefix, on every key', () => {
        const names = Object.getOwnPropertyNames(Object.prototype).filter(
            name => name !== '__proto__',
        );
        const differs: string[] = [];
        for (const key of Object.keys(PROPERTY_MAP)) {
            for (const name of names) {
                const own = lower(`{${JSON.stringify(key)}:${JSON.stringify(name)}}`);
                const prefixed = JSON.stringify(`zq${name}`);
                const word = lower(`{${JSON.stringify(key)}:${prefixed}}`);
                const expected = { ...word, className: word.className.replace('zq', '') };
                if (JSON.stringify(own) !== JSON.stringify(expected)) {
                    differs.push(`${key}: ${name} -> ${own.className}`);
                }
            }
        }
        expect(differs).toEqual([]);
    }, 120_000);
});
