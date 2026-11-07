/**
 * A value wrapped in the brackets csszyx writes itself, on every lane.
 *
 * Both lanes took the brackets off and put them back, so `w: '[100px]'` wrote
 * `w-[100px]`, while `w: '[1/2]'` wrote `w-[1/2]`, `width: 1/2`, and
 * `m: '-[var(--v)]'` nested them. One spelling is supported, the value
 * without its brackets: a wrapped one writes nothing and `bracketed-value`
 * names the key and what to write. Grid line names are CSS's own brackets:
 * on `gridCols` and `gridRows` a value whose first bracket closes before its
 * end (`[a] 1fr [b]`) is lowered, and only one pair around the whole value
 * is the wrapping. On any other key brackets inside are no value csszyx can
 * write, and the help points to `css: {…}`.
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

/** One lane: an sz object in, its class and kinds out. */
type Lane = (sz: Record<string, unknown>) => LaneResult;

/**
 * The runtime lowering, its console warnings read back as their codes.
 *
 * @param sz - The sz object.
 * @returns What it wrote and reported.
 */
function runtimeLane(sz: Record<string, unknown>): LaneResult {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
        return { className: transform(sz as never).className, kinds: szReportedCodes(warnings) };
    } finally {
        console.warn = original;
    }
}

const LANES: ReadonlyArray<readonly [string, Lane]> = [
    ['runtime', runtimeLane],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Record<string, unknown>): LaneResult => {
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                        '/p/src/Bracketed.jsx',
                    );
                    return {
                        className: run.className ?? '',
                        kinds: (run.result.issues ?? []).map(issue => issue.code),
                    };
                },
            ] as const,
    ),
];

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('a value wrapped in brackets — %s', (_name, lower) => {
    it.each([
        [{ w: '[100px]' }],
        [{ w: '[1/2]' }],
        [{ top: '-[1px]' }],
        [{ m: '-[var(--v)]' }],
        [{ w: '[calc(100% - 2px)]' }],
        [{ hover: { w: '[10px]' } }],
        // One pair around a whole grid template, line names inside or not.
        [{ gridCols: '[1fr_2fr]' }],
        [{ gridCols: '[[a]_1fr_[b]]' }],
        // Brackets inside a value on a key whose CSS takes no line names.
        [{ p: '[a]_1_[b]' }],
        // Brackets that do not balance are no grid template, wrapped or not.
        [{ gridCols: '[[a]' }],
        [{ gridCols: '[a]]_[b]' }],
        [{ gridCols: '[a]_1fr_[b' }],
        [{ gridCols: 'a]_1fr_[b]' }],
        [{ gridRows: '[a]_1fr_[b]_[c' }],
        // A sign is no part of a grid template, whatever the brackets.
        [{ gridCols: '-[a]_1fr_[b]' }],
        [{ gridCols: '-[a]_1fr' }],
        [{ gridCols: '-[[a]_1fr]' }],
        [{ gridRows: '-[a]_auto_[b]!' }],
        // The important modifier sits outside the brackets.
        [{ w: '[10px]!' }],
        [{ top: '-[1px]!' }],
        // A closed-enum key names it once, as `bracketed-value`.
        [{ display: '[block]' }],
        // A variable in the parentheses csszyx writes itself (`bg-(--brand)`).
        [{ animate: '(--my-animation)' }],
        [{ bg: '(--brand)' }],
        [{ ease: '(--e)!' }],
        [{ display: '(--d)' }],
    ])('%j writes nothing and names the key', sz => {
        expect(lower(sz)).toEqual({ className: '', kinds: ['bracketed-value'] });
    });

    it.each([
        [{ gridCols: '[a] 1fr' }, 'grid-cols-[[a]_1fr]'],
        // Grid line names at both ends are CSS, not csszyx's brackets.
        [{ gridCols: '[a] 1fr [b]' }, 'grid-cols-[[a]_1fr_[b]]'],
        [{ gridCols: '[a]_1fr_[b]' }, 'grid-cols-[[a]_1fr_[b]]'],
        [{ gridRows: '[a]_auto' }, 'grid-rows-[[a]_auto]'],
        [
            {
                gridCols:
                    '[full-start] minmax(1rem, 1fr) [content-start] minmax(0, 60rem) [content-end] minmax(1rem, 1fr) [full-end]',
            },
            'grid-cols-[[full-start]_minmax(1rem,_1fr)_[content-start]_minmax(0,_60rem)_[content-end]_minmax(1rem,_1fr)_[full-end]]',
        ],
        [{ md: { gridCols: '[a]_1fr_[b]' } }, 'md:grid-cols-[[a]_1fr_[b]]'],
        [{ css: { gridTemplateColumns: '[a] 1fr [b]' } }, '[grid-template-columns:[a]_1fr_[b]]'],
        [{ w: '100px' }, 'w-[100px]'],
        [{ '--cols': '[a]' }, '[--cols:[a]]'],
        // A bracket that never closes wraps nothing.
        [{ content: '[x' }, 'content-[[x]'],
        // The variable as written, and parentheses that are a function's own.
        [{ animate: '--my-animation' }, 'animate-(--my-animation)'],
        [{ w: '--spacing(4)' }, 'w-[--spacing(4)]'],
        [{ '--a': '(--b)' }, '[--a:(--b)]'],
    ])('%j is not wrapped, so it writes %s', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: [] });
    });
});

