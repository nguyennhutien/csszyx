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

    // A project whose stylesheet sets `prefix(tw)` serves `tw:p-4`; a preview
    // without the prefix would show classes that style nothing there.
    it('writes the Tailwind prefix it is given before every class, and says which it used', () => {
        const data = JSON.parse(
            handleCompilePreview({
                source: 'export const A = () => <div sz={{ p: 4, bg: "blue-500" }} />;',
                classPrefix: 'tw',
            }).content[0].text,
        );
        expect(data.classes).toEqual(['tw:p-4', 'tw:bg-blue-500']);
        expect(data.classPrefix).toBe('tw');
    });

    it('says when no prefix was given, since the project may set one', () => {
        const data = preview('export const A = () => <div sz={{ p: 4 }} />;');
        expect(data.classPrefix).toBeNull();
        expect(String(data.note)).toContain('classPrefix');
    });

    // The build merges a later key over an earlier one it covers, from the
    // project's stylesheet, which the preview does not have.
    it('says the classes are unmerged when a build could drop one of them', () => {
        const data = preview('export const A = () => <div sz={{ pb: 2, p: 4 }} />;');
        expect(data.classes).toEqual(['pb-2', 'p-4']);
        expect(String(data.mergeNote)).toContain('`p-4`');
    });

    it('says the classes are unmerged when a class name sits beside an sz', () => {
        const data = preview('export const A = () => <div className="pb-2" sz={{ p: 4 }} />;');
        expect(String(data.mergeNote)).toContain('className');
    });

    // Two elements never merge with each other, whatever their classes cover.
    it('adds no merge note when no object holds two classes', () => {
        expect(
            preview('export const A = () => <><div sz={{ p: 4 }} /><b sz={{ pb: 2 }} /></>;'),
        ).not.toHaveProperty('mergeNote');
    });

    it('adds no merge note for a single class', () => {
        expect(preview('export const A = () => <div sz={{ p: 4 }} />;')).not.toHaveProperty(
            'mergeNote',
        );
    });

    it('reports the runtime helper a dynamic spacing value falls back to', () => {
        const data = preview('export const A = ({ p }) => <div sz={{ p }} />;');
        expect(data.runtimeHelpers).toEqual(['__szSpacingVar']);
    });
});
