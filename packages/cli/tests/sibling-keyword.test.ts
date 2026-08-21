/**
 * An sz key that accepts theme tokens, given a keyword belonging to a sibling.
 *
 * Several sz keys lower under one Tailwind prefix. `color` and `textWrap` both
 * feed `text-`, so `color: 'balance'` emits `text-balance` — a real class, with
 * real CSS, that sets `text-wrap` and no colour at all. Nothing catches it:
 * the type accepts any string because a colour may be any theme token, the
 * class is not dead, and the rendered page simply lacks the colour.
 *
 * The discriminator is the CSS property. `fill-none` sets `fill`, which is what
 * `fill: 'red-500'` sets too, so `fill: 'none'` is a legitimate spelling.
 * `text-balance` sets `text-wrap`, which `color` never sets — that is the
 * mistake. Measured across a 5-library corpus and this repo's own apps, the
 * property test is what separates the two; a rule without it reported every
 * correct `fill: 'none'` and `color: 'white'` in the tree.
 *
 * Scope is keys with ONE domain. `outline`, `ring` and `border` accept a colour
 * AND their own values — `outline: 'none'` and `border: '3px'` are documented —
 * so their foreign values cannot be told from their own by this test, and they
 * are left out rather than reported wrongly. `bg` looks like one of them but is
 * covered: each other background domain has its own key, so every value `bg`
 * documents is a colour.
 *
 * The project's own theme decides, not Tailwind's defaults: a project that
 * declares `--color-balance` has made `color: 'balance'` mean something, and
 * this must stay quiet for it.
 */
import { describe, expect, it } from 'vitest';

import {
    findSiblingKeywordValues,
    type KeywordOracle,
    szValuePairs,
} from '../src/scanner/sibling-keyword.js';

/**
 * An oracle standing in for a project's design system.
 *
 * @param themeNames - Token names per namespace.
 * @param statics - Class names Tailwind reads as whole-name static utilities.
 * @param properties - CSS properties each class sets.
 * @returns The oracle.
 */
function oracle(
    themeNames: Record<string, string[]>,
    statics: string[],
    properties: Record<string, string[]>,
): KeywordOracle {
    return {
        themeNames: namespace => new Set(themeNames[namespace] ?? []),
        isStaticUtility: className => statics.includes(className),
        propertiesOf: className =>
            className in properties ? new Set(properties[className]) : null,
    };
}

const TAILWIND = oracle(
    { colors: ['red-500', 'white', 'transparent'], textSizes: ['lg'] },
    ['text-balance', 'text-center', 'border-solid', 'fill-none', 'bg-cover'],
    {
        'text-balance': ['text-wrap'],
        'text-center': ['text-align'],
        'border-solid': ['border-style'],
        'fill-none': ['fill'],
        'text-red-500': ['color'],
        'border-red-500': ['border-color'],
        'fill-red-500': ['fill'],
        'text-lg': ['font-size', 'line-height'],
        'bg-cover': ['background-size'],
        'bg-red-500': ['background-color'],
    },
);

describe('findSiblingKeywordValues', () => {
    it("reports a sibling's keyword on a colour key, naming the class it emits", () => {
        const found = findSiblingKeywordValues(
            [{ key: 'color', value: 'balance', line: 1 }],
            TAILWIND,
        );

        expect(found).toEqual([
            {
                key: 'color',
                value: 'balance',
                line: 1,
                className: 'text-balance',
                sets: ['text-wrap'],
            },
        ]);
    });

    it('carries the line through, so the report can point at it', () => {
        // The finding is built from the pair; rebuilding it field by field
        // silently dropped the position once already.
        const found = findSiblingKeywordValues(
            [{ key: 'color', value: 'balance', line: 42 }],
            TAILWIND,
        );

        expect(found[0].line).toBe(42);
    });

    it('reports it on a second key under the same prefix', () => {
        expect(
            findSiblingKeywordValues([{ key: 'borderColor', value: 'solid', line: 1 }], TAILWIND),
        ).toHaveLength(1);
    });

    it('stays silent for a value the project theme resolves', () => {
        // The whole point of an open domain: any theme token is valid.
        expect(
            findSiblingKeywordValues([{ key: 'color', value: 'red-500', line: 1 }], TAILWIND),
        ).toEqual([]);
    });

    it('stays silent for a keyword that sets the key OWN property', () => {
        // `fill-none` sets `fill`, exactly what a colour on `fill` sets. A rule
        // without this test reports every correct `fill: 'none'` in a codebase.
        expect(
            findSiblingKeywordValues([{ key: 'fill', value: 'none', line: 1 }], TAILWIND),
        ).toEqual([]);
    });

    it('stays silent once the project declares that token itself', () => {
        const themed = oracle({ colors: ['balance'] }, ['text-balance'], {
            'text-balance': ['text-wrap'],
            'text-red-500': ['color'],
        });

        expect(
            findSiblingKeywordValues([{ key: 'color', value: 'balance', line: 1 }], themed),
        ).toEqual([]);
    });

    it("reports another background domain's keyword on bg", () => {
        // `bg` reads as a shorthand but is not one: every documented value is a
        // colour, and each other background domain has a key of its own
        // (`bgSize`, `bgPos`, `bgImg`, …). So `bg: 'cover'` is the same mistake
        // as `color: 'balance'` — a live class setting a property `bg` never
        // sets — and it went unreported while `bg` sat with the shorthands.
        expect(
            findSiblingKeywordValues([{ key: 'bg', value: 'cover', line: 1 }], TAILWIND),
        ).toEqual([
            {
                key: 'bg',
                value: 'cover',
                line: 1,
                className: 'bg-cover',
                sets: ['background-size'],
            },
        ]);
    });

    it('stays silent for a colour on bg', () => {
        expect(
            findSiblingKeywordValues([{ key: 'bg', value: 'red-500', line: 1 }], TAILWIND),
        ).toEqual([]);
    });

    it('stays silent for a shorthand key that owns keywords of its own', () => {
        // `outline: 'none'` is the documented spelling, so the shorthand is out
        // of scope rather than reported.
        expect(
            findSiblingKeywordValues([{ key: 'outline', value: 'none', line: 1 }], TAILWIND),
        ).toEqual([]);
    });

    it('stays silent for a key it does not cover', () => {
        expect(findSiblingKeywordValues([{ key: 'p', value: '4', line: 1 }], TAILWIND)).toEqual([]);
    });

    it('stays silent when the class is not a static utility', () => {
        expect(
            findSiblingKeywordValues([{ key: 'color', value: 'nonesuch', line: 1 }], TAILWIND),
        ).toEqual([]);
    });

    it('stays silent when the design system will not say what the class sets', () => {
        // The whole verdict rests on comparing two property sets. Tailwind
        // answering `null` for either of them leaves nothing to compare, and
        // guessing there would report a value on no evidence at all — the one
        // failure this rule cannot afford, since a wrong report is what makes a
        // project switch the check off.
        const silent = oracle({ colors: ['red-500'] }, ['text-mystery'], {
            'text-red-500': ['color'],
        });

        expect(
            findSiblingKeywordValues([{ key: 'color', value: 'mystery', line: 1 }], silent),
        ).toEqual([]);
    });
});

