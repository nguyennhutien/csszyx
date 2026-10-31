/**
 * The batched module-link recorders answer exactly what the one-file
 * recorders did, in the same order.
 *
 * The walk now records every file's szv factories and forwards with one
 * engine call per question, a demanded provider and a watched file with one
 * parse each. The registry and the forward index are maps, and a consumer may
 * iterate them, so the order files land in is part of the answer: it must be
 * the walk's, whichever batch a file went to.
 */
import { describe, expect, it } from 'vitest';

import {
    type CrossModuleForwardIndex,
    recordCrossModuleForwards,
    recordModuleLinksOf,
    recordSzObjectProvider,
    recordSzObjectRegistryFile,
    recordSzvRegistryFile,
    refreshModuleLinksOf,
    type SzvCrossModuleRegistry,
} from '../src/cross-module-registry.js';

/** Files in walk order, factories and forwards interleaved with plain modules. */
const FILES = [
    { filePath: '/p/src/barrel.ts', content: "export { card } from './card';\n" },
    {
        filePath: '/p/src/button.ts',
        content:
            "import { szv } from 'csszyx';\nexport const button = szv({ base: { p: 4 } });\nexport { tone } from './tone';\n",
    },
    { filePath: '/p/src/plain.ts', content: 'export const n = 1;\n' },
    { filePath: '/p/src/card.ts', content: 'export const card = { p: 2 };\n' },
    {
        filePath: '/p/src/badge.ts',
        content: "import { szv } from 'csszyx';\nexport const badge = szv({ base: { m: 1 } });\n",
    },
    {
        filePath: '/p/src/index.ts',
        content: "export * from './barrel';\nexport { n } from './plain';\n",
    },
];

/**
 * The registry and the index as data, iteration order included.
 *
 * @param registry - The registry.
 * @param index - The forward index.
 * @returns Both, as arrays of entries.
 */
function snapshot(registry: SzvCrossModuleRegistry, index: CrossModuleForwardIndex): unknown {
    return { registry: [...registry], index: [...index] };
}

describe('the batched module-link recorders', () => {
    it('record the walk as the one-file recorders did, in walk order', () => {
        const oneByOne: SzvCrossModuleRegistry = new Map();
        const oneByOneIndex: CrossModuleForwardIndex = new Map();
        for (const file of FILES) {
            recordSzvRegistryFile(oneByOne, file.filePath, file.content);
            recordCrossModuleForwards(oneByOneIndex, file.filePath, file.content);
        }
        const batched: SzvCrossModuleRegistry = new Map();
        const batchedIndex: CrossModuleForwardIndex = new Map();
        recordModuleLinksOf(batched, batchedIndex, FILES);

        expect(snapshot(batched, batchedIndex)).toEqual(snapshot(oneByOne, oneByOneIndex));
        expect([...batchedIndex.keys()]).toEqual([
            '/p/src/barrel.ts',
            '/p/src/button.ts',
            '/p/src/index.ts',
        ]);
    });

    it('record a demanded provider as the two one-file recorders did', () => {
        for (const file of FILES) {
            const separate: SzvCrossModuleRegistry = new Map();
            const separateIndex: CrossModuleForwardIndex = new Map();
            recordSzObjectRegistryFile(separate, file.filePath, file.content);
            recordCrossModuleForwards(separateIndex, file.filePath, file.content);
            const one: SzvCrossModuleRegistry = new Map();
            const oneIndex: CrossModuleForwardIndex = new Map();
            recordSzObjectProvider(one, oneIndex, file.filePath, file.content);

            expect(snapshot(one, oneIndex), file.filePath).toEqual(
                snapshot(separate, separateIndex),
            );
        }
    });

    it.each([true, false])(
        'refresh a watched file as the three recorders did, sz objects %s',
        szObjects => {
            for (const file of FILES) {
                const separate: SzvCrossModuleRegistry = new Map();
                const separateIndex: CrossModuleForwardIndex = new Map();
                recordSzvRegistryFile(separate, file.filePath, file.content);
                recordCrossModuleForwards(separateIndex, file.filePath, file.content);
                if (szObjects) recordSzObjectRegistryFile(separate, file.filePath, file.content);
                const one: SzvCrossModuleRegistry = new Map();
                const oneIndex: CrossModuleForwardIndex = new Map();
                refreshModuleLinksOf(one, oneIndex, {
                    filePath: file.filePath,
                    content: file.content,
                    szObjects,
                });

                expect(snapshot(one, oneIndex), file.filePath).toEqual(
                    snapshot(separate, separateIndex),
                );
            }
        },
    );

    it('drop what a file no longer exports, as the one-file recorders did', () => {
        const registry: SzvCrossModuleRegistry = new Map();
        const index: CrossModuleForwardIndex = new Map();
        recordModuleLinksOf(registry, index, FILES);
        recordModuleLinksOf(
            registry,
            index,
            FILES.map(file => ({ ...file, content: 'export const gone = 0;\n' })),
        );

        expect(snapshot(registry, index)).toEqual({ registry: [], index: [] });
    });
});
