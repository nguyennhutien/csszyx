/**
 * A shadow's size and opacity as one object: `{ size, op }`.
 *
 * `shadow-sm/50` sets the shadow's alpha to 50%, where the theme's shadows
 * use 5% to 25%; the shadow's colour is its own lane, `shadowColor`. The
 * alpha's only spelling was the string `'sm/50'`. `{ size, op }` takes it on
 * the four shadow keys through the colour object's `op` formatter, on every
 * lane.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeUnsafeChars } from '../../core/tests/helpers/sz-fuzz.js';
import { __resetSzWarnDedupForTests, transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

/** One sz object. */
type Sz = Record<string, unknown>;

/** What a lane wrote, and the diagnostic ids it printed. */
interface Lowered {
    className: string;
    ids: string[];
    lines: string[];
}

/**
 * The diagnostic ids in printed lines, in order.
 *
 * @param lines - What a lane printed.
 * @returns Each `[csszyx] <id>` the lines name.
 */
function ids(lines: readonly string[]): string[] {
    return lines.flatMap(line =>
        [...line.matchAll(/\[csszyx\] ([a-z-]+)/g)].map(match => match[1] ?? ''),
    );
}

/**
 * The runtime lowering and its printed lines.
 *
 * @param sz - The sz object.
 * @returns The class, ids and lines.
 */
function runtime(sz: Sz): Lowered {
    __resetSzWarnDedupForTests();
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    try {
        const className = transform(sz as never).className;
        return { className, ids: ids(lines).filter(id => id !== 'dev-warnings-partial'), lines };
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
                        '/p/src/Shadow.jsx',
                    );
                    return {
                        className: run.className ?? '',
                        ids: ids(run.warnings).filter(id => id !== 'dev-warnings-partial'),
                        lines: run.warnings,
                    };
                },
            ] as const,
    ),
];

/**
 * The key and object a report's help says to write.
 *
 * @param lines - What the lane printed.
 * @param key - The key the report was on, when the help names none.
 * @returns The sz object the help writes, evaluated as the JavaScript it is.
 */
function helpObject(lines: readonly string[], key: string): Sz {
    const help = /help: write `(?:(\w+): )?(\{.*?\})`[.;]/.exec(lines.join('\n'));
    expect(help, lines.join('\n')).not.toBeNull();
    return { [help?.[1] ?? key]: new Function(`return (${help?.[2]});`)() };
}

beforeEach(() => {
    __resetSzWarnDedupForTests();
});

