import { describe, expect, it } from 'vitest';
import { segmentDemoLabel } from './segment-demo-label.js';

describe('segmentDemoLabel', () => {
    it('preserves the order of text and multiple sz fragments', () => {
        expect(segmentDemoLabel('before {p: 4} middle {color: red} after')).toEqual([
            { type: 'text', value: 'before ' },
            { type: 'sz', value: '{p: 4}' },
            { type: 'text', value: ' middle ' },
            { type: 'sz', value: '{color: red}' },
            { type: 'text', value: ' after' },
        ]);
    });

    it('keeps unmatched and empty braces as text', () => {
        expect(segmentDemoLabel('empty {} and open {p: 4')).toEqual([
            { type: 'text', value: 'empty {} and open {p: 4' },
        ]);
    });

    it('returns plain labels unchanged', () => {
        expect(segmentDemoLabel('plain label')).toEqual([
            { type: 'text', value: 'plain label' },
        ]);
    });
});
