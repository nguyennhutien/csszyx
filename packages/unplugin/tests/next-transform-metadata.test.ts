import { createHash } from 'node:crypto';

import { transformSource } from '@csszyx/compiler/engine';
import { describe, expect, it } from 'vitest';

import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
} from '../src/next-transform-metadata.js';

describe('Next transform metadata', () => {
    it('collects generated classes separately from raw className strings', () => {
        const source =
            'const App=()=> <div className="existing" sz={{ p: 4, display: "flex" }} />;';
        const result = transformSource(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
        expect(metadata.classes).toEqual(['flex', 'p-4']);
        expect(metadata.rawClassNames).toEqual(['existing']);
        expect(metadata.recoveryTokenCount).toBe(0);
    });

    it('extracts static classes hidden inside runtime _sz fallback calls', () => {
        const source = 'const App=({rest})=> <div sz={{ p: 4, ...rest }} />;';
        const result = transformSource(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(result.usesRuntime).toBe(true);
        expect(metadata.classes).toEqual(expect.arrayContaining(['p-4']));
    });

    it('creates safelist shard input from generated class metadata', () => {
        const source = 'const App=()=> <div className="raw" sz={{ p: 2 }} />;';
        const result = transformSource(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(createNextSafelistShardFromMetadata(metadata, 'cache-key')).toEqual({
            cacheKey: 'cache-key',
            sourcePath: '/repo/src/App.tsx',
            sourceHash: createHash('sha256').update(source).digest('hex'),
            classes: ['p-2'],
            authoredClasses: ['raw'],
            mergeLiterals: [],
            classSites: metadata.classSites,
        });
    });

    it('places each class at the key it was lowered from, as the Vite lane does', () => {
        // The dead-class line of a Next command names the line, column and
        // key, so the shard carries them from the first pass.
        const source = "const App=()=> <div sz={{ break: 'bogus', p: 4 }} />;";
        const result = transformSource(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');
        const column = source.indexOf('break') + 1;

        expect(metadata.classSites).toEqual([
            { className: 'break-bogus', line: 1, column, key: 'break' },
            { className: 'p-4', line: 1, column: source.indexOf('p: 4') + 1, key: 'p' },
        ]);
        expect(createNextSafelistShardFromMetadata(metadata).classSites).toEqual(
            metadata.classSites,
        );
    });

    it('places the class of a one-class object too', () => {
        const source = "const App=()=> <div sz={{ justify: 'safe-center' }} />;";
        const result = transformSource(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.classSites).toEqual([
            {
                className: 'justify-safe-center',
                line: 1,
                column: source.indexOf('justify') + 1,
                key: 'justify',
            },
        ]);
    });
});
