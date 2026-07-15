import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classToSzCandidates } from './check-corpus-candidates.js';

describe('classToSzCandidates', () => {
    it('maps exact boolean utilities', () => {
        assert.deepEqual(classToSzCandidates('flex'), [
            { szKey: 'flex', value: true },
            { szKey: 'flexDir', value: true },
            { szKey: 'flexWrap', value: true },
        ]);
    });

    it('maps numeric suffixes for every matching sz key', () => {
        assert.ok(
            classToSzCandidates('p-4').some(
                candidate => candidate.szKey === 'p' && candidate.value === 4,
            ),
        );
        assert.ok(classToSzCandidates('text-0.5').some(candidate => candidate.value === 0.5));
    });

    it('preserves non-numeric suffixes and rejects unknown prefixes', () => {
        assert.ok(classToSzCandidates('bg-brand').some(candidate => candidate.value === 'brand'));
        assert.deepEqual(classToSzCandidates('not-a-csszyx-utility'), []);
    });
});
