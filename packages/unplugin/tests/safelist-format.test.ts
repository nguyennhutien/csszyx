import { createRequire } from 'node:module';
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';
import { renderSafelistFile, SAFELIST_HEADER } from '../src/safelist-format.js';

/**
 * `@tailwindcss/oxide` is not a direct dependency of this package; it ships
 * with `@tailwindcss/node`, so resolve it from that package's location. The
 * test needs the real scanner, not the compiler alone: the question under
 * test is what Tailwind EXTRACTS from the bytes csszyx writes, and only the
 * scanner answers that.
 */
const tailwindNodeRequire = createRequire(
    createRequire(import.meta.url).resolve('@tailwindcss/node'),
);
const { Scanner } = tailwindNodeRequire('@tailwindcss/oxide') as {
    Scanner: new (options: {
        sources: never[];
    }) => {
        scanFiles(files: Array<{ content: string; extension: string }>): string[];
    };
};

/**
 * Every shape the safelist has to carry through the scanner unchanged:
 * child-combinator utilities, pseudo-element and state variants, and
 * arbitrary variants whose bytes an HTML attribute would have to escape.
 */
const CANDIDATES = [
    'space-y-4',
    'divide-y',
    'hover:bg-red-500',
    'group-hover:text-sm',
    'peer-checked:underline',
    'md:flex',
    'before:block',
    'after:content-["→"]',
    "after:content-['{']",
    '*:p-2',
    '**:m-1',
    'has-[:checked]:ring',
    '[&>span]:text-sm',
    '[&_p]:m-2',
    '[&:nth-child(3)]:p-1',
    '[&[data-a="x"][data-b=\'y\']]:text-sm',
];

/**
 * @param content - safelist file bytes
 * @param extension - file extension the scanner is told about
 * @returns the candidates Tailwind's scanner extracts from those bytes
 */
function scan(content: string, extension: string): string[] {
    // A Scanner remembers candidates across calls, so each scan gets its own.
    return new Scanner({ sources: [] }).scanFiles([{ content, extension }]);
}

describe('safelist file format', () => {
    it('is plain text: a header and one candidate per line, no markup', () => {
        const content = renderSafelistFile(CANDIDATES);
        expect(content.startsWith(SAFELIST_HEADER)).toBe(true);
        expect(content).toBe(`${SAFELIST_HEADER}${CANDIDATES.join('\n')}\n`);
        expect(content).not.toContain('<div');
        expect(content).not.toContain('&amp;');
        expect(content).not.toContain('&gt;');
        expect(content).not.toContain('&quot;');
    });

    it('renders only the header for an empty set', () => {
        expect(renderSafelistFile([])).toBe(SAFELIST_HEADER);
    });

    it.each(['html', 'txt'])(
        'hands every candidate to the scanner byte-for-byte as .%s',
        extension => {
            const found = new Set(scan(renderSafelistFile(CANDIDATES), extension));
            for (const candidate of CANDIDATES) {
                expect(found.has(candidate), `scanner dropped ${candidate}`).toBe(true);
            }
            // No escaped ghost of an arbitrary variant may survive: the scanner
            // must see `[&>span]`, never `[&gt;span]`.
            for (const candidate of found) {
                expect(candidate, 'escaped ghost candidate').not.toMatch(/&(amp|gt|lt|quot);/);
            }
        },
    );

    it('lets Tailwind generate parent-child and pseudo-element CSS from the scanned lines', async () => {
        const compiler = await compile('@import "tailwindcss";', {
            base: process.cwd(),
            onDependency() {},
        });
        const css = compiler.build(scan(renderSafelistFile(CANDIDATES), 'txt'));

        // Child combinators come from the class name, not from the file's
        // element structure.
        expect(css).toContain('.space-y-4');
        expect(css).toContain(':not(:last-child)');
        expect(css).toContain('.divide-y');
        expect(css).toMatch(/> span\s*\{/);
        expect(css).toContain(':nth-child(3)');
        expect(css).toContain('[data-a="x"]');
        // Pseudo-elements and states.
        expect(css).toContain('::after');
        expect(css).toContain('content: "→"');
        expect(css).toContain("content: '{'");
        expect(css).toContain('::before');
        expect(css).toContain(':hover');
        expect(css).toContain(':checked');
        expect(css).toContain('.has-\\[\\:checked\\]\\:ring');
        expect(css).toContain('.md\\:flex');
    });
});
