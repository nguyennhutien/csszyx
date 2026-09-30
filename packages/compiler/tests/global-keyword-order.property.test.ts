/**
 * A stand-alone keyword and its groups, in every order, against a model.
 *
 * `font-variant-numeric`, `touch-action` and `contain` each have a keyword
 * that stands alone and groups that combine. In one object the later key
 * wins: the stand-alone keyword resets the groups written before it, and the
 * groups written after it combine and replace it. The model below says that
 * and nothing else; every ordering of every subset of up to four keys of each
 * family is lowered on both engine artifacts and the runtime and compared.
 *
 * The invariant that makes the result independent of Tailwind's own sort —
 * `normal-nums` last, `touch-none` and `contain-strict` first — is checked
 * too: the stand-alone class and a group class are never emitted together.
 */
import { describe, expect, it, vi } from 'vitest';

import { transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

interface Family {
    readonly global: readonly [string, string, string];
    readonly groups: ReadonlyArray<readonly [string, string | boolean, string]>;
}

const FAMILIES: Readonly<Record<string, Family>> = {
    nums: {
        global: ['nums', 'normal', 'normal-nums'],
        groups: [
            ['numSpacing', 'tabular', 'tabular-nums'],
            ['numFigure', 'oldstyle', 'oldstyle-nums'],
            ['numFraction', 'stacked', 'stacked-fractions'],
            ['numSlashedZero', true, 'slashed-zero'],
        ],
    },
    touch: {
        global: ['touch', 'none', 'touch-none'],
        groups: [
            ['touchPanX', 'left', 'touch-pan-left'],
            ['touchPanY', 'down', 'touch-pan-down'],
            ['touchPinchZoom', true, 'touch-pinch-zoom'],
        ],
    },
    contain: {
        global: ['contain', 'strict', 'contain-strict'],
        groups: [
            ['containSize', 'inline-size', 'contain-inline-size'],
            ['containLayout', true, 'contain-layout'],
            ['containPaint', true, 'contain-paint'],
            ['containStyle', true, 'contain-style'],
        ],
    },
};

/**
 * Every ordering of every subset of `items` with 1..`max` members.
 * @param items - The keys to order.
 * @param max - The largest subset.
 * @returns Each ordering, as a list of keys.
 */
function orderings<T>(items: readonly T[], max: number): T[][] {
    const out: T[][] = [];
    const walk = (prefix: T[], rest: readonly T[]) => {
        if (prefix.length > 0) out.push(prefix);
        if (prefix.length === max) return;
        rest.forEach((item, index) => {
            walk([...prefix, item], [...rest.slice(0, index), ...rest.slice(index + 1)]);
        });
    };
    walk([], items);
    return out;
}

/**
 * The model: apply the keys in order; the global resets, a group replaces it.
 * @param family - The property's stand-alone key and groups.
 * @param keys - The keys, in the order the object holds them.
 * @returns The classes the object means, sorted.
 */
function expected(family: Family, keys: readonly string[]): string[] {
    const groups = new Map(family.groups.map(([key, , className]) => [key, className]));
    let global = false;
    const set = new Set<string>();
    for (const key of keys) {
        if (key === family.global[0]) {
            global = true;
            set.clear();
        } else {
            global = false;
            set.add(groups.get(key) as string);
        }
    }
    return global ? [family.global[2]] : [...set].sort();
}

const CASES = Object.entries(FAMILIES).flatMap(([name, family]) => {
    const all = [family.global[0], ...family.groups.map(([key]) => key)];
    const values = new Map<string, unknown>([
        [family.global[0], family.global[1]],
        ...family.groups.map(([key, value]) => [key, value] as const),
    ]);
    return orderings(all, 4).map(keys => ({
        name,
        family,
        sz: Object.fromEntries(keys.map(key => [key, values.get(key)])),
        want: expected(family, keys),
    }));
});

describe('a stand-alone keyword and its groups, every order', () => {
    it('covers every ordering of up to four keys of each family', () => {
        expect(CASES).toHaveLength(205 + 64 + 205);
    });

    it('runtime follows the model', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const wrong = CASES.filter(
            ({ sz, want }) =>
                (transform(sz).className || '').split(' ').filter(Boolean).sort().join(' ') !==
                want.join(' '),
        ).map(({ sz }) => JSON.stringify(sz));
        vi.restoreAllMocks();

        expect(wrong).toEqual([]);
    });

    it.each(ENGINES)('%s follows the model and never emits both', (_name, engine) => {
        const wrong: string[] = [];
        for (const { family, sz, want } of CASES) {
            const run = captureWarnings(
                engine,
                `export const A = () => <p sz={${JSON.stringify(sz)}} />;`,
            );
            const classes = [...(run.result.classes ?? [])].sort();
            const both =
                classes.includes(family.global[2]) &&
                family.groups.some(([, , className]) => classes.includes(className));
            if (both || classes.join(' ') !== want.join(' ') || run.warnings.length > 0) {
                wrong.push(`${JSON.stringify(sz)} → ${classes.join(' ')}`);
            }
        }

        expect(wrong).toEqual([]);
    });
});
