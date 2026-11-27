/**
 * `inferDataType`, the reading `dynamic()` gives a bracket on a prefix
 * several properties share, against the function Tailwind itself infers a
 * type with, taken from the Tailwind this repository installs.
 *
 * Tailwind ships the function in a hashed chunk, so the test finds the chunk
 * by the table it holds rather than by name, and fails loudly when it cannot.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inferDataType } from '../../compiler/src/arbitrary-data-type.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

/** Every type `inferDataType` reads. */
const TYPES = [
    'color',
    'length',
    'percentage',
    'number',
    'line-width',
    'url',
    'image',
    'position',
    'bg-size',
    'family-name',
    'generic-name',
    'absolute-size',
    'relative-size',
    'angle',
    'vector',
];

/**
 * Units csszyx reads as a length and Tailwind's list leaves out (CSS Values 4
 * lengths it does not list yet). A class in one is a length here and a colour
 * there, which writes nothing either way.
 */
const UNITS_TAILWIND_DOES_NOT_LIST = /\d(?:rex|r?cap|r?ic|rch|[sld]v(?:i|b|min|max))\b/;

/**
 * Tailwind lists the named colours; csszyx does not carry the list, since no
 * other type reads a colour word and a value of no type is the colour anyway.
 *
 * @param type - The type asked for.
 * @param value - The value.
 * @param theirs - What Tailwind answered.
 * @returns Whether the two may differ for that reason.
 */
function namedColour(type: string, value: string, theirs: string | null): boolean {
    return type === 'color' && theirs === 'color' && /^[a-z]+$/i.test(value);
}

/**
 * @returns Tailwind's own `inferDataType`.
 */
