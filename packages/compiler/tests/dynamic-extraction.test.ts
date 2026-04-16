import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

/**
 * Tests for Layer-1 prescan: the compiler's CallExpression visitor extracts
 * classes from static/const dynamic() calls at build time. This allows
 * Tailwind JIT to generate CSS for these classes even in SSR contexts where
 * dynamic()'s runtime CSS injection never executes.
 */
describe('dynamic() class extraction (Layer-1 prescan)', () => {

    // ─── 1. Inline literal object ─────────────────────────────────────────────

    describe('dynamic({ ... }) — inline literal arg', () => {
        it('extracts classes from a simple inline object', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => <div className={dynamic({ p: 4, rounded: 'md' })} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('p-4')).toBe(true);
            expect(r.classes.has('rounded-md')).toBe(true);
        });

        it('extracts classes including variant modifiers', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => <div className={dynamic({ bg: 'blue-500', hover: { bg: 'blue-600' } })} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('bg-blue-500')).toBe(true);
            expect(r.classes.has('hover:bg-blue-600')).toBe(true);
        });

        it('extracts classes from arbitrary-value properties', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => <div className={dynamic({ bg: '#2dd597', w: '60%' })} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('bg-[#2dd597]')).toBe(true);
            expect(r.classes.has('w-[60%]')).toBe(true);
        });

        it('extracts multiple dynamic() calls in the same file', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => (
                    <div>
                        <span className={dynamic({ p: 2, text: 'sm' })} />
                        <span className={dynamic({ m: 4, text: 'lg' })} />
                    </div>
                );
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('p-2')).toBe(true);
            expect(r.classes.has('text-sm')).toBe(true);
            expect(r.classes.has('m-4')).toBe(true);
            expect(r.classes.has('text-lg')).toBe(true);
        });
    });

    // ─── 2. Const identifier reference ───────────────────────────────────────

    describe('dynamic(CONST) — static const reference', () => {
        it('extracts classes when arg is a const identifier', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const boxStyles = { w: 7, h: 8, rounded: 'sm' };
                const A = () => <div className={dynamic(boxStyles)} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('w-7')).toBe(true);
            expect(r.classes.has('h-8')).toBe(true);
            expect(r.classes.has('rounded-sm')).toBe(true);
        });

        it('extracts classes from const with as const assertion', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const overlayStyles = { opacity: 50, bg: 'black' } as const;
                const A = () => <div className={dynamic(overlayStyles)} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('opacity-50')).toBe(true);
            expect(r.classes.has('bg-black')).toBe(true);
        });

        it('extracts classes when const is cast with as any', () => {
            // Pattern: dynamic(CONST as any) — the TSAsExpression wrapper must be
            // unwrapped to reach the Identifier before doing the const binding lookup.
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const boxStyles = { p: 4, rounded: 'md' } as const;
                const A = () => <div className={dynamic(boxStyles as any)} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('p-4')).toBe(true);
            expect(r.classes.has('rounded-md')).toBe(true);
        });

        it('extracts classes when const is cast with a named type', () => {
            // Pattern: dynamic(CONST as SzObject) — same unwrapping path.
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const adjStyles = { w: 10, h: 6, rounded: 'sm' } as const;
                const A = () => <div className={dynamic(adjStyles as SzObject)} />;
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('w-10')).toBe(true);
            expect(r.classes.has('h-6')).toBe(true);
            expect(r.classes.has('rounded-sm')).toBe(true);
        });

        it('does not crash when identifier is imported (unresolvable)', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                import { boxStyles } from './styles';
                const A = () => <div className={dynamic(boxStyles)} />;
            `;
            // Should not throw; unresolvable identifier is silently skipped
            expect(() => transformSourceCode(src)).not.toThrow();
        });
    });

    // ─── 3. Graceful fallback for non-static args ─────────────────────────────

    describe('graceful fallback — non-static dynamic() args', () => {
        it('does not crash when arg is a runtime expression', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = ({ styles }) => <div className={dynamic(styles)} />;
            `;
            expect(() => transformSourceCode(src)).not.toThrow();
        });

        it('does not crash when arg is a function call result', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => <div className={dynamic(getStyles())} />;
            `;
            expect(() => transformSourceCode(src)).not.toThrow();
        });

        it('does not crash when arg is a ternary expression', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = ({ active }) => <div className={dynamic(active ? { bg: 'blue-500' } : { bg: 'gray-200' })} />;
            `;
            expect(() => transformSourceCode(src)).not.toThrow();
        });

        it('does not crash when object has computed/dynamic values', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const size = 4;
                const A = () => <div className={dynamic({ w: Math.round(size / 4) })} />;
            `;
            expect(() => transformSourceCode(src)).not.toThrow();
        });
    });

    // ─── 4. Co-existence with sz prop ─────────────────────────────────────────

    describe('dynamic() extraction alongside sz prop transforms', () => {
        it('collects classes from both sz and dynamic() in the same file', () => {
            const src = `
                import { dynamic } from '@csszyx/dynamic';
                const A = () => (
                    <div sz={{ p: 8 }}>
                        <span className={dynamic({ w: 7, h: 8 })} />
                    </div>
                );
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('p-8')).toBe(true);
            expect(r.classes.has('w-7')).toBe(true);
            expect(r.classes.has('h-8')).toBe(true);
        });
    });
});
