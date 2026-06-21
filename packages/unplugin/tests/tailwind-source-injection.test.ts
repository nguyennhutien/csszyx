import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    appendTailwindSourceDirective,
    computeSafelistRelPath,
    cssImportsTailwind,
    hasInjectableTailwindCandidate,
} from '../src/unplugin';

/**
 * The `@source "./csszyx-classes.html"` directive is how csszyx makes its
 * generated class list visible to Tailwind v4 (the safelist file is not
 * imported anywhere, so Tailwind never scans it otherwise). The previous
 * implementation spliced the directive next to the `@import "tailwindcss…"`
 * line with a regex that required the closing quote to be immediately followed
 * by `;`. The split / manual Tailwind v4 setup (`layer(...)` / `source(...)`
 * options, or no trailing `;`) did not match, so the injection silently no-oped
 * and every csszyx-only class got no CSS. These tests lock the form-independent
 * append behaviour so that regression cannot return.
 */
describe('appendTailwindSourceDirective', () => {
    const REL = './csszyx-classes.html';
    const directive = `@source "${REL}";`;

    const importForms: Array<[string, string]> = [
        ['bare tailwindcss', '@import "tailwindcss";'],
        ['utilities split', '@import "tailwindcss/utilities.css";'],
        ['single quotes', "@import 'tailwindcss/utilities.css';"],
        // The forms the old import-anchored regex missed:
        ['layer() option', '@import "tailwindcss/utilities.css" layer(utilities);'],
        ['source() option', '@import "tailwindcss/utilities.css" source("../src");'],
        ['no trailing semicolon', '@import "tailwindcss/utilities.css"'],
        [
            'multi-import (theme + utilities)',
            [
                '@layer theme, base, utilities;',
                '@import "tailwindcss/theme.css" layer(theme);',
                '@import "tailwindcss/utilities.css" layer(utilities);',
            ].join('\n'),
        ],
    ];

    for (const [label, css] of importForms) {
        it(`appends @source for: ${label}`, () => {
            const out = appendTailwindSourceDirective(css, REL);
            expect(out).not.toBeNull();
            expect(out as string).toContain(directive);
            // The original content is preserved verbatim ahead of the directive.
            expect((out as string).startsWith(css)).toBe(true);
        });
    }

    it('is idempotent — does not stack the directive on re-run', () => {
        const css = '@import "tailwindcss/utilities.css" layer(utilities);';
        const once = appendTailwindSourceDirective(css, REL) as string;
        expect(once).toContain(directive);
        // Feeding the already-injected output back in must be a no-op.
        const twice = appendTailwindSourceDirective(once, REL);
        expect(twice).toBeNull();
    });

    it('normalises trailing newline (no blank-line stacking)', () => {
        const withNl = appendTailwindSourceDirective('@import "tailwindcss";\n', REL) as string;
        expect(withNl).toBe(`@import "tailwindcss";\n${directive}\n`);
        const withoutNl = appendTailwindSourceDirective('@import "tailwindcss";', REL) as string;
        expect(withoutNl).toBe(`@import "tailwindcss";\n${directive}\n`);
    });

    it('preserves the exact relative path it is given', () => {
        const out = appendTailwindSourceDirective(
            '@import "tailwindcss";',
            '../../csszyx-classes.html',
        ) as string;
        expect(out).toContain('@source "../../csszyx-classes.html";');
    });

    it('treats empty input safely', () => {
        const out = appendTailwindSourceDirective('', REL) as string;
        expect(out).toBe(`${directive}\n`);
    });
});

/**
 * Gap A: the @source target is a relative path computed from the CSS file's
 * location to the project-root safelist file. A wrong path makes Tailwind
 * silently scan nothing (no error, no CSS) — the exact symptom of the bug this
 * whole fix addresses — so the computation is covered directly.
 */
describe('computeSafelistRelPath', () => {
    const root = path.sep === '\\' ? 'C:\\proj' : '/proj';
    const file = 'csszyx-classes.html';
    const at = (...segs: string[]): string => path.join(root, ...segs);

    it('CSS at the project root → ./<file>', () => {
        expect(computeSafelistRelPath(root, file, at('app.css'))).toBe(`./${file}`);
    });

    it('CSS in src/ → ../<file>', () => {
        expect(computeSafelistRelPath(root, file, at('src', 'app.css'))).toBe(`../${file}`);
    });

    it('CSS nested two levels deep → ../../<file>', () => {
        expect(computeSafelistRelPath(root, file, at('src', 'styles', 'app.css'))).toBe(
            `../../${file}`,
        );
    });

    it('always returns a posix, dot-prefixed relative path', () => {
        const rel = computeSafelistRelPath(root, file, at('src', 'app.css'));
        expect(rel.startsWith('.')).toBe(true);
        expect(rel).not.toContain('\\');
    });
});

/**
 * Gap C: the injection gate must recognise a real tailwindcss import for every
 * v4 form, while not firing on a commented-out import or a different package
 * whose name merely starts with "tailwindcss" (both previously matched a loose
 * substring check). A false negative here re-creates the no-CSS bug, so the
 * "must match" set guards against regression.
 */
describe('cssImportsTailwind', () => {
    const matches = [
        '@import "tailwindcss";',
        '@import "tailwindcss/utilities.css";',
        "@import 'tailwindcss/utilities.css';",
        '@import "tailwindcss/utilities.css" layer(utilities);',
        '@import "tailwindcss/utilities.css" source("../src");',
        '@import "tailwindcss/utilities.css"',
        '@import  "tailwindcss" ;',
        '@layer x;\n@import "tailwindcss/theme.css" layer(theme);',
    ];
    const nonMatches = [
        '/* @import "tailwindcss"; */ .x { color: red }',
        '@import "tailwindcss-animate";',
        '@import "tailwindcss-preset-x";',
        '.foo { color: red }',
    ];

    for (const css of matches) {
        it(`detects a real import: ${JSON.stringify(css.slice(0, 48))}`, () => {
            expect(cssImportsTailwind(css)).toBe(true);
        });
    }
    for (const css of nonMatches) {
        it(`ignores: ${JSON.stringify(css.slice(0, 48))}`, () => {
            expect(cssImportsTailwind(css)).toBe(false);
        });
    }
});

/**
 * Gap B: injection only happens when there is a real Tailwind candidate to
 * generate — an empty set or pure mangled symbols must not trigger a directive.
 */
describe('hasInjectableTailwindCandidate', () => {
    it('false for an empty set', () => {
        expect(hasInjectableTailwindCandidate(new Set())).toBe(false);
    });

    it('false when every class is too short or non-alpha', () => {
        expect(hasInjectableTailwindCandidate(new Set(['a', '1', '_', '/x']))).toBe(false);
    });

    it('true when at least one real candidate is present', () => {
        expect(hasInjectableTailwindCandidate(new Set(['q0', 'bg-primary/50']))).toBe(true);
    });
});
