/**
 * Every class Tailwind serves either stays in `className` or migrates to an sz
 * value whose class has the same CSS.
 *
 * For each migrate prefix × value shape × sign, the class goes to the
 * installed Tailwind. A class it serves goes to migrate; when migrate takes it,
 * the sz object is lowered on both engine artifacts, which must write the same
 * classes, and the CSS Tailwind emits for those classes must declare what the
 * original declared. A misread migration is silent: it compiles, emits a
 * class, and styles something else — `-m-(--v)` read as `m: '---v'` sets a
 * margin from a property nobody defines. Comparing classes alone would also
 * fail the correct answers that change the spelling (`-m-[10px]` becomes
 * `m-[-10px]`), so the comparison is on the declarations.
 *
 * Two declarations count as equal when one is a sound rewrite of the other:
 * the selector differs by construction, `calc(10px * -1)` is `-10px`, a sign
 * on zero is no sign, `calc(var(--spacing) * 1)` is `var(--spacing)`. Each
 * rewrite is listed in `normalise`; nothing else is forgiven.
 *
 * The classes go to Tailwind in one batch, so the suite runs in about a
 * second.
 */
import path from 'node:path';

import { migrateRustClassName } from '@csszyx/compiler/migrate';
import { createEmittedClassOracle } from '@csszyx/tailwind-oracle';
import { describe, expect, it } from 'vitest';

import { SORTED_PREFIXES } from '../../compiler/src/migrate-tables/reverse-map.js';
import { ENGINES, type ParityEngine } from '../../compiler/tests/engine-parity-harness.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/**
 * The value shapes every prefix is given. Each names the reading it probes:
 * numbers and steps, fractions bare and bracketed, keywords, arbitrary values
 * plain, signed-in-bracket, `var()` and `calc()`, and custom properties bare,
 * with a fallback, and with a type hint.
 */
const VALUES = [
    '0',
    '1',
    '4',
    '10',
    '0.5',
    '1.5',
    'px',
    'auto',
    'full',
    'none',
    'screen',
    'sm',
    'lg',
    'inherit',
    'red-500',
    'red-500/50',
    '1/2',
    '2/50',
    '[1/2]',
    '[10px]',
    '[-5px]',
    '[var(--v)]',
    '[var(--v,1px)]',
    '[calc(1px_+_2px)]',
    '(--v)',
    '(--v,1px)',
    '(length:--v)',
    '(family-name:--v)',
] as const;

/** Each class unsigned, signed, and signed under a variant. */
const FORMS = ['', '-', 'hover:-'] as const;

/**
 * The declarations of a rule, with every rewrite this suite accepts as equal
 * applied: the selector, a literal times -1, a sign on zero, a spacing step
 * of one, and the spacing around a fraction's slash.
 *
 * @param css - What Tailwind emitted for one class.
 * @returns Its lines, rewritten.
 */
function normalise(css: string): string[] {
    return css
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
            const trimmed = line.trim();
            if (trimmed.endsWith('{') && !trimmed.startsWith('@')) {
                return `${line.slice(0, line.length - line.trimStart().length)}& {`;
            }
            return line
                .replace(/\* -0\)/g, '* 0)')
                .replace(/calc\(var\(--spacing\) \* 0\)/g, '0px')
                .replace(/calc\(var\(--spacing\) \* 1\)/g, 'var(--spacing)')
                .replace(/(\d) ?\/ ?(\d)/g, '$1 / $2')
                .replace(/calc\((\d+(?:\.\d+)?|\.\d+)([a-z%]*) \* -1\)/g, (_, magnitude, unit) =>
                    Number(magnitude) === 0 ? `0${unit}` : `-${magnitude}${unit}`,
                );
        });
}

/**
 * The class one engine writes for an sz object.
 *
 * @param engine - The artifact.
 * @param sz - The migrated object.
 * @returns Its `className`, empty when it wrote none.
 */
function lowered(engine: ParityEngine, sz: unknown): string {
    const result = engine(`export const A = () => <p sz={${JSON.stringify(sz)}} />;`, '/p/A.jsx');
    return /className="([^"]*)"/.exec(result.code ?? '')?.[1] ?? '';
}

describe('a migrated class keeps its CSS', async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got: ${oracle.reason}`);

    const classes = SORTED_PREFIXES.flatMap(prefix =>
        FORMS.flatMap(form => VALUES.map(value => `${form}${prefix}-${value}`)),
    );
    const dead = new Set(oracle.findDead(classes));
    const served = classes.filter(className => !dead.has(className));
    const migrated = served.flatMap(className => {
        const { szObject, unrecognized, keepInClassName } = migrateRustClassName(className);
        const refused =
            unrecognized.length > 0 ||
            keepInClassName.length > 0 ||
            Object.keys(szObject).length === 0;
        if (refused) return [];
        const lanes = ENGINES.map(([, engine]) => lowered(engine, szObject));
        return [{ className, szObject, lanes }];
    });
    const written = [
        ...new Set(migrated.flatMap(({ lanes }) => lanes.flatMap(lane => lane.split(' ')))),
    ].filter(Boolean);
    const all = [...new Set([...served, ...written])];
    const answers = oracle.cssFor(all);
    const css = new Map(all.map((className, index) => [className, answers[index]] as const));

    /**
     * The declarations a set of classes makes, or null when one makes none.
     *
     * @param tokens - Classes.
     * @returns Their rewritten lines, sorted and deduplicated.
     */
    const declarations = (tokens: readonly string[]): string | null => {
        const lines: string[] = [];
        for (const token of tokens) {
            const rule = css.get(token);
            if (!rule) return null;
            lines.push(...normalise(rule));
        }
        return [...new Set(lines)].sort().join('\n');
    };

    const failures = migrated.flatMap(({ className, szObject, lanes }) => {
        const [first] = lanes;
        if (lanes.some(lane => lane !== first)) {
            return [
                `${className} → ${JSON.stringify(szObject)}: engines write ${lanes.join(' | ')}`,
            ];
        }
        const want = declarations([className]);
        const got = declarations((first ?? '').split(' ').filter(Boolean));
        return got === want ? [] : [`${className} → ${JSON.stringify(szObject)} → ${first}`];
    });

    it('reaches every prefix with served classes, and migrates most of them', () => {
        expect(SORTED_PREFIXES.length).toBeGreaterThan(250);
        expect(served.length).toBeGreaterThan(4000);
        expect(migrated.length).toBeGreaterThan(3500);
    });

    it('lowers every migrated class back to the same CSS on every engine', () => {
        expect(failures).toEqual([]);
    });
});
