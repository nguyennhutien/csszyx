import { describe, expect, it } from 'vitest';

import { transformSourceCode } from '../src/transform.js';

describe('sz array syntax', () => {
    describe('fully static arrays', () => {
        it('all static objects → merged className string, zero runtime', () => {
            const source = 'const A = () => <div sz={[{ display: "flex" }, { p: 4 }]} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className="flex p-4"');
            expect(result.usesRuntime).toBe(false);
            expect(result.usesMerge).toBe(false);
        });

        it('single static object in array → no runtime', () => {
            const source = 'const A = () => <div sz={[{ bg: "blue-500", text: "white" }]} />';
            const result = transformSourceCode(source);
            expect(result.code).toContain('className="bg-blue-500 text-white"');
            expect(result.usesMerge).toBe(false);
        });

        it('empty array → className={undefined} (no class attribute)', () => {
            const source = 'const A = () => <div sz={[]} />';
            const result = transformSourceCode(source);
            expect(result.code).toContain('className={undefined}');
            expect(result.code).not.toContain('className=""');
            expect(result.usesMerge).toBe(false);
        });

        it('array with only null/false elements → className={undefined}', () => {
            const source = 'const A = () => <div sz={[false, null]} />';
            const result = transformSourceCode(source);
            expect(result.code).toContain('className={undefined}');
            expect(result.code).not.toContain('className=""');
            expect(result.usesMerge).toBe(false);
        });
    });

    describe('conditional arrays', () => {
        it('condition && szObject → szcn with compiled string', () => {
            const source =
                'const A = () => <div sz={[{ display: "flex" }, isActive && { bg: "blue-500" }]} />';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('szcn');
            expect(result.code).toContain('"flex"');
            expect(result.code).toContain('"bg-blue-500"');
            expect(result.usesSzcn).toBe(true);
        });

        it('multiple conditions → szcn with all compiled parts', () => {
            const source = `const A = () => <div sz={[
                { display: "flex", p: 4 },
                isActive && { bg: "blue-500" },
                isDisabled && { opacity: 50, cursor: "not-allowed" },
            ]} />`;
            const result = transformSourceCode(source);
            expect(result.code).toContain('szcn');
            expect(result.code).toContain('"flex p-4"');
            expect(result.code).toContain('"bg-blue-500"');
            expect(result.code).toContain('"opacity-50 cursor-not-allowed"');
            expect(result.usesSzcn).toBe(true);
        });

        it('classes are collected for Tailwind JIT', () => {
            const source = `const A = () => <div sz={[
                { display: "flex" },
                isActive && { bg: "blue-500" },
            ]} />`;
            const result = transformSourceCode(source);
            expect(result.classes.has('flex')).toBe(true);
            expect(result.classes.has('bg-blue-500')).toBe(true);
        });
    });

    describe('array with variants', () => {
        it('nested variant objects compile correctly in array', () => {
            const source = `const A = () => <div sz={[
                { hover: { bg: "blue-600" }, p: 4 },
                isActive && { bg: "blue-500" },
            ]} />`;
            const result = transformSourceCode(source);
            expect(result.code).toContain('hover:bg-blue-600');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('bg-blue-500');
        });
    });

    describe('usesSzcn flag in unplugin-compatible return', () => {
        it('usesSzcn false when no array with conditions', () => {
            const source = 'const A = () => <div sz={{ p: 4 }} />';
            const result = transformSourceCode(source);
            expect(result.usesSzcn).toBe(false);
        });

        it('usesSzcn true only when conditional array elements present', () => {
            const source = 'const A = () => <div sz={[{ p: 4 }, isX && { m: 2 }]} />';
            const result = transformSourceCode(source);
            expect(result.usesSzcn).toBe(true);
            expect(result.usesMerge).toBe(false);
        });
    });
});
