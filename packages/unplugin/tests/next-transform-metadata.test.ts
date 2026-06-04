import { createHash } from 'node:crypto';

import { transformSourceCode } from '@csszyx/compiler';
import { describe, expect, it } from 'vitest';

import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
} from '../src/next-transform-metadata.js';

describe('Next transform metadata', () => {
    it('collects generated classes separately from raw className strings', () => {
        const source = 'const App=()=> <div className="existing" sz={{ p: 4, flex: true }} />;';
        const result = transformSourceCode(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(metadata.sourceHash).toBe(createHash('sha256').update(source).digest('hex'));
        expect(metadata.classes).toEqual(['flex', 'p-4']);
        expect(metadata.rawClassNames).toEqual(['existing']);
        expect(metadata.recoveryTokenCount).toBe(0);
    });

    it('extracts static classes hidden inside runtime _sz fallback calls', () => {
        const source = 'const App=({rest})=> <div sz={{ p: 4, ...rest }} />;';
        const result = transformSourceCode(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(result.usesRuntime).toBe(true);
        expect(metadata.classes).toEqual(expect.arrayContaining(['p-4']));
    });

    it('creates safelist shard input from generated class metadata', () => {
        const source = 'const App=()=> <div className="raw" sz={{ p: 2 }} />;';
        const result = transformSourceCode(source, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/App.tsx');

        expect(createNextSafelistShardFromMetadata(metadata, 'cache-key')).toEqual({
            cacheKey: 'cache-key',
            sourcePath: '/repo/src/App.tsx',
            sourceHash: createHash('sha256').update(source).digest('hex'),
            classes: ['p-2'],
        });
    });
});
