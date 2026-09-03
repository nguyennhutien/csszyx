/**
 * `generate-types` asks whether Tailwind v3 is there before it prints a line
 * of progress, and stops with the availability message when it is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const availability = vi.hoisted(() => ({
    resolveTailwindV3: vi.fn<() => Promise<{ version: string }>>(),
}));

vi.mock('../src/scanner/tailwind-availability.js', () => ({
    resolveTailwindV3: availability.resolveTailwindV3,
}));

import { generateTypes } from '../src/commands/generate-types.js';

afterEach(() => {
    vi.restoreAllMocks();
    availability.resolveTailwindV3.mockReset();
});

describe('generate-types: the Tailwind guard', () => {
    it('prints the availability message and exits before reading any config', async () => {
        availability.resolveTailwindV3.mockRejectedValue(
            new Error('generate-types needs Tailwind CSS v3, and this project has none installed.'),
        );
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit');
        }) as never);

        await expect(generateTypes({ config: './nope.js' })).rejects.toThrow('exit');

        expect(exit).toHaveBeenCalledWith(1);
        expect(errors.join('\n')).toContain('❌ generate-types needs Tailwind CSS v3');
        // Nothing about reading a config was printed first.
        expect(logs.join('\n')).not.toContain('Reading config');
    });
});