async function tailwindInfer(): Promise<(value: string, types: string[]) => string | null> {
    const require = createRequire(path.join(REPO, 'packages/tailwind-oracle/package.json'));
    const dist = path.join(path.dirname(require.resolve('tailwindcss/package.json')), 'dist');
    const chunk = readdirSync(dist).find(
        name =>
            name.startsWith('chunk-') &&
            name.endsWith('.mjs') &&
            readFileSync(path.join(dist, name), 'utf8').includes('"line-width":'),
    );
    if (chunk === undefined) throw new Error(`no chunk in ${dist} holds Tailwind's type table`);
    const source = readFileSync(path.join(dist, chunk), 'utf8');
    // The export names the function by the letter the bundle gave it.
    const letter = /function (\w+)\(e,t\)\{if\(e\.startsWith\("var\("\)\)return null;/.exec(
        source,
    )?.[1];
    const marker = `${letter} as `;
    const at = source.indexOf(marker);
    const exported = at === -1 ? undefined : /^\w+/.exec(source.slice(at + marker.length))?.[0];
    if (letter === undefined || exported === undefined) {
        throw new Error(`${chunk} no longer exports the type inference this test reads`);
    }
    const module = (await import(pathToFileURL(path.join(dist, chunk)).href)) as Record<
        string,
        (value: string, types: string[]) => string | null
    >;
    return module[exported] as (value: string, types: string[]) => string | null;
}

/**
 * A seeded generator, so a failure names an input that reproduces.
 *
 * @param seed - The seed.
 * @returns The next number in [0, 1).
 */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

/** The words a generated value is made of. */
const WORDS = [
    '12px',
    '-1.5rem',
    '.5em',
    '1e3px',
    '2',
    '0.5',
    '+3',
    '50%',
    '1/2',
    '45deg',
    '2s',
    '1fr',
    '3cqi',
    '1vmax',
    'center',
    'top',
    'left',
    'auto',
    'cover',
    'contain',
    'thin',
    'thick',
    'medium',
    'small',
    'xx-large',
    'larger',
    'serif',
    'ui-monospace',
    'Inter',
    '"Open Sans"',
    'red',
    '#f00',
    'rgb(0 0 0)',
    'rgb(calc(255) 0 0)',
    'oklch(from var(--c) calc(l * 0.8) c h)',
    'HSL(10 50% 50%)',
    '--alpha(var(--c) / 50%)',
    'var(--x)',
    'var(--x, 2px)',
    'calc(1px + 2px)',
    'minmax(1px, 2px)',
    '--spacing(4)',
    'url(a.png)',
    'url("a b.png")',
    'linear-gradient(red, blue)',
    'repeating-radial-gradient(red, blue)',
    'image-set(url(a.png) 1x)',
    'foo(1, 2)',
    '[a,b]',
    '{a,b}',
    String.raw`a\,b`,
    '"a,b"',
    // Unbalanced: a closer that does not match the opener is not one.
    '(]',
    ')',
    '[a',
];

describe("inferDataType, against Tailwind's own", async () => {
    const tailwind = await tailwindInfer();

    it.each([
        ['#f00', 'color'],
        ['rgb(calc(255) 0 0)', 'color'],
        ['oklch(from var(--c) calc(l * 0.8) c h)', 'color'],
        ['12px', 'length'],
        ['calc(var(--x) * 2)', 'length'],
        ['50%', 'percentage'],
        ['2', 'number'],
        ['thin 2px', 'line-width'],
        ['url(a.png)', 'url'],
        ['linear-gradient(red,blue),url(a.png)', 'image'],
        ['center top', 'position'],
        ['cover,10px auto', 'bg-size'],
        ['Inter, serif', 'family-name'],
        ['serif', 'generic-name'],
        ['xx-large', 'absolute-size'],
        ['smaller', 'relative-size'],
        ['45deg', 'angle'],
        ['1 -0.5 2e1', 'vector'],
    ])('%s is a %s', (value, type) => {
        expect(inferDataType(value, [type])).toBe(type);
        expect(tailwind(value, [type])).toBe(type);
    });

    it.each(['var(--x)', 'var(--x) 2px'])('%s has no type', value => {
        expect(inferDataType(value, TYPES)).toBeUndefined();
        expect(tailwind(value, TYPES)).toBeNull();
    });

    it('reads no other type as a colour', () => {
        // A colour asked for first is the colour, a math call in it or not.
        expect(inferDataType('rgb(calc(255) 0 0)', ['color', 'length'])).toBe('color');
        expect(tailwind('rgb(calc(255) 0 0)', ['color', 'length'])).toBe('color');
        // The colour is what a value of none of these is read as.
        const notFamily = TYPES.filter(type => type !== 'family-name' && type !== 'color');
        for (const colour of [
            'red',
            '#f00',
            'rgb(0 0 0)',
            'oklch(0.5 0.1 20)',
            'transparent',
            'rgb(1 2 3)',
        ]) {
            expect(inferDataType(colour, notFamily), colour).toBeUndefined();
            expect(tailwind(colour, notFamily), colour).toBeNull();
        }
    });

    it('agrees on each type for 20,000 seeded values', () => {
        const next = random(20_261_127);
        const disagree: string[] = [];
        for (let run = 0; run < 20_000; run++) {
            const count = 1 + Math.floor(next() * 3);
            let value = '';
            for (let index = 0; index < count; index++) {
                if (index > 0) value += next() < 0.5 ? ' ' : ', ';
                value += WORDS[Math.floor(next() * WORDS.length)];
            }
            for (const type of TYPES) {
                const ours = inferDataType(value, [type]) ?? null;
                const theirs = tailwind(value, [type]);
                const excused =
                    UNITS_TAILWIND_DOES_NOT_LIST.test(value) || namedColour(type, value, theirs);
                if (ours !== theirs && !excused) {
                    disagree.push(
                        `${type}: ${JSON.stringify(value)} ours=${ours} tailwind=${theirs}`,
                    );
                }
            }
        }
        expect([...new Set(disagree)].slice(0, 20)).toEqual([]);
    });

    it('splits only on a separator outside every matched bracket', () => {
        // `]` does not close `(`, so the comma is inside it.
        expect(inferDataType('(],1', ['family-name'])).toBe('family-name');
        expect(tailwind('(],1', ['family-name'])).toBe('family-name');
        // A closer with no opener closes nothing, so the comma splits.
        expect(inferDataType('),1', ['family-name'])).toBeUndefined();
        expect(tailwind('),1', ['family-name'])).toBeNull();
    });

    it('takes the first type that matches, in the order given', () => {
        // A length is a background size and a position too; the order decides.
        expect(inferDataType('12px', ['position', 'bg-size'])).toBe('position');
        expect(inferDataType('12px', ['bg-size', 'position'])).toBe('bg-size');
        expect(inferDataType('12px', [])).toBeUndefined();
        expect(inferDataType('12px', ['color', 'nope'])).toBeUndefined();
    });

    it('reads a long value in linear time', () => {
        // Square-time backtracking on a run of digits would take seconds here.
        const digits = `${'1'.repeat(200_000)}x`;
        const parts = Array.from({ length: 20_000 }, () => '12px').join(' ');
        const started = performance.now();
        // A family name never starts with a digit; nothing else reads `x`.
        expect(inferDataType(digits, TYPES)).toBeUndefined();
        expect(inferDataType(parts, ['position'])).toBe('position');
        expect(inferDataType(`${'('.repeat(50_000)}a`, TYPES)).toBe('family-name');
        expect(performance.now() - started).toBeLessThan(1000);
    });
});
