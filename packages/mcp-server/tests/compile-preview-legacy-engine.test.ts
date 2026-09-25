/**
 * The merge note against a compiler that reports no object lists.
 *
 * An engine from before the lists existed says nothing about which classes sat
 * in one object, so the preview falls back to what it knew then: a module with
 * two or more classes could lose one to a build.
 */
import { describe, expect, it, vi } from 'vitest';

import { handleCompilePreview } from '../src/tools/compile-preview';

/** The fields the mocked engine leaves out of its result. */
const engine = vi.hoisted(() => ({ omits: ['mergeGroups', 'mergeOverrides'] }));

vi.mock('@csszyx/compiler', async importOriginal => {
    const actual = await importOriginal<typeof import('@csszyx/compiler')>();
    return {
        ...actual,
        transformSource: (...args: Parameters<typeof actual.transformSource>) => {
            const result: Record<string, unknown> = { ...actual.transformSource(...args) };
            for (const field of engine.omits) delete result[field];
            return result;
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

    // An engine that reported object lists before it reported class-name
    // pairs: a class name beside `sz` is then no reason for the note.
    it('notes nothing for a class name when the engine reports no pairs', () => {
        engine.omits = ['mergeOverrides'];
        const data = JSON.parse(
            handleCompilePreview({
                source: 'export const A = () => <div className="pb-2" sz={{ p: 4 }} />;',
            }).content[0].text,
        );
        expect(data.mergeNote).toBeUndefined();
    });
});
