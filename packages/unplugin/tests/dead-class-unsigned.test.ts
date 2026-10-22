/**
 * A dead `sz` class whose utility carries the sign `sz` hoisted in front of
 * it is reported once, as `unsigned-value`, never also as `dead-class`.
 *
 * `{ p: -2 }` lowers to `-p-2`, the way Tailwind spells a negative. Whether
 * the project serves it is the project's Tailwind's answer (ADR 0012,
 * PROJECT-RULES §4): the style model says the class is dead, and only then is
 * the sign the thing to name. A project that defines `@utility -p-*` serves
 * the class and hears nothing.
 */
import { describe, expect, it } from 'vitest';

import {
    deadClassMessage,
    findDeadSzClasses,
    hoistedSignUtility,
    reportDeadSzClasses,
    unsignedValueMessage,
} from '../src/dead-class.js';
import { createDiagnosticLimiter } from '../src/diagnostic-limiter.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import type { ProjectStyleModel } from '../src/project-style-model.js';

/**
 * A style model whose design system serves every class but the ones named.
 *
 * @param dead - The classes it serves nothing for.
 * @returns The two members the report reads.
 */
function modelServingAllBut(
    dead: readonly string[],
): Pick<ProjectStyleModel, 'facts' | 'unserved'> {
    return {
        facts: {} as ProjectStyleModel['facts'],
        unserved: classes => classes.filter(className => dead.includes(className)),
    };
}

describe('hoistedSignUtility', () => {
    it.each([
        ['-p-2', 'p-2'],
        ['-translate-x-1/2', 'translate-x-1/2'],
        ['hover:-p-2', 'p-2'],
        ['md:hover:-mt-1', 'mt-1'],
        ['data-[state=open]:-p-3', 'p-3'],
        ['group-hover:-w-4', 'w-4'],
        ['group-[.is-open]:-w-4', 'w-4'],
        ['[&>*]:-p-1', 'p-1'],
        ['[&:hover]:-p-1', 'p-1'],
        ['supports-(--x):-p-1', 'p-1'],
        ['tw:-p-2', 'p-2'],
        ['!-p-2', 'p-2'],
        ['hover:!-p-2', 'p-2'],
    ])('reads %s as a negative %s', (className, utility) => {
        expect(hoistedSignUtility(className)).toBe(utility);
    });

    it.each([
        'p-2',
        'mt-[-10px]',
        'hover:mt-[-10px]',
        'data-[x=-1]:p-2',
        '[&>-x]:p-1',
        'p-(--x)',
        '-',
        '--x',
        '-[2px]',
        'hover:',
    ])('finds no hoisted sign in %s', className => {
        expect(hoistedSignUtility(className)).toBeNull();
    });
});

describe('findDeadSzClasses', () => {
    it('marks a dead class with a hoisted sign as unsigned, and leaves the rest dead', () => {
        const origins = new Map<string, string>([
            ['-p-2', 'src/A.tsx'],
            ['data-[state=open]:-p-3', 'src/A.tsx'],
            ['break-bogus', 'src/A.tsx'],
            ['-mt-2', 'src/A.tsx'],
        ]);
        const model = modelServingAllBut(['-p-2', 'data-[state=open]:-p-3', 'break-bogus']);
        expect(findDeadSzClasses(model, origins)).toEqual([
            { className: '-p-2', unsigned: 'p-2', file: 'src/A.tsx' },
            { className: 'break-bogus', file: 'src/A.tsx' },
            { className: 'data-[state=open]:-p-3', unsigned: 'p-3', file: 'src/A.tsx' },
        ]);
    });

    it('says a class dead without its sign too as plain dead, variants kept in the question', () => {
        const origins = new Map<string, string>([
            ['-p-medium', 'src/A.tsx'],
            ['hover:!-p-medium', 'src/A.tsx'],
            ['tw:md:-p-wide', 'src/A.tsx'],
            ['md:-p-3', 'src/A.tsx'],
        ]);
        // `md:p-3` is served, so the sign is the thing to name there; the
        // others are dead unsigned too, and with any one variant dropped, as
        // Tailwind answers: no utility `p-medium` or `p-wide` under any name.
        const model = modelServingAllBut([
            '-p-medium',
            'p-medium',
            'hover:!-p-medium',
            'hover:!p-medium',
            '!-p-medium',
            'tw:md:-p-wide',
            'tw:md:p-wide',
            'md:-p-wide',
            'tw:-p-wide',
            'md:-p-3',
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            { className: '-p-medium', file: 'src/A.tsx' },
            { className: 'hover:!-p-medium', file: 'src/A.tsx' },
            { className: 'md:-p-3', unsigned: 'p-3', file: 'src/A.tsx' },
            { className: 'tw:md:-p-wide', file: 'src/A.tsx' },
        ]);
    });

    it('asks the unsigned form once per model, and only of a dead signed class', () => {
        const asked: string[][] = [];
        const model = {
            facts: {} as ProjectStyleModel['facts'],
            unserved: (classes: readonly string[]) => {
                asked.push([...classes]);
                return classes.filter(className => className !== 'p-2');
            },
        };
        const origins = new Map([
            ['-p-2', 'src/A.tsx'],
            ['-p-medium', 'src/A.tsx'],
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            { className: '-p-2', unsigned: 'p-2', file: 'src/A.tsx' },
            { className: '-p-medium', file: 'src/A.tsx' },
        ]);
        expect(findDeadSzClasses(model, origins)).toHaveLength(2);
        expect(asked).toEqual([
            ['-p-2', '-p-medium'],
            ['p-2', 'p-medium'],
        ]);
    });

    it('says nothing of a signed class the project serves, as one with @utility -p-* does', () => {
        const origins = new Map([['-p-2', 'src/A.tsx']]);
        expect(findDeadSzClasses(modelServingAllBut([]), origins)).toEqual([]);
    });
});