describe.each(LANES)('a grid template written with underscores — %s', (_name, lower) => {
    // `_` is how a class spells a space, and only an arbitrary value reads it:
    // `grid-rows-1fr_2fr` is no utility Tailwind serves, `grid-rows-[1fr_2fr]`
    // is `grid-template-rows: 1fr 2fr`. A named value stays bare.
    it.each([
        [{ gridRows: '1fr_2fr' }, 'grid-rows-[1fr_2fr]'],
        [{ gridCols: '1fr_auto' }, 'grid-cols-[1fr_auto]'],
        [{ md: { gridCols: '200px_1fr' } }, 'md:grid-cols-[200px_1fr]'],
        [{ gridCols: 'auto_1fr' }, 'grid-cols-[auto_1fr]'],
        [{ gridCols: 'min-content_auto' }, 'grid-cols-[min-content_auto]'],
        [{ gridCols: 3 }, 'grid-cols-3'],
        [{ gridCols: 'subgrid' }, 'grid-cols-subgrid'],
        // A theme name holding `_` (`--grid-template-columns-main_layout`) is
        // served bare; bracketed it would be the declaration `main layout`.
        [{ gridCols: 'main_layout' }, 'grid-cols-main_layout'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: [] });
    });
});

describe.each(LANES)('the aliases of the grid keys — %s', (_name, lower) => {
    // An alias emits nothing and is reported to be renamed; its value takes
    // the canonical key's rule, so the rename is the only edit it is given.
    it('reports one pair around a whole grid template', () => {
        const { className, kinds } = lower({ gridTemplateColumns: '[[a]_1fr]' });
        expect(className).toBe('');
        expect(kinds).toContain('bracketed-value');
    });

    it('does not point grid line names to `css`', () => {
        const { className, kinds } = lower({ gridTemplateRows: '[a]_1fr_[b]' });
        expect(className).toBe('');
        expect(kinds).not.toContain('bracketed-value');
    });
});

describe.each(LANES)('a variable in parentheses on every key — %s', (_name, lower) => {
    // `animate: '(--x)'` wrote `animate-[(--x)]`, which Tailwind compiles to
    // `animation: (--x)`, a value no browser takes, while `bg` wrote
    // `bg-(--x)`. A variable is written bare (`--x`) on every key, and csszyx
    // writes the parentheses, as it writes the brackets of `[100px]`.
    it.each(Object.keys(PROPERTY_MAP).map(key => [key]))('%s', key => {
        expect(lower({ [key]: '(--x)' })).toEqual({ className: '', kinds: ['bracketed-value'] });
    });
});

