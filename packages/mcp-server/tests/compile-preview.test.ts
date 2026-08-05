import { describe, expect, it } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';

/**
 * Parse the tool's single text payload.
 *
 * @param source - Source module to compile.
 * @returns The decoded preview payload.
 */
function preview(source: string): Record<string, unknown> {
    return JSON.parse(handleCompilePreview({ source }).content[0].text);
}

describe('csszyx_compile_preview', () => {
    it('reports the classes a sz prop compiles to, in emission order', () => {
        const data = preview('export const A = () => <div sz={{ p: 4, bg: "blue-500" }} />;');
        expect(data.classes).toEqual(['p-4', 'bg-blue-500']);
    });

    it('reports the rewritten source', () => {
        const data = preview('export const A = () => <div sz={{ p: 4 }} />;');
        expect(data.code).toContain('className="p-4"');
    });

    it('reports that a module without sz was left alone', () => {
        const source = 'export const A = () => <div className="p-4" />;';
        expect(preview(source)).toMatchObject({ transformed: false, code: source });
    });

    it('surfaces the diagnostic an unknown sz key produces', () => {
        const data = preview('export const A = () => <div sz={{ paddng: 4 }} />;');
        expect(data.diagnostics).toContainEqual(expect.stringContaining('paddng'));
    });

    // The class ships even though nothing styles it — decision 0001 keeps the
    // pass-through so a utility newer than csszyx still reaches Tailwind. A
    // preview that showed the class without the warning would read as success.
    it('reports the dead class an unknown sz key still emits', () => {
        const data = preview('export const A = () => <div sz={{ paddng: 4 }} />;');
        expect(data.classes).toEqual(['paddng-4']);
    });

    it('reports the classes a szv factory contributes', () => {
        const data = preview(
            `import { szv } from '@csszyx/runtime';
             const box = szv({ variants: { pad: { sm: { p: 2 }, lg: { p: 8 } } } });
             export const A = () => <div className={box({ pad: 'lg' })} />;`,
        );
        expect(data.classes).toContain('p-8');
    });

    it('reports the runtime helper a dynamic spacing value falls back to', () => {
        const data = preview('export const A = ({ p }) => <div sz={{ p }} />;');
        expect(data.runtimeHelpers).toEqual(['__szSpacingVar']);
    });
});
