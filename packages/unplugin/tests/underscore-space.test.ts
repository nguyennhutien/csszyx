/**
 * An `_` the author wrote in an `sz` value is reported when the project's
 * Tailwind reads it as a space, and only then.
 *
 * The engine names each class that carries such an `_`; this asks the
 * project's Tailwind for the declarations of that class and of the same class
 * with one `_` escaped (`\_`). Different declarations mean Tailwind read that
 * `_` as a space. Nothing about where Tailwind does so is written here
 * (PROJECT-RULES §4): a `url()` keeps its `_` because Tailwind says so, asked
 * through the real 4.3.3 design system below.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmittedClassOracle } from '@csszyx/tailwind-oracle';
import { beforeAll, describe, expect, it } from 'vitest';

import { UNRENDERED_ENGINES } from '../../compiler/tests/engine-parity-harness.js';
import { createRng, escapeUnsafeChars, fuzzBudget } from '../../core/tests/helpers/sz-fuzz.js';
import { createDiagnosticLimiter } from '../src/diagnostic-limiter.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import { candidateDeclarationsFromCss } from '../src/merge-signature.js';
import {
    bareUnderscores,
    jsStringLiteral,
    reportUnderscoreSpaces,
    underscoreSpaceFindings,
    underscoreSpaceProbes,
} from '../src/underscore-space.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let cssFor: (classes: readonly string[]) => ReadonlyArray<string | null>;

beforeAll(async () => {
    const oracle = await createEmittedClassOracle({
        resolveFrom: REPO,
        css: '@import "tailwindcss";',
        cssBase: REPO,
    });
    if (!oracle.ok) throw new Error(`expected a ready oracle, got skip: ${oracle.reason}`);
    cssFor = classes => oracle.cssFor(classes);
});

/**
 * @param key - The key.
 * @param value - The value as written.
 * @param className - The class it lowers into.
 * @returns A fact as the engine reports it.
 */
function fact(key: string, value: string, className: string) {
    return { key, value, className, line: 1, column: 1 };
}

/**
 * @param facts - Facts to ask about, under one root.
 * @returns What is reported, as the fields a message names.
 */
function reported(facts: ReturnType<typeof fact>[]) {
    return underscoreSpaceFindings(facts, classes => [cssFor(classes)]).map(
        ({ key, literal, spaced, escaped }) => ({ key, literal, spaced, escaped }),
    );
}

describe('underscoreSpaceFindings', () => {
    it('reports an `_` in a string, with a space and an escape to write', () => {
        expect(reported([fact('content', "'a_b'", "content-['a_b']")])).toEqual([
            {
                key: 'content',
                literal: `"'a_b'"`,
                spaced: `"'a b'"`,
                escaped: `"'a\\\\_b'"`,
            },
        ]);
    });

    it('reports a grid template and a `var()` fallback', () => {
        expect(
            reported([
                fact('gridCols', '1fr_2fr', 'grid-cols-[1fr_2fr]'),
                fact('--x', 'var(--a,a_b)', '[--x:var(--a,a_b)]'),
            ]),
        ).toEqual([
            {
                key: 'gridCols',
                literal: "'1fr_2fr'",
                spaced: "'1fr 2fr'",
                escaped: "'1fr\\\\_2fr'",
            },
            {
                key: '--x',
                literal: "'var(--a,a_b)'",
                spaced: "'var(--a,a b)'",
                escaped: "'var(--a,a\\\\_b)'",
            },
        ]);
    });

    it('says nothing where Tailwind keeps the `_`', () => {
        expect(
            reported([
                fact('bgImg', 'url(/a_b.png)', 'bg-[url(/a_b.png)]'),
                fact('--x', 'var(--a_b)', '[--x:var(--a_b)]'),
            ]),
        ).toEqual([]);
    });

    it('turns only the `_` Tailwind reads as a space', () => {
        expect(reported([fact('--x', 'url(a_b) x_y', '[--x:url(a_b)_x_y]')])).toEqual([
            {
                key: '--x',
                literal: "'url(a_b) x_y'",
                spaced: "'url(a_b) x y'",
                escaped: "'url(a_b) x\\\\_y'",
            },
        ]);
    });

    it('says nothing for a class no root serves, or a value the class does not carry', () => {
        expect(
            underscoreSpaceFindings([fact('content', "'a_b'", "content-['a_b']")], classes => [
                classes.map(() => null),
            ]),
        ).toEqual([]);
        expect(reported([fact('content', "'a_b'", 'content-none')])).toEqual([]);
    });

    it('lets a root that serves nothing for the class have no say', () => {
        const facts = [fact('content', "'a_b'", "content-['a_b']")];
        const none = (classes: readonly string[]) => classes.map(() => null);
        expect(
            underscoreSpaceFindings(facts, classes => [none(classes), cssFor(classes)]),
        ).toHaveLength(1);
    });
});

