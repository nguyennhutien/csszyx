import { describe, expect, it } from 'vitest';

import { handleLookup } from '../src/tools/lookup';

describe('csszyx_lookup', () => {
    it('finds sz key by its own name', () => {
        const data = JSON.parse(handleLookup({ query: 'bg' }).content[0].text);
        expect(data.results[0].szKey).toBe('bg');
        expect(data.results[0].tailwindPrefix).toBe('bg');
    });

    it('finds sz key by CSS property name (kebab-case)', () => {
        const data = JSON.parse(handleLookup({ query: 'background-color' }).content[0].text);
        expect(data.results.some((r: { szKey: string }) => r.szKey === 'bg')).toBe(true);
    });

    it('finds sz key by CSS property name (camelCase)', () => {
        const data = JSON.parse(handleLookup({ query: 'backgroundColor' }).content[0].text);
        expect(data.results.some((r: { szKey: string }) => r.szKey === 'bg')).toBe(true);
    });

    it('finds sz key by CSS property (flex-direction → flexDir)', () => {
        const data = JSON.parse(handleLookup({ query: 'flex-direction' }).content[0].text);
        expect(data.results.some((r: { szKey: string }) => r.szKey === 'flexDir')).toBe(true);
    });

    it('fuzzy-matches partial terms and returns padding → p', () => {
        const data = JSON.parse(handleLookup({ query: 'padding' }).content[0].text);
        expect(data.results.length).toBeLessThanOrEqual(8);
        expect(data.results.some((r: { szKey: string }) => r.szKey === 'p')).toBe(true);
    });

    it('returns examples for known keys', () => {
        const data = JSON.parse(handleLookup({ query: 'p' }).content[0].text);
        expect(data.results[0].examples.length).toBeGreaterThan(0);
    });

    it('returns empty results with a helpful message for unknown terms', () => {
        const data = JSON.parse(handleLookup({ query: 'zxcvbnm' }).content[0].text);
        expect(data.results).toHaveLength(0);
        expect(data.message).toContain('No mapping found');
    });
});
