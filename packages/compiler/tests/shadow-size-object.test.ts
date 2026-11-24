/**
 * A shadow's size and opacity as one object: `{ size, op }`.
 *
 * `shadow-sm/50` scales the theme shadow's alpha, which `shadowColor` does not
 * do: it replaces the colour. Its only spelling was the string `'sm/50'`, the
 * one slash on a key that a colour object did not replace. `{ size, op }` takes
 * the colour object's place on the four shadow keys and goes through the same
 * `op` formatter, on every lane.
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
        // A slash in the size is the string's slash: the opacity goes in `op`.
        [{ shadow: { size: 'sm/50', op: 20 } }, 'shadow-sm/50/20', 'slash-opacity-string'],
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

    it('notes that op does not reach a shadow held in a variable', () => {
        expect(lower({ shadow: { size: '--s', op: 50 } })).toMatchObject({
            className: 'shadow-(--s)/50',
            ids: ['variable-shadow-opacity'],
        });
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
    ])('%j keeps %s, reports the slash, and its help lowers clean', (sz, className) => {
        const run = lower(sz);
        expect(run).toMatchObject({ className, ids: ['slash-opacity-string'] });
        const [key] = Object.keys(sz);
        const after = lower({ [key as string]: helpObject(run.lines) });
        expect(after).toMatchObject({ className, ids: [] });
    });
});