describe('which `_` the author wrote', () => {
    it.each([
        // An `_` after a backslash is escaped, whatever precedes the backslash:
        // Tailwind reads `\_` as `_` wherever it sits, and so does the engine.
        ['a\\\\_b', []],
        ['\\_a_b', [3]],
        ['_a', [0]],
        ['a\\', []],
        ['a b', []],
    ])('%j has bare `_` at %j', (value, expected) => {
        expect(bareUnderscores(value)).toEqual(expected);
    });

    it('asks one probe per `_`, in one batch, however many there are', () => {
        const value = Array.from({ length: 500 }, () => 'a').join('_');
        const asked: number[] = [];
        const findings = underscoreSpaceFindings([fact('--x', value, classOf(value))], classes => {
            asked.push(classes.length);
            return [cssFor(classes)];
        });
        expect(asked).toEqual([500]);
        expect(findings.map(({ spaced }) => spaced)).toEqual([`'${value.replaceAll('_', ' ')}'`]);
    });

    it('finds the value however its whitespace was written, as the engine collapses it', () => {
        // The engine writes a run of whitespace as one `_` and drops it at the
        // ends: `' a  b\tc_d '` lowers into `[--x:a_b_c_d]`.
        expect(reported([fact('--x', ' a  b\tc_d ', '[--x:a_b_c_d]')])).toEqual([
            {
                key: '--x',
                literal: "' a  b\\tc_d '",
                spaced: "' a  b\\tc d '",
                escaped: "' a  b\\tc\\\\_d '",
            },
        ]);
    });

    it('says nothing for an `_` after an escaped backslash', () => {
        expect(reported([fact('--x', 'a\\\\_b', '[--x:a\\\\_b]')])).toEqual([]);
    });
});

/** Pieces a generated value is made of: plain, spaced, escaped, kept by Tailwind. */
const PIECES = ['a', '_', ' ', '\\_', '\\', 'url(a_b)', 'var(--a_b)', 'var(--a,b_c)', "'", '1fr'];

/**
 * @param literal - A literal {@link jsStringLiteral} wrote.
 * @returns The string it spells.
 */
function unquote(literal: string): string {
    return literal
        .slice(1, -1)
        .replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char));
}

/**
 * @param value - A value as written.
 * @returns The arbitrary property the engine lowers `--x: value` into.
 */
function classOf(value: string): string {
    return `[--x:${value.replaceAll(' ', '_')}]`;
}

/** {@link PIECES}, and whitespace the engine collapses: runs, tabs, newlines. */
const SPACED_PIECES = [
    ...PIECES,
    '  ',
    '\t',
    ' \n ',
    // Where JavaScript's `\s` and Rust's `split_whitespace` disagree: a NEL
    // is whitespace only to Rust, a BOM only to JavaScript; a no-break
    // space is whitespace to both.
    '\u0085',
    '\uFEFF',
    '\u00A0',
];

/**
 * Generated values, from a fixed seed (ADD-3).
 *
 * @param pieces - What a value is made of.
 * @param trimmed - Keep only values with no whitespace at either end.
 * @returns The values.
 */
function generatedValues(pieces: readonly string[] = PIECES, trimmed = true): string[] {
    const { seed, cases } = fuzzBudget(200);
    const rng = createRng(seed);
    const values = new Set<string>();
    for (let index = 0; index < cases; index++) {
        const length = 1 + Math.floor(rng() * 6);
        let value = '';
        for (let at = 0; at < length; at++) value += pieces[Math.floor(rng() * pieces.length)];
        if (!trimmed || value.trim() === value) values.add(value);
    }
    return [...values];
}