describe('the unsigned-value report', () => {
    const SITE = { line: 1, column: 34, key: 'p' };
    const findings = [
        { className: '-p-2', unsigned: 'p-2', file: 'src/A.tsx', ...SITE },
        { className: 'break-bogus', file: 'src/A.tsx' },
    ];
    const run = (rules: Record<string, string> = {}) =>
        reportDeadSzClasses(findings, {
            policy: createDiagnosticPolicy({ rules } as Parameters<
                typeof createDiagnosticPolicy
            >[0]),
            quiet: 'off',
            holdInfo: true,
            limiter: createDiagnosticLimiter(),
        }).lines;

    it('says each class once, under one id', () => {
        expect(run()).toEqual([
            unsignedValueMessage('-p-2', 'p-2', 'src/A.tsx', SITE),
            deadClassMessage('break-bogus', 'src/A.tsx'),
        ]);
        expect(unsignedValueMessage('-p-2', 'p-2', 'src/A.tsx', SITE)).toBe(
            '[csszyx] unsigned-value: src/A.tsx:1:34\n' +
                "  `-p-2` produces no CSS: this project's Tailwind serves `p-2` but no negative form of it.\n" +
                "  help: drop the sign, or define the negative with Tailwind's `@utility`; `csszyx check --rule unsigned-value` lists every one.\n" +
                '  note: the class is still emitted, and it styles nothing.\n' +
                '  docs: https://csszyx.com/e/unsigned-value',
        );
        expect(unsignedValueMessage('-p-2', 'p-2', 'src/A.tsx')).toMatch(
            /^\[csszyx\] unsigned-value: src\/A\.tsx\n/,
        );
    });

    it('reads the level of unsigned-value, under the dead-class pass', () => {
        expect(run({ 'unsigned-value': 'off' })).toEqual([
            deadClassMessage('break-bogus', 'src/A.tsx'),
        ]);
        expect(run({ 'dead-class': 'off' })).toEqual([]);
        expect(run({ 'dead-class': 'off', 'unsigned-value': 'warn' })).toEqual([
            unsignedValueMessage('-p-2', 'p-2', 'src/A.tsx', SITE),
        ]);
    });

    it('keeps the two ids apart in the dedupe record', () => {
        const input = {
            policy: createDiagnosticPolicy(),
            quiet: 'off' as const,
            holdInfo: true,
            limiter: createDiagnosticLimiter(),
        };
        expect(reportDeadSzClasses(findings, input).lines).toHaveLength(2);
        // The dead class left; the unsigned one stays said.
        expect(reportDeadSzClasses(findings.slice(0, 1), input).lines).toEqual([]);
        expect(reportDeadSzClasses(findings, input).lines).toEqual([
            deadClassMessage('break-bogus', 'src/A.tsx'),
        ]);
    });
});