/** One lane: an sz object in, the `help:` lines it printed out. */
type HelpLane = (sz: Record<string, unknown>) => string[];

/**
 * The `help:` lines among printed diagnostics.
 *
 * @param messages - The printed diagnostics.
 * @returns Each help line, trimmed.
 */
function helpLines(messages: readonly string[]): string[] {
    return messages.flatMap(message =>
        message
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('help:')),
    );
}

const HELP_LANES: ReadonlyArray<readonly [string, HelpLane]> = [
    [
        'runtime',
        sz => {
            const warnings: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
            try {
                transform(sz as never);
            } finally {
                console.warn = original;
            }
            return helpLines(warnings);
        },
    ],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Record<string, unknown>): string[] =>
                    helpLines(
                        captureWarnings(
                            engine,
                            `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                            '/p/src/Bracketed.jsx',
                        ).warnings,
                    ),
            ] as const,
    ),
];

describe.each(HELP_LANES)('what the help offers for a wrapped value — %s', (_name, help) => {
    // Taking off the first and last character is the fix only when they are
    // one pair of brackets around a value with none of its own.
    it.each([
        [{ w: '[100px]' }, "write `w: '100px'`"],
        [{ top: '-[1px]!' }, "write `top: '-1px!'`"],
        [{ animate: '(--spin)' }, "write `animate: '--spin'`"],
        // Around a whole grid template the inner value, line names and all.
        [{ gridCols: '[[a]_1fr_[b]]' }, "write `gridCols: '[a]_1fr_[b]'`"],
        [{ gridRows: '[[a]_1fr]' }, "write `gridRows: '[a]_1fr'`"],
    ])('%j: %s', (sz, expected) => {
        expect(help(sz)).toEqual([expect.stringContaining(expected)]);
    });

    // Brackets inside a value on a key whose CSS takes no line names: the
    // value goes in `css: { … }` or an arbitrary class.
    it.each([
        [{ p: '[a]_1_[b]' }],
        [{ w: '[[a]_1fr]' }],
        [{ gridCols: '[[a]' }],
        [{ gridCols: '[a]_1fr_[b' }],
        [{ gridCols: '-[a]_1fr_[b]' }],
        [{ gridCols: '-[[a]_1fr]' }],
    ])('%j points to `css` instead of a value it cannot write', sz => {
        const lines = help(sz);
        expect(lines).toHaveLength(1);
        expect(lines[0]).not.toContain('write `');
        expect(lines[0]).toContain('`css: { … }`');
        expect(lines[0]).toContain('`className`');
    });
});

describe.each(ENGINES)('the args of a bracketed value — %s', (_name, engine) => {
    /**
     * The args the engine reports for one `sz` object.
     *
     * @param sz - The sz object.
     * @returns The args of its `bracketed-value` issue.
     */
    const argsOf = (sz: Record<string, unknown>) =>
        captureWarnings(
            engine,
            `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
            '/p/src/Bracketed.jsx',
        ).result.issues?.find(issue => issue.code === 'bracketed-value')?.args;

    // `inner` stays a string on both forms, as the args type has it; it is a
    // value to write only when `form` is `unwrap`.
    it.each([
        [{ w: '[100px]' }, { form: 'unwrap', key: 'w', value: '[100px]', inner: '100px' }],
        [{ p: '[a]_1_[b]' }, { form: 'escape', key: 'p', value: '[a]_1_[b]', inner: 'a]_1_[b' }],
        [
            { gridCols: '[a]_1fr_[b' },
            { form: 'escape', key: 'gridCols', value: '[a]_1fr_[b', inner: '[a]_1fr_[b' },
        ],
    ])('%j reports %j', (sz, args) => {
        expect(argsOf(sz)).toEqual(args);
    });
});
