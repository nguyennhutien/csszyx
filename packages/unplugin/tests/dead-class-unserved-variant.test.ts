/**
 * A dead `sz` class whose utility the project's Tailwind serves, under one
 * variant it does not, is reported once, as `unserved-variant`, never also as
 * `dead-class` (ADR 0031 item 17).
 *
 * `{ hidden: { p: 4 } }` lowers to `hidden:p-4`: `p-4` is served, the bare
 * `hidden` variant is not. Which variant is the one to name is the project's
 * own Tailwind's answer (PROJECT-RULES §4): the class with that one variant
 * dropped is served, and with any other dropped it is not. No variant list is
 * read at build: a project that defines `@custom-variant expanded` serves
 * `expanded:p-4`, and nothing is said.
 */
import { renderSzDiagnostic, SZ_DIAGNOSTIC_COMPUTED_VALUES } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    deadClassMessage,
    findDeadSzClasses,
    reportDeadSzClasses,
    unservedVariantMessage,
    variantDroppedForms,
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

describe('variantDroppedForms', () => {
    it.each([
        ['hidden:p-4', [['hidden', 'p-4']]],
        [
            'md:hidden:p-4',
            [
                ['md', 'hidden:p-4'],
                ['hidden', 'md:p-4'],
            ],
        ],
        [
            'tw:hidden:!p-4',
            [
                ['tw', 'hidden:!p-4'],
                ['hidden', 'tw:!p-4'],
            ],
        ],
        ['data-[a=b:c]:p-1', [['data-[a=b:c]', 'p-1']]],
        [
            '[&:hover]:hidden:p-1',
            [
                ['[&:hover]', 'hidden:p-1'],
                ['hidden', '[&:hover]:p-1'],
            ],
        ],
    ])('drops each variant of %s once', (className, forms) => {
        expect(variantDroppedForms(className)).toEqual(
            forms.map(([variant, without]) => ({ variant, without })),
        );
    });

    it.each(['p-4', '-p-2', 'p-[a:b]', 'bg-(--x:y)'])('finds no variant in %s', className => {
        expect(variantDroppedForms(className)).toEqual([]);
    });
});

