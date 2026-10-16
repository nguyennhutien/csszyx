/**
 * The adapter reads Svelte 5's modern AST; Svelte 4 has none, so a project
 * whose `svelte` is 4 gets an error naming what to install, not a misread.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler/internal', async importOriginal => ({
    ...(await importOriginal<typeof import('@csszyx/compiler/internal')>()),
    requirePeer: () => ({ VERSION: '4.2.19', parse: () => ({}) }),
}));

const { preprocess } = await import('../src/index.js');

describe('a project on Svelte 4', () => {
    it('gets an error naming Svelte 5', () => {
        const source = '<div sz={{ p: 4 }}></div>';
        const result = preprocess(source, { filename: 'A.svelte' });
        expect(result.code).toBe(source);
        expect(result.diagnostics.map(d => d.message)).toEqual([
            '[csszyx] A.svelte:1:1: csszyx reads Svelte 5 markup, and svelte 4.2.19 resolves\nhelp: install svelte@5',
        ]);
    });
});
