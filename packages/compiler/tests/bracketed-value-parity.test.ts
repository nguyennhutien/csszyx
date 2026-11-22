/**
 * A value wrapped in the brackets csszyx writes itself, on every lane.
 *
 * `'[…]'` is a second spelling of the arbitrary class (ADR 0037 §2): it writes
 * `key-[…]`, and when the value without its brackets writes the same class,
 * `redundant-bracket` names that spelling. A shape the brackets cannot carry
 * (`[1/2]`, `-[1px]`, `[length:13px]`) writes nothing, and `bracketed-value`
 * names the key and what to write. Grid line names are CSS's own brackets:
 * on `gridCols` and `gridRows` a value whose first bracket closes before its
 * end (`[a] 1fr [b]`) is lowered, and only one pair around the whole value
 * is the wrapping. On any other key brackets inside are no value csszyx can
 * write, and the help points to `css: {…}`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { PROPERTY_MAP } from '../src/sz-key-tables.js';
import {
    __resetSzWarnDedupForTests,
    GRID_TRACK_KEYWORDS,
    transform,
} from '../src/transform-core.js';
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
    // `'[…]'` is a second spelling of the arbitrary class (ADR 0037 §2): it
    // writes `key-[…]`, and when the value without its brackets writes the
    // same class, `redundant-bracket` names the spelling without them.
    it.each([
        [{ w: '[100px]' }, 'w-[100px]'],
        [{ w: '[calc(100% - 2px)]' }, 'w-[calc(100%_-_2px)]'],
        [{ hover: { w: '[10px]' } }, 'hover:w-[10px]'],
        [{ w: '[10px]!' }, 'w-[10px]!'],
        [{ top: '[-1px]' }, 'top-[-1px]'],
        [{ bg: '[#f00]' }, 'bg-[#f00]'],
        [{ leading: '[1.5]' }, 'leading-[1.5]'],
        [{ grow: '[2.5]' }, 'grow-[2.5]'],
        [{ content: '[x]' }, 'content-[x]'],
        // One pair around a whole grid template, line names inside or not.
        [{ gridCols: '[1fr_2fr]' }, 'grid-cols-[1fr_2fr]'],
        [{ gridCols: '[[a]_1fr_[b]]' }, 'grid-cols-[[a]_1fr_[b]]'],
        [{ gridCols: '[[a]]' }, 'grid-cols-[a]'],
    ])('%j writes %s and names the spelling without brackets', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: ['redundant-bracket'] });
    });

    // The class is the one the key's own lowering writes for the value
    // without brackets, type hint and all: `bg-[10px]` is a position, and
    // `border-[var(--x)]` a colour. A lone `var(--x)` is spelled `--x`.
    it.each([
        [{ bgSize: '[10px]' }, 'bg-[length:10px]'],
        [{ bgImg: '[var(--x)]' }, 'bg-(image:--x)'],
        [{ bgPos: '[var(--x)]' }, 'bg-(position:--x)'],
        [{ border: '[var(--x)]' }, 'border-(length:--x)'],
        [{ text: '[var(--x)]' }, 'text-(length:--x)'],
        [{ text: '[var(--x)]!' }, 'text-(length:--x)!'],
        [{ fontFamily: '[var(--x)]' }, 'font-(family-name:--x)'],
        [{ strokeWidth: '[var(--x)]' }, 'stroke-(length:--x)'],
        [{ decorationThickness: '[var(--x)]' }, 'decoration-(length:--x)'],
        [{ ring: '[var(--x)]' }, 'ring-(length:--x)'],
        [{ w: '[var(--x)]' }, 'w-(--x)'],
    ])('%j writes the class of its key, %s', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: ['redundant-bracket'] });
    });

    // A finding on the value without brackets is the finding: the brackets
    // do not hide it, and nothing else is said.
    it.each([
        [{ opacity: '[50]' }, 'opacity-[50]', ['clamped-factor']],
        [{ mask: '[linear-to-r]' }, '', ['moved-value']],
        [{ hover: { mask: '[radial]' } }, '', ['moved-value']],
    ])('%j writes %j and reports what its value without brackets does', (sz, className, kinds) => {
        expect(lower(sz)).toEqual({ className, kinds });
    });

    // The value without brackets written beside the bracketed one: its
    // finding stands for both, whichever a dedup set printed first. The
    // runtime prints a value's finding once, the engines once per site.
    it.each([
        [{ opacity: '50', hover: { opacity: '[50]' } }, 'opacity-[50] hover:opacity-[50]'],
        [{ mask: 'radial', hover: { mask: '[radial]' } }, ''],
    ])('%j does not name the brackets beside their own value', (sz, className) => {
        const { className: written, kinds } = lower(sz);
        expect(written).toBe(className);
        expect(new Set(kinds)).toEqual(new Set([written ? 'clamped-factor' : 'moved-value']));
    });

    // A value whose key writes a bare class says nothing for the trial: the
    // brackets are the only spelling of their class (`justify-[flex-start]`).
    it.each([
        [{ justify: '[flex-start]' }, 'justify-[flex-start]'],
        [{ items: '[flex-end]' }, 'items-[flex-end]'],
    ])('%j writes %s and names nothing', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: [] });
    });

    // Every pair around a grid template is taken off at once, however many.
    it('lowers a grid template wrapped in thousands of pairs once', () => {
        const depth = 3000;
        const value = `${'['.repeat(depth)}[a]_1fr${']'.repeat(depth)}`;
        expect(lower({ gridCols: value })).toEqual({
            className: 'grid-cols-[[a]_1fr]',
            kinds: ['redundant-bracket'],
        });
    });

    // A class in brackets with a modifier after it is written as given and,
    // on a colour key, reported as the slash opacity it is (ADR 0037 §8).
    it.each([
        [{ bg: '[#f00]/50' }, 'bg-[#f00]/50'],
        [{ bg: '[#f00]/50!' }, 'bg-[#f00]/50!'],
    ])('%j writes %s and reports the slash', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: ['slash-opacity-string'] });
    });

    // The value without its brackets writes another class, so the brackets
    // are the only spelling of this one.
    it.each([
        [{ p: '[4]' }, 'p-[4]'],
        [{ grow: '[2]' }, 'grow-[2]'],
        [{ z: '[5]' }, 'z-[5]'],
        [{ md: { p: '[4]!' } }, 'md:p-[4]!'],
        // No type hint: a name with a capital before the `:`. No fraction:
        // a part that is not digits.
        [{ w: '[aB:1]' }, 'w-[aB:1]'],
        [{ w: '[a/b]' }, 'w-[a/b]'],
        [{ w: '[1/x]' }, 'w-[1/x]'],
        // Known: an invalid declaration (`background-color: repeat-x`),
        // left to the CSS grammar gate (TASK-13.20).
        [{ bgRepeat: '[repeat-x]' }, 'bg-[repeat-x]'],
    ])('%j writes %s', (sz, className) => {
        expect(lower(sz)).toEqual({ className, kinds: [] });
    });

    it.each([
        [{ w: '[1/2]' }],
        [{ top: '-[1px]' }],
        [{ m: '-[var(--v)]' }],
        // A variable is `'--x'`; a type hint or a property is no value.
        [{ w: '[--x]' }],
        [{ w: '[length:13px]' }],
        [{ text: '[color:red]' }],
        [{ text: '[color:--x]' }],
        [{ text: '[color:var(--x)]' }],
        [{ w: '[]' }],
        // A bracket at one end only, or the modifier before the value.
        [{ w: '[10px' }],
        [{ w: '10px]' }],
        [{ w: '![10px]' }],
        [{ content: '[x' }],
        // A key with no arbitrary utility.
        [{ srOnly: '[x]' }],
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
        [{ top: '-[1px]!' }],
        // A closed-enum key names it once, as `bracketed-value`.
        [{ display: '[block]' }],
        // A variable in the parentheses csszyx writes itself (`bg-(--brand)`).
        [{ animate: '(--my-animation)' }],
        [{ bg: '(--brand)' }],
        [{ ease: '(--e)!' }],
        [{ display: '(--d)' }],
        // Brackets around a value that is itself bracketed and writes nothing:
        // the build names it as the runtime does.
        [{ w: '[(--x)]' }],
        [{ gridCols: '[[]]' }],
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
        // A bracket inside a value, at neither end.
        [{ content: "'[x'" }, "content-['[x']"],
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

    // Each track keyword alone decides the value, so a keyword one lane's
    // table drops leaves that lane writing the bare class.
    it.each([...GRID_TRACK_KEYWORDS])('brackets a template whose only track is `%s`', keyword => {
        expect(lower({ gridCols: `main_${keyword}` })).toEqual({
            className: `grid-cols-[main_${keyword}]`,
            kinds: [],
        });
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

describe('a bracketed value on every key, every lane alike', () => {
    // Whether a key writes `key-[…]` or nothing, and whether its spelling
    // without brackets writes the same class, is decided on each lane; one
    // value per shape walks every key so a key one lane reads apart shows.
    // `[a b]`, not `[a_b]`: `bgPos: 'a_b'` is lowered apart already (TASK-13.44).
    const values = ['[10px]', '[4]', '[red]', '[10px]!', '[a b]'];
    it.each(Object.keys(PROPERTY_MAP).flatMap(key => values.map(value => [key, value])))(
        '%s: %s',
        (key, value) => {
            const results = LANES.map(([, lower]) => {
                __resetSzWarnDedupForTests();
                return lower({ [key]: value });
            });
            for (const result of results.slice(1)) expect(result).toEqual(results[0]);
        },
    );
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
        // `grow: '2.5'` writes `grow-[2.5]` since ADR 0037 §1 (TASK-13.19).
        [{ grow: '[2.5]' }, "write `grow: '2.5'`"],
        // A type hint is dropped: the key already says what the value is.
        [{ text: '[length:13px]' }, "write `text: '13px'`"],
        [{ text: '[length:var(--x)]' }, "write `text: '--x'`"],
        // The hint is read off the class's own brackets, not a `:` inside.
        [{ bgImg: '[image:url(a:b)]' }, "write `bgImg: 'url(a:b)'`"],
        [{ bgSize: '[length:10px]' }, "write `bgSize: '10px'`"],
        [{ border: '[var(--x)]' }, "write `border: '--x'`"],
        [{ w: '![10px]' }, "write `w: '10px!'`"],
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
        [{ w: '[10px' }],
        [{ w: '10px]' }],
        // A type hint the key does not write for the value without it.
        [{ text: '[color:--x]' }],
        [{ text: '[color:var(--x)]' }],
        [{ text: '[color:red]' }],
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
        [{ w: '[1/2]' }, { form: 'unwrap', key: 'w', value: '[1/2]', inner: '1/2' }],
        [
            { w: '[length:13px]' },
            { form: 'unwrap', key: 'w', value: '[length:13px]', inner: '13px' },
        ],
        [{ w: '![10px]' }, { form: 'unwrap', key: 'w', value: '![10px]', inner: '10px!' }],
        [
            { leading: '[line-height:2]' },
            { form: 'unwrap', key: 'leading', value: '[line-height:2]', inner: '2' },
        ],
        [{ w: '[10px' }, { form: 'escape', key: 'w', value: '[10px', inner: '[10px' }],
        [
            { text: '[color:--x]' },
            { form: 'type-hint', key: 'text', value: '[color:--x]', inner: '--x' },
        ],
        [{ p: '[a]_1_[b]' }, { form: 'escape', key: 'p', value: '[a]_1_[b]', inner: 'a]_1_[b' }],
        [
            { gridCols: '[a]_1fr_[b' },
            { form: 'escape', key: 'gridCols', value: '[a]_1fr_[b', inner: '[a]_1fr_[b' },
        ],
    ])('%j reports %j', (sz, args) => {
        expect(argsOf(sz)).toEqual(args);
    });

    // A spelling the class does not need is its own id, with no form.
    it.each([
        [{ w: '[100px]' }, { key: 'w', value: '[100px]', inner: '100px' }],
        [{ w: '[10px]!' }, { key: 'w', value: '[10px]!', inner: '10px!' }],
        [{ gridRows: '[[a]_1fr]' }, { key: 'gridRows', value: '[[a]_1fr]', inner: '[a]_1fr' }],
        [{ gridRows: '[[[[a]]]]' }, { key: 'gridRows', value: '[[[[a]]]]', inner: '[a]' }],
        // A trial that reaches brackets again names the value as written.
        [{ gridCols: '[[a]]' }, { key: 'gridCols', value: '[[a]]', inner: '[a]' }],
        [{ border: '[var(--x)]' }, { key: 'border', value: '[var(--x)]', inner: '--x' }],
    ])('%j reports `redundant-bracket` %j', (sz, args) => {
        const issues = captureWarnings(
            engine,
            `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
            '/p/src/Bracketed.jsx',
        ).result.issues;
        expect(issues?.map(issue => issue.code)).toEqual(['redundant-bracket']);
        expect(issues?.[0]?.args).toEqual(args);
    });
});

describe('the runtime lane in every mode', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // The class does not wait on a warning: production writes it, and says
    // nothing a development build would.
    it('writes the class in production and prints nothing', () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(runtimeLane({ w: '[100px]' })).toEqual({ className: 'w-[100px]', kinds: [] });
        expect(runtimeLane({ bgSize: '[10px]' })).toEqual({
            className: 'bg-[length:10px]',
            kinds: [],
        });
        expect(runtimeLane({ w: '[1/2]' })).toEqual({ className: '', kinds: [] });
    });

    // Missing output is said in every mode (ADR 0011), as for the value
    // without brackets.
    it('prints in production what a value that writes nothing prints', () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(runtimeLane({ mask: '[radial]' })).toEqual({
            className: '',
            kinds: ['moved-value'],
        });
        expect(runtimeLane({ mask: '[linear]' }).kinds).toEqual(['moved-value']);
    });

    it('takes no dedup slot of the value without brackets', () => {
        runtimeLane({ justify: '[flex-start]' });
        expect(runtimeLane({ justify: 'flex-start' }).kinds).toEqual(['closed-enum-value']);
    });

    it('names a value once, however often and wherever it is written', () => {
        expect(runtimeLane({ w: '[10px]', hover: { w: '[10px]' } })).toEqual({
            className: 'w-[10px] hover:w-[10px]',
            kinds: ['redundant-bracket'],
        });
        expect(runtimeLane({ w: '[10px]' }).kinds).toEqual([]);
        expect(runtimeLane({ text: '[color:--x]', md: { text: '[color:--x]' } }).kinds).toEqual([
            'bracketed-value',
        ]);
    });

    it('is muted by CSSZYX_QUIET_SZ_WARNINGS, and still writes the class', () => {
        vi.stubEnv('CSSZYX_QUIET_SZ_WARNINGS', '1');
        expect(runtimeLane({ w: '[10px]', opacity: '[50]', mask: '[radial]' })).toEqual({
            className: 'w-[10px] opacity-[50]',
            kinds: [],
        });
    });

    it('prints the words of redundant-bracket with what to write', () => {
        const warnings: string[] = [];
        const original = console.warn;
        console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
        try {
            transform({ border: '[var(--x)]' });
        } finally {
            console.warn = original;
        }
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(
            "`border: '[var(--x)]'` writes the class that `border: '--x'` writes; csszyx adds the brackets itself.",
        );
        expect(warnings[0]).toContain("help: write `border: '--x'`.");
    });
});