describe('szValuePairs', () => {
    it('reads literal pairs out of an sz prop, with the line to go to', () => {
        const source = `export const A = () => <div sz={{ color: 'balance', p: 4 }} />;`;

        expect(szValuePairs(source)).toEqual([{ key: 'color', value: 'balance', line: 1 }]);
    });

    it('gives each pair the line it was written on', () => {
        // Without this the report can name a file but not a place in it, and
        // an editor or a CI annotation has nowhere to point.
        const source = [
            'export const A = () => (',
            '    <div',
            "        sz={{ color: 'balance' }}",
            '    />',
            ');',
        ].join('\n');

        expect(szValuePairs(source)).toEqual([{ key: 'color', value: 'balance', line: 3 }]);
    });

    it('reads pairs nested inside a variant', () => {
        const source = `const A = () => <div sz={{ hover: { color: 'balance' } }} />;`;

        expect(szValuePairs(source)).toEqual([{ key: 'color', value: 'balance', line: 1 }]);
    });

    it('reads every element of an sz array', () => {
        const source = `const A = () => <div sz={[{ color: 'balance' }, { bg: 'white' }]} />;`;

        expect(szValuePairs(source)).toEqual([
            { key: 'color', value: 'balance', line: 1 },
            { key: 'bg', value: 'white', line: 1 },
        ]);
    });

    it('reports nothing when a quote in the sz expression never closes', () => {
        // The brace walk swallows a quoted run whole, so an unterminated one
        // runs to the end of the file and the container never balances. A
        // half-read region would pair a key with whatever text followed it,
        // which is worse than saying nothing about a file that cannot parse.
        const source = `const A = () => <div sz={{ color: 'balance }} />;`;

        expect(szValuePairs(source)).toEqual([]);
    });

    it('ignores an object that is not an sz prop', () => {
        // A chart config or a style object can hold the same key names, and
        // reporting those would make the check unusable in a real app.
        const source = `const chart = { color: 'balance' };\nconst A = () => <div p={2} />;`;

        expect(szValuePairs(source)).toEqual([]);
    });

    it('reads the szs slot map too, where the same mistake lands', () => {
        const source = `const A = () => <Card szs={{ header: { color: 'balance' } }} />;`;

        expect(szValuePairs(source)).toEqual([{ key: 'color', value: 'balance', line: 1 }]);
    });

    it('reads past a brace that is only a character inside a string', () => {
        // The scan bounds itself by counting braces, so an escaped quote decides
        // where a string ends and therefore which braces count. Reading `\\"` as
        // the end of the string closes the attribute early, at a brace that is
        // ordinary text, and every pair written after it goes unchecked.
        const source = String.raw`const A = () => <div sz={{ label: "a\"}}", color: 'balance' }} />;`;

        expect(szValuePairs(source)).toEqual([{ key: 'color', value: 'balance', line: 1 }]);
    });

    it('reports nothing for an sz attribute whose expression never closes', () => {
        // A file mid-edit, or one this scanner reaches before the author has
        // finished typing. There is no region to read, and taking the rest of
        // the file as one would report pairs from whatever followed.
        const source = `const A = () => <div sz={{ color: 'balance'`;

        expect(szValuePairs(source)).toEqual([]);
    });
});
