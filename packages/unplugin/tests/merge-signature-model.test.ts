/**
 * The analyzer's reading of custom CSS, pinned with `@utility` fixtures.
 *
 * These tables are built from the raw `signature` on purpose: `@utility` is the
 * only way to give a class exactly the declarations a case needs, and the
 * analyzer still serves diagnostics that read what a class sets. A build never
 * merges these classes: it reads `mergeSignature`, which keeps every
 * `@utility`, plugin and plain-CSS class out of the table
 * (`merge-scope.test.ts`).
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { _szcn, szcn } from '../../runtime/src/merge-classes.js';
import {
    __resetMergeSignaturesForTests,
    registerMergeSignatures,
} from '../../runtime/src/merge-signatures.js';
import { createMergeSignatureTable } from '../src/merge-signature.js';
import { openProjectStyleModel } from '../src/project-style-model.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    __resetMergeSignaturesForTests();
    removeTailwindProjects();
});

describe('project CSS to runtime merge', () => {
    it.each([szcn, _szcn])(
        'keeps distinct custom variables but merges writes to the same variable (helper %#)',
        async merge => {
            const root = tailwindProject('csszyx-merge-custom-identity-', {
                'app.css': `@import "tailwindcss";
                @utility card-inline { --card-inline-size: 1rem; }
                @utility card-width { --card-width: 2rem; }
                @utility card-inline-large { --card-inline-size: 3rem; }
                .card { width: var(--card-inline-size); height: var(--card-width); }`,
            });
            const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
            const candidates = ['card-inline', 'card-width', 'card-inline-large'];
            for (const prune of [false, true]) {
                registerMergeSignatures(
                    createMergeSignatureTable(candidates, candidate => model.signature(candidate), {
                        prune,
                    }),
                );
                expect.soft(merge('card-inline', 'card-width')).toBe('card-inline card-width');
                expect.soft(merge('card-width', 'card-inline')).toBe('card-width card-inline');
                expect.soft(merge('card-inline', 'card-inline-large')).toBe('card-inline-large');
                expect
                    .soft(merge('card-inline', 'card-width', 'card-inline-large'))
                    .toBe('card-width card-inline-large');
            }
        },
    );

    it('preserves every declaration in the three false-delete regression families', async () => {
        const root = tailwindProject('csszyx-merge-model-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        const pairs = [
            ['text-2xl', 'text-[0.8rem]'],
            ['transition', 'transition-none'],
            ['outline-hidden', 'outline-none'],
        ];
        registerMergeSignatures(
            createMergeSignatureTable(pairs.flat(), candidate => model.signature(candidate)),
        );
        for (const [previous, later] of pairs) {
            expect(szcn(previous, later)).toBe(`${previous} ${later}`);
            expect(_szcn(previous, later)).toBe(`${previous} ${later}`);
        }
    });

    it('merges a real nested hover rule within its context', async () => {
        const root = tailwindProject('csszyx-merge-hover-', {
            'app.css': '@import "tailwindcss";',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        registerMergeSignatures(
            createMergeSignatureTable(['p-2', 'hover:p-2', 'hover:p-8'], candidate =>
                model.signature(candidate),
            ),
        );
        expect(szcn('p-2 hover:p-2', 'hover:p-8')).toBe('p-2 hover:p-8');
        expect(_szcn('p-2 hover:p-2', 'hover:p-8')).toBe('p-2 hover:p-8');
    });

    it('keeps a custom utility whose nested rule is not covered', async () => {
        const root = tailwindProject('csszyx-merge-nested-', {
            'app.css':
                '@import "tailwindcss"; @utility card { color: red; &:hover { padding: 1rem; } } @utility tone { color: blue; }',
        });
        const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
        registerMergeSignatures(
            createMergeSignatureTable(['card', 'tone'], candidate => model.signature(candidate)),
        );
        expect(szcn('card', 'tone')).toBe('card tone');
        expect(_szcn('card', 'tone')).toBe('card tone');
    });
});

/**
 * Merge one ordered pair through a table compiled from real Tailwind CSS.
 *
 * @param pair - The earlier and the later class.
 * @param css - The project's entry stylesheet.
 * @returns What `szcn` keeps.
 */
async function merged(
    pair: readonly [string, string],
    css = '@import "tailwindcss";',
): Promise<string> {
    const root = tailwindProject('csszyx-merge-pair-', { 'app.css': css });
    const model = await openProjectStyleModel(root, [join(root, 'app.css')]);
    registerMergeSignatures(
        createMergeSignatureTable([...pair], candidate => model.signature(candidate)),
    );
    return szcn(...pair);
}

describe('logical and physical sides of one box', () => {
    // `padding` names the four physical sides and `padding-inline` the two
    // logical ones, so by name neither set holds the other. They are the same
    // four sides of one box: all four cover any of them in every writing mode,
    // and an axis covers a physical side of it wherever text runs horizontally,
    // left to right or right to left.
    it.each([
        ['px-2', 'p-4'],
        ['pe-2', 'p-4'],
        ['py-2', 'p-4'],
        ['ms-2', 'm-4'],
        ['inset-x-2', 'inset-0'],
        ['scroll-mx-2', 'scroll-m-4'],
        ['rounded-s-md', 'rounded-lg'],
        ['pl-4', 'px-2'],
        ['pr-4', 'px-2'],
        ['pt-4', 'py-2'],
        ['ml-2', 'mx-4'],
        ['left-0', 'inset-x-4'],
    ] as const)(
        '%s then %s keeps only the later class',
        async (earlier, later) => {
            expect(await merged([earlier, later])).toBe(later);
        },
        60_000,
    );

    // The worst case for the rule: a side that is covered in one direction of
    // text and not in the other. `ps-2` is the left side only left to right.
    it.each([
        ['pt-4', 'px-2'],
        ['pl-4', 'py-2'],
        ['pl-4', 'ps-2'],
        ['ps-2', 'pl-4'],
        ['p-4', 'px-2'],
        ['px-2', 'pl-4'],
        ['rounded-l-md', 'rounded-s-lg'],
    ] as const)(
        '%s then %s keeps both classes',
        async (earlier, later) => {
            expect(await merged([earlier, later])).toBe(`${earlier} ${later}`);
        },
        60_000,
    );
});

