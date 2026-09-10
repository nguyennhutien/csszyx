/**
 * Rows the snippets document that the compiler does not reproduce.
 *
 * `sz-key-cases.json` is generated from the snippet tables to hold the compiler
 * to them. It used to keep only the rows the compiler already agreed with and
 * discard the rest without a word, so the suite it fed could contain nothing
 * but cases that already passed — a fixture that cannot fail its subject.
 *
 * The generator now records those rows instead, and this file holds the record
 * to a named set. A row joins it only with a verdict, and the verdicts come
 * from asking the project's Tailwind whether each class produces CSS — not from
 * reading the two strings and preferring one.
 *
 * Only rows whose pairing is certain are recorded: a snippet row listing
 * several classes beside several sz objects is paired by index, which is wrong
 * often enough that a mismatch there says nothing about the compiler. That
 * restriction takes the list from 38 rows to 11.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface DriftedRow {
    key: string;
    sz: Record<string, unknown>;
    documented: string;
    emitted: string;
}

const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL('./generated/sz-key-cases.json', import.meta.url)), 'utf8'),
) as { drifted: DriftedRow[] };

/**
 * Rows where the compiler emits a class this project's Tailwind serves nothing
 * for, while the documented class does produce CSS. Each is a defect on both
 * engines — they agree with each other and disagree with Tailwind, which is why
 * neither the differential nor the metamorphic harness can see them.
 *
 * The shape is one family: a decimal or a non-integer fraction needs arbitrary
 * brackets, and both engines emit it bare.
 */
const COMPILER_EMITS_DEAD_CLASS: readonly string[] = [
    '{"basis":"2.5/4"} basis-[2.5/4] -> basis-2.5/4',
    '{"flex":"3.5/4"} flex-[3.5/4] -> flex-3.5/4',
    '{"flex":3.5} flex-[3.5] -> flex-3.5',
    '{"grow":2.5} grow-[2.5] -> grow-2.5',
    '{"shrink":2.5} shrink-[2.5] -> shrink-2.5',
    '{"strokeWidth":0.5} stroke-[0.5] -> stroke-0.5',
];

/**
 * Rows where both spellings produce CSS, so neither side is wrong: the snippet
 * shows one form and the compiler emits an equivalent other. Recorded so a real
 * defect cannot hide among them, not because anything needs fixing.
 */
const BOTH_SPELLINGS_WORK: readonly string[] = [
    '{"fontStretch":"110%"} font-stretch-[110%] -> font-stretch-110%',
    '{"from":{"color":"red-500","op":30}} mask-b-from-red-500/30 -> from-red-500/30',
    '{"lineClamp":7} line-clamp-[7] -> line-clamp-7',
    `{"mask":"url('/img.png')"} mask-[url(/img.png)] -> mask-[url('/img.png')]`,
];

/**
 * Rows whose sz object only means what the snippet shows inside a surrounding
 * context the generator does not carry — a mask shorthand read on its own.
 */
const NEEDS_SURROUNDING_CONTEXT: readonly string[] = ['{"b":{"from":"20%"}} mask-b-from-20% -> '];

/**
 * Renders one row the way the lists above spell it.
 *
 * @param row A drifted row from the fixture.
 * @returns Its one-line identity.
 */
function identity(row: DriftedRow): string {
    return `${JSON.stringify(row.sz)} ${row.documented} -> ${row.emitted}`;
}

/**
 * Indents one row for a failure message.
 *
 * @param row The row's one-line identity.
 * @returns The row, indented.
 */
function indent(row: string): string {
    return `  ${row}`;
}

describe('snippet rows the compiler does not reproduce', () => {
    it('every drifted row is one of the rows already accounted for', () => {
        // A new entry means either the compiler changed or a snippet did, and
        // which one is a question for whoever made the change — the fixture
        // will not answer it by dropping the row.
        const accounted = new Set([
            ...COMPILER_EMITS_DEAD_CLASS,
            ...BOTH_SPELLINGS_WORK,
            ...NEEDS_SURROUNDING_CONTEXT,
        ]);
        const unaccounted = fixture.drifted.map(identity).filter(row => !accounted.has(row));
        const listed = unaccounted.map(indent).join('\n');
        expect(
            unaccounted,
            `${unaccounted.length} snippet row(s) the compiler does not reproduce, and that ` +
                'no verdict covers. Ask the project Tailwind which class produces CSS, then ' +
                `record it with that verdict:\n${listed}`,
        ).toEqual([]);
    });

    it('every accounted row is still drifting', () => {
        // The list can only shrink. A row that starts matching has been fixed
        // and its entry must go, or the record stops describing the compiler.
        const present = new Set(fixture.drifted.map(identity));
        const gone = [
            ...COMPILER_EMITS_DEAD_CLASS,
            ...BOTH_SPELLINGS_WORK,
            ...NEEDS_SURROUNDING_CONTEXT,
        ].filter(row => !present.has(row));
        expect(
            gone,
            `${gone.length} recorded row(s) now match — remove them:\n` +
                gone.map(indent).join('\n'),
        ).toEqual([]);
    });

    it('the generator still records drift at all', () => {
        // If a refactor made `drifted` always empty, both checks above would
        // pass while measuring nothing.
        expect(Array.isArray(fixture.drifted)).toBe(true);
        expect(fixture.drifted.length).toBeGreaterThan(0);
    });
});
