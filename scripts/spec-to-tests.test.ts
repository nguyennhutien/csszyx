import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSpecLines } from './spec-to-tests.js';

const UTILITY_HEADER = '| Concept | Tailwind Class | sz prop |';
const UTILITY_SEPARATOR = '| --- | --- | --- |';

describe('parseSpecLines', () => {
    it('parses utility rows with heading context', () => {
        const state = parseSpecLines([
            '## Layout',
            '### Spacing',
            UTILITY_HEADER,
            UTILITY_SEPARATOR,
            '| Padding | `p-4` | `{ p: 4 }` |',
        ]);

        assert.equal(state.tests.length, 1);
        assert.deepEqual(state.tests[0], {
            id: 'layout-spacing-padding',
            szInput: { p: 4 },
            expectedClass: 'p-4',
            tailwindVersion: '4',
            category: 'Layout',
            subcategory: 'Spacing',
        });
        assert.equal(state.categoryCounts.Layout, 1);
    });

    it('skips excluded categories and resumes at the next category', () => {
        const state = parseSpecLines([
            '## Overview',
            UTILITY_HEADER,
            UTILITY_SEPARATOR,
            '| Ignored | `p-2` | `{ p: 2 }` |',
            '## Effects',
            UTILITY_HEADER,
            UTILITY_SEPARATOR,
            '| Opacity | `opacity-50` | `{ opacity: 50 }` |',
        ]);

        assert.deepEqual(
            state.tests.map(test => test.expectedClass),
            ['opacity-50'],
        );
        assert.equal(state.currentCategory, 'Effects');
    });

    it('ends table state on non-table content', () => {
        const state = parseSpecLines([
            '## Layout',
            UTILITY_HEADER,
            UTILITY_SEPARATOR,
            '| Padding | `p-4` | `{ p: 4 }` |',
            'Paragraph text',
        ]);

        assert.equal(state.inTable, false);
        assert.equal(state.columnInfo, null);
    });
});