describe('a class whose compiled selector does not parse', () => {
    // Tailwind's scan finds `group-[/x]:p-4` in any file that spells it, and
    // the selector it compiles to is one postcss-selector-parser 7.1.5
    // rejects. Reading it must not stop the build: a class with no signature
    // keeps both classes, the answer the merge gives whenever it cannot prove.
    it('keeps both classes instead of failing', async () => {
        expect(await merged(['group-[/x]:p-4', 'p-8'])).toBe('group-[/x]:p-4 p-8');
    }, 60_000);
});

describe('utilities that only set a variable another utility reads', () => {
    // `space-x-reverse` sets `--tw-space-x-reverse: 1` and nothing else;
    // `space-x-4` resets it to 0 as a default and reads it. By property sets the
    // later class covers the earlier one, but the reverse utility exists to be
    // written beside the spacing one, and the stylesheet emits it after, so
    // together the element renders reversed. Dropping it loses the reversal.
    it.each([
        ['space-x-reverse', 'space-x-4'],
        ['space-y-reverse', 'space-y-4'],
        ['divide-x-reverse', 'divide-x-2'],
        ['divide-y-reverse', 'divide-y-2'],
        ['ring-inset', 'ring-2'],
    ] as const)(
        '%s then %s keeps both classes',
        async (earlier, later) => {
            expect(await merged([earlier, later])).toBe(`${earlier} ${later}`);
        },
        60_000,
    );

    // A utility that also sets a real property still loses to one that covers
    // it, and a modifier still loses to another modifier of the same variables.
    it.each([
        ['shadow-red-500', 'shadow-blue-500'],
        ['ring-red-500', 'ring-blue-500'],
        ['from-red-500', 'from-blue-500'],
        ['space-x-2', 'space-x-4'],
        ['divide-x-2', 'divide-x-4'],
        ['ring-2', 'ring-4'],
    ] as const)(
        '%s then %s keeps only the later class',
        async (earlier, later) => {
            expect(await merged([earlier, later])).toBe(later);
        },
        60_000,
    );
});

describe('the grid shorthand', () => {
    // `grid` resets the explicit and implicit grid properties and, since CSS
    // Grid Level 2, not the gutters. A class that sets `grid:` therefore covers
    // `grid-rows-*` and leaves `gap-*` alone.
    const STACK =
        '@import "tailwindcss";\n@utility stack { display: grid; grid: auto-flow / 1fr; }\n';

    it.each([
        ['gap-4', 'stack'],
        ['gap-x-4', 'stack'],
        ['gap-y-4', 'stack'],
    ] as const)(
        '%s then %s keeps both classes',
        async (earlier, later) => {
            expect(await merged([earlier, later], STACK)).toBe(`${earlier} ${later}`);
        },
        60_000,
    );

    it('still covers what it resets', async () => {
        expect(await merged(['grid-rows-2', 'stack'], STACK)).toBe('stack');
    }, 60_000);
});

describe('tokens a project declares in @theme', () => {
    const THEME = `@import "tailwindcss";
@theme {
    --color-sub: #334155;
    --color-danger: #dc2626;
    --color-brand: #2563eb;
    --color-tag-blue-bg: #dbeafe;
    --text-huge: 4rem;
    --font-display: "Display", sans-serif;
}`;

    // Nothing registers these names anywhere: the project's own Tailwind
    // compiled them, and that is all the merge needs. A later slot override
    // (`text-danger` over a `text-sub` default) used to lose to stylesheet
    // order whenever the theme had not been registered by hand.
    it.each([
        ['text-sub', 'text-danger'],
        ['bg-sub', 'bg-danger'],
        ['bg-brand', 'bg-tag-blue-bg'],
        ['text-brand', 'text-red-500'],
        ['text-brand/50', 'text-blue-600'],
        ['shadow-brand', 'shadow-danger'],
        ['font-display', 'font-sans'],
        ['text-huge', 'text-sm'],
    ] as const)(
        '%s then %s keeps only the later class',
        async (earlier, later) => {
            expect(await merged([earlier, later], THEME)).toBe(later);
        },
        60_000,
    );

    it.each([
        ['text-huge', 'text-red-500'],
        ['text-brand/50', 'text-sm'],
        ['border-brand', 'border-2'],
        ['shadow-lg', 'shadow-brand'],
        // `text-sm` sets a line height as well; a bare custom size does not.
        ['text-sm', 'text-huge'],
    ] as const)(
        '%s then %s keeps both classes',
        async (earlier, later) => {
            expect(await merged([earlier, later], THEME)).toBe(`${earlier} ${later}`);
        },
        60_000,
    );
});