describe('underscoreSpaceFindings on generated values', () => {
    const values = generatedValues();

    it('answers the same twice', () => {
        const facts = values.map(value => fact('--x', value, classOf(value)));
        expect(reported(facts)).toEqual(reported(facts));
    });

    it('suggests an escape that changes what Tailwind styles, and a space that does not', () => {
        for (const value of values) {
            const [finding] = reported([fact('--x', value, classOf(value))]);
            if (finding === undefined) continue;
            const declarations = (written: string) =>
                candidateDeclarationsFromCss(
                    classOf(written),
                    cssFor([classOf(written)])[0] ?? null,
                );
            const asWritten = declarations(value);
            expect(declarations(unquote(finding.spaced)), value).toEqual(asWritten);
            expect(declarations(unquote(finding.escaped)), value).not.toEqual(asWritten);
            expect(unquote(finding.literal)).toBe(value);
        }
    });

    it.each(UNRENDERED_ENGINES)(
        'finds the `_` the %s engine reports, in the class it names',
        (_name, _rendered, transform) => {
            for (const value of generatedValues(SPACED_PIECES, false)) {
                const source = `export const A = () => <p sz={${escapeUnsafeChars(
                    JSON.stringify({ '--x': value }),
                )}} />;`;
                const result = transform(source, { filename: '/p/src/Underscore.jsx' });
                const facts = (result.underscoreValues ?? []).map(({ key, value, className }) => ({
                    key,
                    value,
                    className,
                }));
                expect(facts.length > 0, JSON.stringify(value)).toBe(
                    bareUnderscores(value).length > 0,
                );
                // Every fact is located in its class, however it was spaced.
                expect(underscoreSpaceProbes(facts).probed, JSON.stringify(value)).toHaveLength(
                    facts.length,
                );
            }
        },
    );
});

describe('reportUnderscoreSpaces', () => {
    const site = (file: string, line: number) => ({
        ...fact('content', "'a_b'", "content-['a_b']"),
        file,
        line,
        column: 7,
    });
    const run = (
        sites: ReturnType<typeof site>[],
        config: Record<string, unknown> = {},
        { limiter = createDiagnosticLimiter(), holdInfo = false } = {},
    ) =>
        reportUnderscoreSpaces(
            underscoreSpaceFindings(sites, classes => [cssFor(classes)]),
            {
                policy: createDiagnosticPolicy(
                    config as Parameters<typeof createDiagnosticPolicy>[0],
                ),
                quiet: 'off',
                holdInfo,
                limiter,
            },
        );

    it('says each site in the registry words, at its key', () => {
        const { lines } = run([site('src/A.tsx', 3)]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('underscore-space');
        expect(lines[0]).toContain(`\`content: "'a_b'"\``);
        expect(lines[0]).toContain(`\`content: "'a b'"\``);
        expect(lines[0]).toContain('src/A.tsx:3:7');
    });

    it('is reached by its own level, an override and the class allow list', () => {
        expect(run([site('src/A.tsx', 3)], { rules: { 'underscore-space': 'off' } }).lines).toEqual(
            [],
        );
        expect(
            run([site('src/A.tsx', 3)], {
                overrides: [{ files: ['src/**'], rules: { 'underscore-space': 'off' } }],
            }).lines,
        ).toEqual([]);
        expect(
            run([site('src/A.tsx', 3)], { allow: { classes: ["content-['a_b']"] } }).lines,
        ).toEqual([]);
    });

    it('counts a site held at info, and says one already said once', () => {
        expect(
            run(
                [site('src/A.tsx', 3)],
                { rules: { 'underscore-space': 'info' } },
                { holdInfo: true },
            ),
        ).toEqual({ lines: [], held: 1 });
        const limiter = createDiagnosticLimiter();
        expect(
            run([site('src/A.tsx', 3), site('src/B.tsx', 1)], {}, { limiter }).lines,
        ).toHaveLength(2);
        expect(run([site('src/A.tsx', 3)], {}, { limiter }).lines).toEqual([]);
    });
});

describe('jsStringLiteral', () => {
    it.each([
        ['a_b', "'a_b'"],
        ["'a b'", `"'a b'"`],
        [`a'b"c`, `'a\\'b"c'`],
        ['a\\_b', "'a\\\\_b'"],
    ])('writes %j as %s', (value, literal) => {
        expect(jsStringLiteral(value)).toBe(literal);
    });
});
