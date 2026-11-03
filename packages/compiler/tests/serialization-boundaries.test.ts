import { describe, expect, it } from 'vitest';

import { locateEngineSpans, storeEngineSpans } from '../src/engine-spans.js';
import { ManifestBuilder } from '../src/manifest.js';
import { isForbiddenSzKey } from '../src/sz-limits.js';

describe('serialization boundaries', () => {
    it('retains offsets when a consumer copies a group but preserves its located positions', () => {
        const located = locateEngineSpans('é x', {
            issues: [],
            mergeGroups: [{ keys: ['p'], keyStarts: [3], classes: ['p-4'] }],
            mergeOverrides: [],
        });
        const group = located.mergeGroups[0];
        const copied = { keys: group.keys, positions: group.positions, classes: group.classes };
        expect(storeEngineSpans({ mergeGroups: [copied] }).mergeGroups).toEqual([
            { keys: ['p'], keyStarts: [3], classes: ['p-4'] },
        ]);
    });

    it('keeps an absolute manifest path when no conventional project directory is present', () => {
        const builder = new ManifestBuilder('build');
        builder.addToken('token', {
            mode: 'csr',
            component: 'Button',
            filePath: '/generated/Button.tsx',
            line: 1,
            column: 1,
            buildId: 'build',
        });
        expect(builder.build().tokens.token.path).toBe('/generated/Button.tsx');
    });

    it.each(['__proto__', 'constructor', 'prototype'])('rejects prototype mutation key %s', key => {
        expect(isForbiddenSzKey(key)).toBe(true);
    });

    it.each(['p', 'constructorName', 'Prototype'])('permits ordinary key %s', key => {
        expect(isForbiddenSzKey(key)).toBe(false);
    });
});