describe.each(LANES)('a shadow size object — %s', (_name, lower) => {
    it.each<[Sz, string]>([
        [{ shadow: { size: 'sm', op: 50 } }, 'shadow-sm/50'],
        [{ textShadow: { size: 'sm', op: 50 } }, 'text-shadow-sm/50'],
        [{ dropShadow: { size: 'md', op: 25 } }, 'drop-shadow-md/25'],
        [{ insetShadow: { size: 'xs', op: '50%' } }, 'inset-shadow-xs/[50%]'],
        [{ shadow: { size: '[0_1px_2px_black]', op: 50 } }, 'shadow-[0_1px_2px_black]/50'],
        [{ shadow: { size: 'sm!', op: 50 } }, 'shadow-sm/50!'],
        [{ shadow: { size: 'sm', op: '--o' } }, 'shadow-sm/(--o)'],
        [{ shadow: { size: 'sm', op: 12.499 } }, 'shadow-sm/[12.499%]'],
        [{ shadow: { size: 'sm' } }, 'shadow-sm'],
        [{ hover: { shadow: { size: 'sm', op: 50 } } }, 'hover:shadow-sm/50'],
        // The colour object on a shadow key is unchanged.
        [{ shadow: { color: 'red-500', op: 50 } }, 'shadow-red-500/50'],
    ])('%j writes %s and reports nothing', (sz, className) => {
        expect(lower(sz)).toMatchObject({ className, ids: [] });
    });

    it.each<[Sz, string, string]>([
        // The size is reported as the same value on the key would be.
        [{ shadow: { size: '[a', op: 50 }, p: 4 }, 'p-4', 'bracketed-value'],
        [{ shadow: { size: '[1/2]', op: 50 } }, '', 'bracketed-value'],
        [{ hover: { textShadow: { size: '[a', op: 50 } } }, '', 'bracketed-value'],
        // A slash in the size is reported as a colour's is, and `op` is kept.
        [{ shadow: { size: 'sm/50', op: 20 } }, 'shadow-sm/50/20', 'color-slash-opacity'],
        [{ dropShadow: { size: 'md/50' } }, 'drop-shadow-md/50', 'color-slash-opacity'],
    ])('%j writes %j and reports the size as %s', (sz, className, id) => {
        expect(lower(sz)).toMatchObject({ className, ids: [id] });
    });

    it('reports an op that is no opacity and writes the size alone', () => {
        expect(lower({ shadow: { size: 'sm', op: 150 } })).toMatchObject({
            className: 'shadow-sm',
            ids: ['opacity-value'],
        });
    });

    it('reports a member a size object does not read', () => {
        const run = lower({ shadow: { size: 'sm', width: 2 } });
        expect(run).toMatchObject({ className: 'shadow-sm', ids: ['unknown-field'] });
        expect(run.lines.join('\n')).toContain('`shadow` takes `{ size, op }`');
    });

    it.each<[Sz, string]>([
        [{ shadow: { size: '--s', op: 50 } }, 'shadow-(--s)/50'],
        [{ shadow: { size: 'var(--s)', op: 50 } }, 'shadow-[var(--s)]/50'],
    ])('notes that op does not reach a shadow held in a variable: %j', (sz, className) => {
        expect(lower(sz)).toMatchObject({ className, ids: ['variable-shadow-opacity'] });
    });

    it('reports an op with no size, as on any key', () => {
        const run = lower({ shadow: { op: 50 } });
        expect(run.ids).toContain('property-object');
        expect(run.lines.join('\n')).toContain("`{ size: '…', op: … }` on a shadow key");
    });

    it.each<[Sz, string]>([
        // A size with a slash opacity: the object form is `{ size, op }`.
        [{ shadow: 'sm/50' }, 'shadow-sm/50'],
        [{ textShadow: 'lg/25!' }, 'text-shadow-lg/25!'],
        // A colour with one: the colour object, as on any colour key.
        [{ shadow: 'red-500/50' }, 'shadow-red-500/50'],
        // One token in brackets is a colour, as Tailwind reads `shadow-[#f00]`.
        [{ shadow: '[#f00]/50' }, 'shadow-[#f00]/50'],
        [{ shadow: '[0_1px_red]/50' }, 'shadow-[0_1px_red]/50'],
        // A variable typed as a colour is a colour too.
        [{ shadow: '(color:--c)/50' }, 'shadow-(color:--c)/50'],
    ])('%j keeps %s, reports the slash, and its help lowers clean', (sz, className) => {
        const run = lower(sz);
        expect(run).toMatchObject({ className, ids: ['slash-opacity-string'] });
        const [key] = Object.keys(sz);
        const after = lower(helpObject(run.lines, key as string));
        expect(after).toMatchObject({ className, ids: [] });
    });

    it.each<[string, string]>([
        // A bracket that starts with a colour is a colour, as Tailwind reads it.
        ['[rgb(255_0_0)]/50', 'shadowColor: {'],
        ['[color-mix(in_srgb,red_50%,blue)]/50', 'shadowColor: {'],
        ['[rgb(255_0_0)_0_1px]/50', 'shadowColor: {'],
        // A shadow's parts, or a variable, are the shadow.
        ['[inset_0_1px_rgb(0_0_0)]/50', "{ size: '[inset_0_1px_rgb(0_0_0)]'"],
        ['[var(--s)]/50', "{ size: '[var(--s)]'"],
    ])('a slash string %s is helped as %s', (value, help) => {
        const run = lower({ shadow: value });
        expect(run.ids).toEqual(['slash-opacity-string']);
        expect(run.lines.join('\n')).toContain(`help: write \`${help}`);
    });
});
