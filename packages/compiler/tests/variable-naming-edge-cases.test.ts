import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

/**
 * Edge-case tests for all patterns of using named variables as sz prop values.
 *
 * Covers:
 *  - Direct reference in various declaration forms
 *  - Array syntax: variable as element, variable inside logical &&
 *  - Conditional (ternary): variable in branches
 *  - Spreads: variable spread inside szv() base, nested const chains
 *  - TypeScript annotations: as const, satisfies, explicit type
 *  - let reassignment, var, destructuring
 *  - szv() receiving variable objects
 */
describe('variable naming edge cases', () => {
    // ─── 1. Direct reference variants ────────────────────────────────────────

    describe('direct sz={var} declaration forms', () => {
        it('const without annotation', () => {
            const src = `
                const styles = { p: 4, rounded: 'lg' };
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('className="p-4 rounded-lg"');
        });

        it('const with as const', () => {
            const src = `
                const styles = { p: 4, rounded: 'lg' } as const;
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('className="p-4 rounded-lg"');
        });

        it('const with satisfies', () => {
            const src = `
                const styles = { p: 4, rounded: 'lg' } satisfies Record<string, unknown>;
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('className="p-4 rounded-lg"');
        });

        it('const with explicit type annotation', () => {
            const src = `
                const styles: { p: number; rounded: string } = { p: 4, rounded: 'lg' };
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('className="p-4 rounded-lg"');
        });

        it('let variable', () => {
            const src = `
                let styles = { p: 4, rounded: 'lg' };
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('className="p-4 rounded-lg"');
        });

        it('variable containing nested variant object', () => {
            const src = `
                const styles = { p: 4, hover: { bg: 'blue-500' } } as const;
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('hover:bg-blue-500');
        });

        it('variable that references another variable (chain)', () => {
            const src = `
                const base = { p: 4 };
                const extended = { ...base, rounded: 'lg' };
                const A = () => <div sz={extended} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('rounded-lg');
        });
    });

    // ─── 2. Array syntax — variable as element ───────────────────────────────

    describe('sz={[var, ...]} array with variable elements', () => {
        it('single variable as sole array element', () => {
            const src = `
                const base = { p: 4, rounded: 'lg' };
                const A = () => <div sz={[base]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('rounded-lg');
        });

        it('variable mixed with inline object in array', () => {
            const src = `
                const base = { p: 4 };
                const A = () => <div sz={[base, { rounded: 'lg' }]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('rounded-lg');
        });

        it('multiple variables in array', () => {
            const src = `
                const layout = { display: "flex", gap: 4 };
                const color = { bg: 'blue-500' };
                const A = () => <div sz={[layout, color]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('flex');
            expect(r.code).toContain('gap-4');
            expect(r.code).toContain('bg-blue-500');
        });

        it('variable as conditional (&&) right-hand side in array', () => {
            const src = `
                const active = { bg: 'blue-500', color: 'white' };
                const A = ({ isActive }) => <div sz={[{ p: 4 }, isActive && active]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('bg-blue-500');
        });

        it('variable as const in array conditional', () => {
            const src = `
                const active = { bg: 'blue-500' } as const;
                const A = ({ on }) => <div sz={[{ p: 4 }, on && active]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('bg-blue-500');
        });

        it('all array items are variables (no runtime expected)', () => {
            const src = `
                const layout = { display: "flex" };
                const spacing = { p: 4, gap: 2 };
                const A = () => <div sz={[layout, spacing]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('flex');
            expect(r.code).toContain('p-4');
        });
    });

    // ─── 3. Ternary: variable in branches ────────────────────────────────────

    describe('sz={cond ? varA : varB} ternary with variable branches', () => {
        it('both branches are variables', () => {
            const src = `
                const active = { bg: 'blue-500', color: 'white' };
                const inactive = { bg: 'gray-200', color: 'gray-700' };
                const A = ({ on }) => <div sz={on ? active : inactive} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('bg-blue-500');
            expect(r.code).toContain('bg-gray-200');
        });

        it('one branch is a variable, the other is inline', () => {
            const src = `
                const active = { bg: 'blue-500' };
                const A = ({ on }) => <div sz={on ? active : { bg: 'gray-200' }} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('bg-blue-500');
            expect(r.code).toContain('bg-gray-200');
        });
    });

    // ─── 4. Spread patterns ───────────────────────────────────────────────────

    describe('spread with variable override patterns', () => {
        it('sz={{ ...var }} — pure spread, no override (should use sz={var} but still works)', () => {
            const src = `
                const item = { p: 4, rounded: 'md' } as const;
                const A = () => <div sz={{ ...item }} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('rounded-md');
        });

        it('sz={{ ...var, override }}', () => {
            const src = `
                const base = { p: 4, rounded: 'md', bg: 'white' } as const;
                const A = () => <div sz={{ ...base, p: 8 }} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-8');
            expect(r.code).not.toContain('p-4');
        });

        it('spread inside array element with variable', () => {
            const src = `
                const base = { p: 4 } as const;
                const A = ({ on }) => <div sz={[{ ...base, rounded: 'lg' }, on && { bg: 'blue-500' }]} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
            expect(r.code).toContain('p-4');
            expect(r.code).toContain('rounded-lg');
        });
    });

    // ─── 5. szv() catalog extraction ─────────────────────────────────────────

    describe('szv() catalog class extraction', () => {
        it('extracts classes from szv with string variant keys', () => {
            const src = `
                import { szv } from '@csszyx/runtime';
                const btnSz = szv({
                    base: { rounded: 'md', shrink: 0 },
                    variants: {
                        size: { sm: { h: 9, px: 3 }, lg: { h: 11, px: 8 } },
                        color: { blue: { bg: 'blue-600' }, red: { bg: 'red-500' } },
                    },
                });
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('h-9')).toBe(true);
            expect(r.classes.has('h-11')).toBe(true);
            expect(r.classes.has('bg-blue-600')).toBe(true);
            expect(r.classes.has('bg-red-500')).toBe(true);
            expect(r.classes.has('rounded-md')).toBe(true);
        });

        it('extracts classes from szv with numeric variant keys', () => {
            const src = `
                import { szv } from '@csszyx/runtime';
                const boxSz = szv({
                    base: { rounded: 'sm', shrink: 0 },
                    variants: {
                        idx: {
                            0: { opacity: 50 },
                            1: { opacity: 70 },
                            2: { opacity: 90 },
                        },
                        color: { normal: { bg: '#2dd597' }, reverse: { bg: '#a78bfa' } },
                    },
                    defaultVariants: { idx: 0, color: 'normal' },
                });
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('opacity-50')).toBe(true);
            expect(r.classes.has('opacity-70')).toBe(true);
            expect(r.classes.has('opacity-90')).toBe(true);
            expect(r.classes.has('bg-[#2dd597]')).toBe(true);
            expect(r.classes.has('bg-[#a78bfa]')).toBe(true);
        });

        it('handles mixed string and numeric variant keys in same szv', () => {
            const src = `
                import { szv } from '@csszyx/runtime';
                const itemSz = szv({
                    base: { minH: 2 },
                    variants: {
                        slot: { r0: { w: 7 }, r0h: { w: 7, h: 8 }, c0: { w: '60%', h: 5 } },
                        idx:  { 0: { opacity: 50 }, 1: { opacity: 70 }, 2: { opacity: 90 } },
                    },
                });
            `;
            const r = transformSourceCode(src);
            expect(r.classes.has('w-7')).toBe(true);
            expect(r.classes.has('h-8')).toBe(true);
            expect(r.classes.has('h-5')).toBe(true);
            expect(r.classes.has('opacity-50')).toBe(true);
            expect(r.classes.has('opacity-90')).toBe(true);
        });
    });

    // ─── 6. szv() with variable objects ──────────────────────────────────────

    describe('szv() receiving variable objects', () => {
        it('szv base as variable reference', () => {
            const src = `
                import { szv } from 'csszyx';
                const base = { px: 4, py: 2, rounded: 'md' };
                const btn = szv({
                    base,
                    variants: { intent: { primary: { bg: 'blue-600', color: 'white' } } },
                });
                const A = () => <button sz={btn({ intent: 'primary' })} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
        });

        it('szv variant value as variable', () => {
            const src = `
                import { szv } from 'csszyx';
                const primary = { bg: 'blue-600', color: 'white' };
                const btn = szv({
                    base: { px: 4, py: 2 },
                    variants: { intent: { primary } },
                });
                const A = () => <button sz={btn({ intent: 'primary' })} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
        });
    });

    // ─── 6. Variables whose values can't be resolved ─────────────────────────

    describe('graceful fallback for unresolvable variable patterns', () => {
        it('imported variable falls back cleanly', () => {
            const src = `
                import { baseStyles } from './styles';
                const A = () => <div sz={baseStyles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
        });

        it('variable whose initializer is a function call falls back cleanly', () => {
            const src = `
                const styles = getStyles();
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
        });

        it('variable with runtime-conditional initializer falls back cleanly', () => {
            const src = `
                const styles = isActive ? { p: 4 } : { p: 2 };
                const A = () => <div sz={styles} />;
            `;
            const r = transformSourceCode(src);
            expect(r.code).not.toContain('[object Object]');
        });
    });

    // ─── 7. Naming conventions ────────────────────────────────────────────────

    describe('variable naming conventions all resolve', () => {
        it('camelCase name', () => {
            const src = `
                const buttonBase = { px: 4, py: 2 } as const;
                const A = () => <button sz={buttonBase} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('px-4');
        });

        it('SCREAMING_SNAKE_CASE name', () => {
            const src = `
                const CARD_STYLES = { p: 6, shadow: 'md' } as const;
                const A = () => <div sz={CARD_STYLES} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-6');
        });

        it('underscore-prefixed private convention', () => {
            const src = `
                const _item = { p: 2, rounded: 'sm' } as const;
                const A = () => <div sz={_item} />;
            `;
            const r = transformSourceCode(src);
            expect(r.usesRuntime).toBe(false);
            expect(r.code).toContain('p-2');
        });
    });
});
