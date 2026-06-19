import { describe, expect, it } from 'vitest';

import { appendTailwindSourceDirective } from '../src/unplugin';

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
});