describe('findDeadSzClasses', () => {
    it('names the one variant whose drop makes the class served, with its form', () => {
        const origins = new Map<string, string>([
            ['hidden:p-4', 'src/A.tsx'],
            ['hovr:p-4', 'src/A.tsx'],
            ['md:expanded:w-1', 'src/A.tsx'],
            ['break-bogus', 'src/A.tsx'],
        ]);
        const model = modelServingAllBut([
            'hidden:p-4',
            'hovr:p-4',
            'md:expanded:w-1',
            'expanded:w-1',
            'break-bogus',
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            { className: 'break-bogus', file: 'src/A.tsx' },
            {
                className: 'hidden:p-4',
                variant: { name: 'hidden', form: 'attribute-or-aria' },
                file: 'src/A.tsx',
            },
            {
                className: 'hovr:p-4',
                variant: { name: 'hovr', form: 'unknown' },
                file: 'src/A.tsx',
            },
            {
                className: 'md:expanded:w-1',
                variant: { name: 'expanded', form: 'aria' },
                file: 'src/A.tsx',
            },
        ]);
    });

    // 0.18 reads a name nested under a query as a variant; the class 0.17
    // wrote for it is the named container, which is one key now.
    it('names a name right after a query as a container to write as one key', () => {
        const origins = new Map<string, string>([
            ['@md:sidebar:p-4', 'src/A.tsx'],
            ['@max-lg:sidebar:hover:m-2', 'src/A.tsx'],
            ['@md/main:hovr:p-4', 'src/A.tsx'],
        ]);
        // Tailwind serves no `sidebar` or `hovr` variant, so only dropping
        // the name serves the class.
        const model = modelServingAllBut([
            '@md:sidebar:p-4',
            'sidebar:p-4',
            '@max-lg:sidebar:hover:m-2',
            'sidebar:hover:m-2',
            '@max-lg:sidebar:m-2',
            '@md/main:hovr:p-4',
            'hovr:p-4',
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            {
                className: '@max-lg:sidebar:hover:m-2',
                variant: { name: 'sidebar', form: 'container-name', query: '@max-lg' },
                file: 'src/A.tsx',
            },
            {
                className: '@md/main:hovr:p-4',
                variant: { name: 'hovr', form: 'unknown' },
                file: 'src/A.tsx',
            },
            {
                className: '@md:sidebar:p-4',
                variant: { name: 'sidebar', form: 'container-name', query: '@md' },
                file: 'src/A.tsx',
            },
        ]);
        expect(
            unservedVariantMessage(
                {
                    className: '@md:sidebar:p-4',
                    variant: { name: 'sidebar', form: 'container-name', query: '@md' },
                },
                { file: 'src/A.tsx' },
            ),
        ).toBe(
            '[csszyx] unserved-variant: src/A.tsx\n' +
                '  `@md:sidebar:p-4` produces no CSS: Tailwind serves no `sidebar` variant.\n' +
                "  help: write `{ '@md/sidebar': { … } }` for a container named `sidebar`; a name under a query is a variant.\n" +
                '  note: the class is still emitted, and it styles nothing unless the project defines `sidebar` with `@custom-variant`.\n' +
                '  docs: https://csszyx.com/e/unserved-variant',
        );
    });

    it('says a class dead without the variant too, or under two dead variants, as plain dead', () => {
        const origins = new Map<string, string>([
            ['hidden:p-bogus', 'src/A.tsx'],
            ['hovr:hidden:p-4', 'src/A.tsx'],
        ]);
        const model = modelServingAllBut([
            'hidden:p-bogus',
            'p-bogus',
            'hovr:hidden:p-4',
            'hidden:p-4',
            'hovr:p-4',
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            { className: 'hidden:p-bogus', file: 'src/A.tsx' },
            { className: 'hovr:hidden:p-4', file: 'src/A.tsx' },
        ]);
    });

    it('keeps a hoisted sign unsigned-value, and asks the dropped forms once, of dead classes only', () => {
        const asked: string[][] = [];
        const model = {
            facts: {} as ProjectStyleModel['facts'],
            unserved: (classes: readonly string[]) => {
                asked.push([...classes]);
                return classes.filter(
                    className => className.includes('hidden:') || className === 'md:-p-2',
                );
            },
        };
        const origins = new Map([
            ['hidden:p-4', 'src/A.tsx'],
            ['md:-p-2', 'src/A.tsx'],
            ['md:p-4', 'src/A.tsx'],
        ]);
        expect(findDeadSzClasses(model, origins)).toEqual([
            {
                className: 'hidden:p-4',
                variant: { name: 'hidden', form: 'attribute-or-aria' },
                file: 'src/A.tsx',
            },
            { className: 'md:-p-2', unsigned: 'p-2', file: 'src/A.tsx' },
        ]);
        findDeadSzClasses(model, origins);
        // One more question, of the dead classes only: each one's unsigned
        // form and each form with one variant dropped.
        expect(asked).toEqual([
            ['hidden:p-4', 'md:-p-2', 'md:p-4'],
            ['p-4', 'md:p-2', '-p-2'],
        ]);
    });
});

describe('the unserved-variant report', () => {
    const SITE = { line: 2, column: 30, key: 'p' };
    const findings = [
        {
            className: 'hidden:p-4',
            variant: { name: 'hidden', form: 'attribute-or-aria' as const },
            file: 'src/A.tsx',
            ...SITE,
        },
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

    it('says each class once, in the registry words, at its site', () => {
        const line = unservedVariantMessage(findings[0], findings[0]);
        expect(run()).toEqual([line, deadClassMessage('break-bogus', 'src/A.tsx')]);
        expect(line).toBe(
            renderSzDiagnostic({
                diagnostic: {
                    code: 'unserved-variant',
                    args: { form: 'attribute-or-aria', variant: 'hidden', className: 'hidden:p-4' },
                    line: 2,
                    column: 30,
                },
                file: 'src/A.tsx',
                computed: SZ_DIAGNOSTIC_COMPUTED_VALUES,
            }),
        );
        expect(line).toMatch(/^\[csszyx\] unserved-variant: src\/A\.tsx:2:30\n/);
        // A class the engine did not place is named at its file.
        expect(unservedVariantMessage(findings[0], { file: 'src/B.tsx' })).toMatch(
            /^\[csszyx\] unserved-variant: src\/B\.tsx\n {2}`hidden:p-4` produces no CSS/,
        );
    });

    it('reads the level of unserved-variant, under the dead-class pass', () => {
        expect(run({ 'unserved-variant': 'off' })).toEqual([
            deadClassMessage('break-bogus', 'src/A.tsx'),
        ]);
        expect(run({ 'dead-class': 'off' })).toEqual([]);
        expect(run({ 'dead-class': 'off', 'unserved-variant': 'warn' })).toHaveLength(1);
    });
});
