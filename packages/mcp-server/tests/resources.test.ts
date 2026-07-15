import { afterEach, describe, expect, it, vi } from 'vitest';

import { listResources, RESOURCE_URIS, readResource } from '../src/resources/index.js';

function reportMissingFile(): false {
    return false;
}

function throwMissingFile(): never {
    throw new Error('ENOENT: mocked — no llms-full.txt anywhere');
}

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

    describe('llms-full.txt resolution when the file truly cannot be found', () => {
        afterEach(() => {
            vi.doUnmock('node:fs');
            vi.resetModules();
        });

        it('walks up to the filesystem root, gives up, and returns the fallback message', async () => {
            // resolveLlmsFullPath() runs once at module import time. Force
            // existsSync to always report "missing" so the upward directory walk
            // exhausts every candidate all the way to the filesystem root — the
            // `parent === dir` loop-termination branch — instead of finding the
            // file at some ancestor (which is what happens in the real repo/build
            // layout and is why this path is otherwise unreachable).
            vi.resetModules();
            vi.doMock('node:fs', async importOriginal => {
                const actual = await importOriginal<typeof import('node:fs')>();
                const patched = {
                    ...actual,
                    existsSync: reportMissingFile,
                    readFileSync: throwMissingFile,
                };
                return { ...patched, default: patched };
            });

            const fresh = await import('../src/resources/index.js');
            const text = fresh.readResource('csszyx://reference').contents[0].text;
            expect(text).toContain('llms-full.txt not found');
            expect(text).toContain('Use csszyx_lookup tool instead');
        });
    });
});
