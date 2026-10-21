/**
 * `csszyx explain` when the engine itself throws: not a refusal of the input,
 * so it has no registry words of its own here, and the command says it could
 * not explain the object with what the engine reported.
 */
import { stripVTControlCharacters } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@csszyx/compiler/engine', () => ({
    transformSource: () => {
        throw new Error('the engine is not installed');
    },
}));

const { explain } = await import('../src/commands/explain.js');

afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('explain, when the engine throws', () => {
    it('fails with what the engine reported', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            lines.push(stripVTControlCharacters(parts.join(' ')));
        });
        explain('{ p: 4 }');
        expect(lines).toEqual(['✗ Could not explain sz: Error: the engine is not installed']);
        expect(process.exitCode).toBe(1);
    });
});
