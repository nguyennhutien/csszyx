import { transform } from '@csszyx/compiler';
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

/**
 * Compiles utility candidates against the real Tailwind theme.
 * @param candidates - Utility class candidates to compile.
 * @returns The generated CSS.
 */
async function buildCss(candidates: string[]): Promise<string> {
    const compiler = await compile(
        '@import "tailwindcss/theme.css"; @import "tailwindcss/utilities.css";',
        { base: process.cwd(), onDependency() {} },
    );
    return compiler.build(candidates);
}

describe('Tailwind 4.3 compatibility', () => {
    it('compiles csszyx candidates with Tailwind 4.3 semantics', async () => {
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
            '[&[data-a="x"][data-b=\'y\']]:text-sm',
        ]);

        expect(css).toContain('grid-auto-columns: calc(var(--spacing) * 12)');
        expect(css).toContain('grid-auto-rows: calc(var(--spacing) * 16)');
        expect(css).toContain('font-size: calc(var(--spacing) * 4)');
        expect(css).toContain('color: color-mix(in oklab, var(--color-brand) 50%, transparent)');
        expect(css).toContain('margin: 0');
        expect(css).toContain('margin: var(--spacing)');
        expect(css).toContain('.tab-item-header');
        // Tailwind 4.3.2 printed the zero as `0`, 4.3.3 prints `0px`; both
        // resolve identically, so accept either spelling.
        expect(css).toMatch(/padding-block: 0(px)? !important/);
        // 4.3.2 emitted a nested `&>span` block; 4.3.3 flattens the arbitrary
        // variant into the selector itself (`.\[...\] > span {`). Both target
        // the same child combinator.
        expect(css).toMatch(/&>span|> span\s*\{/);
        expect(css).toContain('[data-a="x"]');
        expect(css).toContain("[data-b='y']");
    });

    it('applies fractional opacity modifiers to named shadow sizes (4.3.3, sz → class → CSS)', async () => {
        // Chain the real sz transform into the real Tailwind compiler so the
        // whole sz ↔ TW ↔ CSS contract is exercised, not hardcoded classes.
        const candidates = [
            { shadow: 'sm/12.5' },
            { textShadow: 'sm/12.5' },
            { dropShadow: 'sm/12.5' },
            { insetShadow: 'sm/12.5' },
            { shadow: '2xl/50' },
        ].map(sz => transform(sz).className);
        expect(candidates).toEqual([
            'shadow-sm/12.5',
            'text-shadow-sm/12.5',
            'drop-shadow-sm/12.5',
            'inset-shadow-sm/12.5',
            'shadow-2xl/50',
        ]);

        const css = await buildCss(candidates);
        // Each family stores the modifier on its own alpha variable.
        expect(css).toContain('--tw-shadow-alpha: 12.5%');
        expect(css).toContain('--tw-text-shadow-alpha: 12.5%');
        expect(css).toContain('--tw-drop-shadow-alpha: 12.5%');
        expect(css).toContain('--tw-inset-shadow-alpha: 12.5%');
        expect(css).toContain('--tw-shadow-alpha: 50%');
        // The named-size shadow itself keeps the fractional alpha inline.
        expect(css).toMatch(/\.shadow-sm\\\/12\\\.5 \{/);
    });

    it('resolves shadow-family var colors through the color: hint (sz → class → CSS)', async () => {
        const candidates = [
            { shadowColor: { color: '--c', op: 50 } },
            { insetShadowColor: { color: '--c', op: 30 } },
            { textShadowColor: '--c' },
            { dropShadowColor: '--c' },
        ].map(sz => transform(sz as never).className);
        expect(candidates).toEqual([
            'shadow-(color:--c)/50',
            'inset-shadow-(color:--c)/30',
            'text-shadow-(color:--c)',
            'drop-shadow-(color:--c)',
        ]);

        const css = await buildCss(candidates);
        // The hint lands each var on the family's color variable — a bare
        // `shadow-(--c)` would instead replace the shadow value entirely.
        expect(css).toContain('--tw-shadow-color: var(--c)');
        expect(css).toContain('--tw-inset-shadow-color: var(--c)');
        expect(css).toContain('--tw-text-shadow-color: var(--c)');
        expect(css).toContain('--tw-drop-shadow-color: var(--c)');
        // The opacity modifier survives as a color-mix percentage.
        expect(css).toContain('color-mix(in oklab, var(--c) 50%, transparent)');
        expect(css).toContain('color-mix(in oklab, var(--c) 30%, transparent)');
    });

    it('keeps --spacing(0) a length so calc() stays valid (4.3.3)', async () => {
        const className = transform({ text: '--spacing(0)' }).className;
        expect(className).toBe('text-[--spacing(0)]');
        const css = await buildCss([className]);
        // 4.3.2 optimized the zero to unitless `0`, which is invalid inside
        // calc(); 4.3.3 emits `0px`.
        expect(css).toContain('font-size: 0px');
    });

    it('documents that Tailwind drops an opacity modifier on shadow-none', async () => {
        // `{ shadow: 'none/50' }` passes through as shadow-none/50, but the
        // `none` keyword takes no modifier — Tailwind generates no rule, so
        // the class is silently inert. Garbage in, nothing out.
        const css = await buildCss(['shadow-none/50']);
        expect(css).not.toContain('shadow-none');
    });
});
