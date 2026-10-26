/**
 * A served `sz` class carrying a CSS-wide keyword that no property it sets
 * takes is reported once, as `inert-keyword`.
 *
 * `{ ring: 'inherit' }` lowers to `ring-inherit`, which Tailwind serves as
 * `--tw-ring-color: inherit`: the keyword lands on a custom property, so the
 * class produces CSS and styles nothing. The CSS is the project's Tailwind's
 * answer (PROJECT-RULES §4); `cursor-[inherit]` sets `cursor: inherit`, and
 * nothing is said.
 */
import { describe, expect, it } from 'vitest';

import { findDeadSzClasses, reportDeadSzClasses } from '../src/dead-class.js';
import { createDiagnosticLimiter } from '../src/diagnostic-limiter.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import { cssWideKeywordOf, inertKeywordOf, inertUnderEveryRoot } from '../src/inert-keyword.js';
import type { ProjectStyleModel } from '../src/project-style-model.js';

/** Tailwind 4.3.3's CSS for each class the cases ask about. */
const CSS: Readonly<Record<string, string>> = {
    'ring-[inherit]': '.ring-\\[inherit\\] {\n  --tw-ring-color: inherit;\n}\n',
    'ring-inherit': '.ring-inherit {\n  --tw-ring-color: inherit;\n}\n',
    'text-inherit': '.text-inherit {\n  color: inherit;\n}\n',
    'cursor-[inherit]': '.cursor-\\[inherit\\] {\n  cursor: inherit;\n}\n',
    'hover:ring-[unset]!':
        '@media (hover: hover) {\n  .hover\\:ring-\\[unset\\]\\!:hover {\n    --tw-ring-color: unset !important;\n  }\n}\n',
    'bg-[length:unset]': '.bg-\\[length\\:unset\\] {\n  background-size: unset;\n}\n',
    'blur-[inherit]':
        '.blur-\\[inherit\\] {\n  --tw-blur: blur(inherit);\n  filter: var(--tw-blur,);\n}\n',
    '[color:inherit]': '.\\[color\\:inherit\\] {\n  color: inherit;\n}\n',
    'hover:[--x:unset]!':
        '@media (hover: hover) {\n  .hover\\:\\[--x\\:unset\\]\\!:hover {\n    --x: unset !important;\n  }\n}\n',
    '[--x:initial]': '.\\[--x\\:initial\\] {\n  --x: initial;\n}\n',
    'hover:[--x:unset]':
        '@media (hover: hover) {\n  .hover\\:\\[--x\\:unset\\]:hover {\n    --x: unset;\n  }\n}\n',
};

/**
 * A style model serving every class but the dead ones, with the CSS above.
 *
 * @param dead - The classes it serves nothing for.
 * @returns The members the dead pass reads.
 */
function model(
    dead: readonly string[] = [],
): Pick<ProjectStyleModel, 'facts' | 'unserved' | 'inert'> {
    return {
        facts: {} as ProjectStyleModel['facts'],
        unserved: classes => classes.filter(className => dead.includes(className)),
        inert: classes =>
            classes.filter(className => inertKeywordOf(className, CSS[className] ?? null) !== null),
    };
}

describe('cssWideKeywordOf', () => {
    it.each([
        ['ring-[inherit]', 'inherit'],
        ['hover:ring-[unset]!', 'unset'],
        ['bg-[length:unset]', 'unset'],
        ['[&:hover]:shadow-[revert-layer]', 'revert-layer'],
        ['ring-inherit', 'inherit'],
        ['text-inherit', 'inherit'],
        ['hover:shadow-revert-layer!', 'revert-layer'],
    ])('reads %s as carrying %s', (className, keyword) => {
        expect(cssWideKeywordOf(className)).toBe(keyword);
    });

    it.each([
        'p-4',
        'ring-[2px]',
        'ring-[inherit',
        'w-[calc(inherit)]',
        'inherit',
        'bg-[url(inherit)]',
    ])('finds no keyword in %s', className => {
        expect(cssWideKeywordOf(className)).toBeNull();
    });
});

