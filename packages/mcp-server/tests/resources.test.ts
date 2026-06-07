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
});
