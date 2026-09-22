/**
 * The merge note against a compiler that reports no object lists.
 *
 * An engine from before the lists existed says nothing about which classes sat
 * in one object, so the preview falls back to what it knew then: a module with
 * two or more classes could lose one to a build.
 */
import { describe, expect, it, vi } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformSource: (...args: Parameters<typeof actual.transformSource>) => {
            const { mergeGroups: _dropped, ...rest } = actual.transformSource(...args);
            return rest;
        },
    };
});

describe('csszyx_compile_preview with an engine that reports no object lists', () => {
    it('notes the merge whenever the module holds two classes', () => {
        const data = JSON.parse(
            handleCompilePreview({
                source: 'export const A = () => <><div sz={{ p: 4 }} /><b sz={{ pb: 2 }} /></>;',
            }).content[0].text,
        );
        expect(data.classes).toEqual(['p-4', 'pb-2']);
        expect(String(data.mergeNote)).toContain('`p-4`');
    });
});
