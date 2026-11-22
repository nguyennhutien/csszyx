/**
 * The help of a slash-opacity report is code that works.
 *
 * `slash-opacity-string` and `color-slash-opacity` are errors, and their help
 * is the object form to write instead. Following it must lower with no report
 * at all on every lane: an `op` the object form does not take, a lost `!`, or
 * a literal that is not JavaScript turns the fix into a second finding or a
 * silent loss. For a theme colour, where the slash was served, the object
 * form also writes the same class, or one Tailwind serves with the same
 * opacity.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { modifierOp, slashOpacitySplit } from '../src/color-modifier.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** One sz object. */
type Sz = Record<string, unknown>;

/** What a lane wrote, and every line it printed. */
interface Lowered {
    className: string;
    lines: string[];
}

/**
 * The runtime lowering and its printed lines.
 *
 * @param sz - The sz object.
 * @returns The class and the lines.
 */
function runtime(sz: Sz): Lowered {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    try {
        return { className: transform(sz as never).className, lines };
    } finally {
        console.warn = original;
    }
}

const LANES: ReadonlyArray<readonly [string, (sz: Sz) => Lowered]> = [
    ['runtime', runtime],
    ...ENGINES.map(
        ([name, engine]) =>
            [
                name,
                (sz: Sz): Lowered => {
                    const run = captureWarnings(
                        engine,
                        `export const A = () => <p sz={${escapeUnsafeChars(JSON.stringify(sz))}} />;`,
                        '/p/src/Help.jsx',
                    );
                    return { className: run.className ?? '', lines: run.warnings };
                },
            ] as const,
    ),
];

/**
 * The object a report's help says to write.
 *
 * @param lines - What the lane printed.
 * @returns The object, evaluated as the JavaScript it is written as.
 */
function helpObject(lines: readonly string[]): Sz {
    const help = /help: write `(\{.*\})`\./.exec(lines.join('\n'));
    expect(help, lines.join('\n')).not.toBeNull();
    return new Function(`return (${help?.[1]});`)() as Sz;
}

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('the help of a slash report — %s', (_name, lower) => {
    it.each([
        // key, value as written, the class the help's object writes
        ['bg', 'red-500/50', 'bg-red-500/50'],
        ['bg', 'red-500/50!', 'bg-red-500/50!'],
        ['bg', 'red-500/[50%]', 'bg-red-500/[50%]'],
        ['bg', 'red-500/[0.5]', 'bg-red-500/50'],
        ['bg', 'red-500/[0.333]', 'bg-red-500/[33.3%]'],
        ['bg', 'red-500/(--o)', 'bg-red-500/(--o)'],
        ['bg', 'red-500/50%', 'bg-red-500/[50%]'],
        ['bg', '#f00/50', 'bg-[#f00]/50'],
        ['bg', 'rgb(255 0 0)/50!', 'bg-[rgb(255_0_0)]/50!'],
        ['bg', '--c/(--o)', 'bg-(--c)/(--o)'],
    ])('%s: %j — the help lowers clean as %s', (key, value, fixed) => {
        const help = helpObject(lower({ [key]: value }).lines);
        const after = lower({ [key]: help });

        expect(after).toEqual({ className: fixed, lines: [] });
    });

    it.each([
        // key, colour object as written, the class the help's object writes
        ['bg', { color: 'red-500/50%' }, 'bg-red-500/[50%]'],
        ['bg', { color: 'red-500/(--o)' }, 'bg-red-500/(--o)'],
        ['bg', { color: 'red-500/50!' }, 'bg-red-500/50!'],
        ['bg', { color: 'red-500/[0.5]', op: 30 }, 'bg-red-500/30'],
        ['ring', { color: 'red-500/50' }, 'ring-red-500/50'],
        ['border', { color: '#f00/50' }, 'border-[#f00]/50'],
        ['shadow', { color: 'red-500/50' }, 'shadow-red-500/50'],
        ['outline', { color: 'red-500/50' }, 'outline-red-500/50'],
        ['textShadow', { color: 'red-500/50' }, 'text-shadow-red-500/50'],
    ])('%s: %j — the help lowers clean as %s', (key, color, fixed) => {
        const help = helpObject(lower({ [key]: color }).lines);
        const after = lower({ [key]: help });

        expect(after).toEqual({ className: fixed, lines: [] });
    });
});

describe('the op a modifier names', () => {
    // The same table as `a_modifier_names_the_op_tailwind_reads_it_as` in
    // `lower.rs`, so both lanes read a modifier alike.
    it.each<[string, number | string | undefined]>([
        ['50', 50],
        ['0.5', 0.5],
        ['.5', 0.5],
        ['[0.5]', 50],
        ['[0.05]', 5],
        ['[1]', 100],
        ['[50%]', '50%'],
        ['(--o)', '--o'],
        ['()', ''],
        ['[2]', undefined],
        ['[]', undefined],
        ['[x]', undefined],
        ['[', undefined],
        ['(', undefined],
        ['(5', undefined],
        ['5)', undefined],
        ['[0.5', undefined],
        ['0.5]', undefined],
        ['.', undefined],
        ['1.2.3', undefined],
        ['50%', undefined],
        ['--o', undefined],
    ])('%s is %j', (modifier, op) => {
        expect(modifierOp(modifier)).toBe(op);
    });

    it.each([
        'linear-to-r/oklch',
        '-linear-45/srgb',
        'radial/oklch',
        'conic-180/decreasing',
        'gradient-to-b/oklch',
        '1/2',
        '4/2.5',
        'red-500/',
        '/50',
        'rgb(255_0_0/50%)',
    ])('does not split %s', value => {
        expect(slashOpacitySplit(value)).toBeUndefined();
    });
});
