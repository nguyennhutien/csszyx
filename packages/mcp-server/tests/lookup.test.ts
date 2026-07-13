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

    it('fuzzy-matches a substring across many terms, dedupes repeat keys, and caps at 5', () => {
        // "ground" is not itself an indexed term (no exact hit), so this falls
        // through to the substring scan. It is a substring of several indexed
        // terms that all resolve to the same sz keys (e.g. "background",
        // "background-color", "backgroundColor" all point at "bg"), so the scan
        // must skip a key it already pushed instead of duplicating it, and must
        // stop scanning once 5 unique keys have been collected.
        const data = JSON.parse(handleLookup({ query: 'ground' }).content[0].text);
        expect(data.results.length).toBeLessThanOrEqual(5);
        const szKeys = data.results.map((r: { szKey: string }) => r.szKey);
        expect(new Set(szKeys).size).toBe(szKeys.length);
        expect(szKeys).toContain('bg');
    });

    it('falls back to the sz key itself as the tailwind prefix for boolean shorthands', () => {
        // Boolean shorthand keys (e.g. "truncate") have no PROPERTY_MAP entry —
        // the tailwind class is the key name itself, not a mapped prefix.
        const data = JSON.parse(handleLookup({ query: 'truncate' }).content[0].text);
        expect(data.results[0].szKey).toBe('truncate');
        expect(data.results[0].tailwindPrefix).toBe('truncate');
    });

    it('returns an empty examples array for keys without curated examples', () => {
        // "bgAttach" is a real PROPERTY_MAP key but was never added to the
        // hand-curated EXAMPLES table.
        const data = JSON.parse(handleLookup({ query: 'bgAttach' }).content[0].text);
        expect(data.results[0].szKey).toBe('bgAttach');
        expect(data.results[0].examples).toEqual([]);
    });
});
