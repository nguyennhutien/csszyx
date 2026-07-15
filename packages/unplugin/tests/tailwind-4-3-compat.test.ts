import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

describe('Tailwind 4.3 compatibility', () => {
    it('compiles csszyx candidates with Tailwind 4.3.2 semantics', async () => {
        const compiler = await compile(
            '@import "tailwindcss"; @theme { --spacing: 0.25rem; --color-brand: oklch(60% 0.2 250); }',
            { base: process.cwd(), onDependency() {} },
        );
        const css = compiler.build([
            'auto-cols-12',
            'auto-rows-16',
            'text-[--spacing(4)]',
            'text-[--alpha(var(--color-brand)_/_50%)]',
            'm-0',
            'm-1',
            '[&_.tab-item-header]:py-0!',
            '[&>span]:text-sm',
        ]);

        expect(css).toContain('grid-auto-columns: calc(var(--spacing) * 12)');
        expect(css).toContain('grid-auto-rows: calc(var(--spacing) * 16)');
        expect(css).toContain('font-size: calc(var(--spacing) * 4)');
        expect(css).toContain('color: color-mix(in oklab, var(--color-brand) 50%, transparent)');
        expect(css).toContain('margin: 0');
        expect(css).toContain('margin: var(--spacing)');
        expect(css).toContain('.tab-item-header');
        expect(css).toContain('padding-block: 0 !important');
        expect(css).toContain('&>span');
    });
});