describe('inertKeywordOf', () => {
    it.each([
        ['ring-[inherit]', 'inherit'],
        ['hover:ring-[unset]!', 'unset'],
        ['blur-[inherit]', 'inherit'],
        ['ring-inherit', 'inherit'],
    ])('names the keyword %s carries when no property takes it', (className, keyword) => {
        expect(inertKeywordOf(className, CSS[className] as string)).toBe(keyword);
    });

    // A custom property the class names itself takes the keyword: `initial`
    // makes `--x` guaranteed-invalid, so `var(--x, fallback)` falls back.
    it.each([
        'cursor-[inherit]',
        'bg-[length:unset]',
        'text-inherit',
        '[color:inherit]',
        '[--x:initial]',
        'hover:[--x:unset]',
        'hover:[--x:unset]!',
    ])('says nothing when %s sets a property to it', className => {
        expect(inertKeywordOf(className, CSS[className] as string)).toBeNull();
    });

    it('says nothing for a class that carries no keyword', () => {
        expect(inertKeywordOf('p-4', '.p-4 {\n  padding: 1rem;\n}\n')).toBeNull();
    });

    it('leaves a class with no CSS to the dead pass', () => {
        expect(inertKeywordOf('ring-[inherit]', null)).toBeNull();
    });
});

describe('inertUnderEveryRoot', () => {
    const ring = CSS['ring-[inherit]'] as string;
    const takes = '.ring-\\[inherit\\] {\n  box-shadow: inherit;\n}\n';

    it('needs every root that serves the class to agree', () => {
        expect(inertUnderEveryRoot(['ring-[inherit]'], [[ring], [ring]])).toEqual([
            'ring-[inherit]',
        ]);
        expect(inertUnderEveryRoot(['ring-[inherit]'], [[ring], [takes]])).toEqual([]);
    });

    it('gives a root serving nothing no say, and leaves a class no root serves alone', () => {
        expect(inertUnderEveryRoot(['ring-[inherit]'], [[null], [ring]])).toEqual([
            'ring-[inherit]',
        ]);
        expect(inertUnderEveryRoot(['ring-[inherit]'], [[null], [null]])).toEqual([]);
        expect(inertUnderEveryRoot(['ring-[inherit]'], [])).toEqual([]);
    });
});

describe('findDeadSzClasses', () => {
    it('marks a served keyword class no property takes as inert, and asks no dead class', () => {
        const origins = new Map<string, string>([
            ['ring-[inherit]', 'src/A.tsx'],
            ['cursor-[inherit]', 'src/A.tsx'],
            ['break-bogus', 'src/A.tsx'],
            ['shadow-[unset]', 'src/A.tsx'],
        ]);
        expect(findDeadSzClasses(model(['break-bogus', 'shadow-[unset]']), origins)).toEqual([
            { className: 'break-bogus', file: 'src/A.tsx' },
            { className: 'ring-[inherit]', inert: 'inherit', file: 'src/A.tsx' },
            { className: 'shadow-[unset]', file: 'src/A.tsx' },
        ]);
    });
});

describe('reportDeadSzClasses', () => {
    it('says an inert keyword class under its own id, which a level reaches', () => {
        const finding = {
            className: 'ring-[inherit]',
            inert: 'inherit',
            file: 'src/A.tsx',
            line: 3,
            column: 7,
        };
        const run = (rules: Record<string, string>) =>
            reportDeadSzClasses([finding], {
                policy: createDiagnosticPolicy({ rules } as Parameters<
                    typeof createDiagnosticPolicy
                >[0]),
                quiet: 'off',
                holdInfo: false,
                limiter: createDiagnosticLimiter(),
            });
        const { lines } = run({});
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('inert-keyword');
        expect(lines[0]).toContain('`ring-[inherit]`');
        expect(lines[0]).toContain('src/A.tsx:3:7');
        expect(run({ 'inert-keyword': 'off' }).lines).toEqual([]);
    });
});
