import { describe, expect, it } from 'vitest';

import { listResources, RESOURCE_URIS, readResource } from '../src/resources/index.js';

describe('mcp resources', () => {
    it('lists the setup guide resource', () => {
        expect(RESOURCE_URIS).toContain('csszyx://setup');
        const setup = listResources().find(r => r.uri === 'csszyx://setup');
        expect(setup?.name).toBe('CSSzyx Setup Guide');
        expect(setup?.mimeType).toBe('text/markdown');
    });

    it('reads the setup guide covering the three real-app foot-guns', () => {
        const text = readResource('csszyx://setup').contents[0]?.text ?? '';
        expect(text).toContain('@csszyx/runtime');
        expect(text).toContain('/// <reference types="@csszyx/types/jsx" />');
        expect(text).toContain('csszyxTurbopack');
        expect(text).toContain('Do NOT set an `as`');
    });

    it('throws on an unknown resource uri', () => {
        expect(() => readResource('csszyx://nope')).toThrow();
    });

    it('serves the full reference from the packaged llms-full.txt (not "not found")', () => {
        // A fixed `../../..` path guess broke when the ESM bundle flattened, so the
        // reference returned the not-found fallback even though the file is packaged.
        const text = readResource('csszyx://reference').contents[0].text;
        expect(text).not.toContain('llms-full.txt not found');
        expect(text).toContain('CSSzyx');
        expect(text.length).toBeGreaterThan(1000);
    });
});
