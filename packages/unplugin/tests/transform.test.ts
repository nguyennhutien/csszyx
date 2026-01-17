import { transformSourceCode } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

/**
 * Tests for the compiler's transformSourceCode function as used by the unplugin.
 *
 * The pre-plugin calls transformSourceCode() on .tsx/.jsx files containing
 * sz props. These tests verify the AST transform produces correct output.
 */
describe('transformSourceCode (compiler AST transform)', () => {
    describe('static string sz prop', () => {
        it('should convert sz="..." to className="..."', () => {
            const source = 'const el = <div sz="p-4 bg-red-500" />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4 bg-red-500');
            expect(result.code).not.toContain(' sz=');
        });
    });

    describe('static object sz prop', () => {
        it('should compile static sz object to className string', () => {
            const source = 'const el = <div sz={{ p: 4, bg: "red-500" }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('bg-red-500');
        });

        it('should handle nested variant objects', () => {
            const source = 'const el = <div sz={{ p: 4, hover: { bg: "blue-600" } }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('hover:bg-blue-600');
        });

        it('should handle multiple properties', () => {
            const source = 'const el = <div sz={{ m: 2, p: 4, text: "lg", font: "bold" }} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('m-2');
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('text-lg');
            expect(result.code).toContain('font-bold');
        });
    });

    describe('dynamic sz prop (runtime fallback)', () => {
        it('should wrap dynamic expressions with _sz()', () => {
            const source = 'const el = <div sz={dynamicStyles} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(dynamicStyles)');
            expect(result.code).toContain('className=');
        });

        it('should wrap function call with _sz()', () => {
            const source = 'const el = <div sz={getStyles()} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.usesRuntime).toBe(true);
            expect(result.code).toContain('_sz(getStyles())');
        });
    });

    describe('files without sz', () => {
        it('should skip files without sz keyword', () => {
            const source = 'const el = <div className="p-4" />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(false);
            expect(result.usesRuntime).toBe(false);
            expect(result.code).toBe(source);
        });

        it('should skip plain JS files', () => {
            const source = 'export const config = { key: "value" };';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(false);
            expect(result.code).toBe(source);
        });
    });

    describe('edge cases', () => {
        it('should handle multiple sz props in same file', () => {
            const source = `
const a = <div sz={{ p: 4 }} />;
const b = <span sz="text-lg" />;
`;
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('p-4');
            expect(result.code).toContain('text-lg');
        });

        it('should handle sz with empty object', () => {
            const source = 'const el = <div sz={{}} />;';
            const result = transformSourceCode(source);
            expect(result.transformed).toBe(true);
            expect(result.code).toContain('className=');
        });
    });
});

/**
 * Tests for the unplugin's class extraction and mangling pipeline.
 * These test the regex-based extractClasses and mangleClasses used
 * inside the plugin transform hook.
 */
describe('unplugin class extraction & mangling', () => {
    // Simulate the plugin's extractClasses logic
    /**
     * Extracts CSS class names from source code strings.
     * @param code - The source code to extract classes from
     * @returns Set of extracted class names
     */
    function extractClasses(code: string): Set<string> {
        const classes = new Set<string>();
        const classPattern = /(?:class(?:Name)?|sz)[:=]\s*["']([^"']*)["']/g;
        let match;
        while ((match = classPattern.exec(code)) !== null) {
            const parts = match[1].split(/\s+/).filter(Boolean);
            for (const cls of parts) {
                classes.add(cls);
            }
        }
        return classes;
    }

    it('should extract className values', () => {
        const code = 'className="p-4 bg-red-500 text-white"';
        const classes = extractClasses(code);
        expect(classes).toContain('p-4');
        expect(classes).toContain('bg-red-500');
        expect(classes).toContain('text-white');
    });

    it('should extract class values', () => {
        const code = 'class="flex items-center"';
        const classes = extractClasses(code);
        expect(classes).toContain('flex');
        expect(classes).toContain('items-center');
    });

    it('should extract from multiple occurrences', () => {
        const code = `
className="p-4 m-2"
className="text-lg font-bold"
`;
        const classes = extractClasses(code);
        expect(classes.size).toBe(4);
        expect(classes).toContain('p-4');
        expect(classes).toContain('m-2');
        expect(classes).toContain('text-lg');
        expect(classes).toContain('font-bold');
    });

    it('should deduplicate classes', () => {
        const code = `
className="p-4 bg-red-500"
className="p-4 text-white"
`;
        const classes = extractClasses(code);
        expect(classes.size).toBe(3); // p-4, bg-red-500, text-white
    });
});
