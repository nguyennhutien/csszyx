/**
 * The CLI binary's cac-error surface. cac 7 throws a CACError for a missing
 * required arg (cac 6 silently fell through to help); the bin catches it and
 * prints a one-line message plus help instead of a stack trace. Kept apart
 * from bin-registration.test.ts: this import must be the file's first bin.ts
 * evaluation for the spies to observe the module-level parse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
});

describe('csszyx bin CACError handling', () => {
    it('surfaces a CACError as a one-line message plus help with exit code 1', async () => {
        process.argv = ['node', 'csszyx', 'explain'];
        const logs: string[] = [];
        const capture = (...parts: unknown[]): void => {
            logs.push(parts.join(' '));
        };
        vi.spyOn(console, 'log').mockImplementation(capture);
        vi.spyOn(console, 'info').mockImplementation(capture);
        const errors: string[] = [];
        vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
            errors.push(parts.join(' '));
        });
        await import('../src/bin.js?case=cac-error');
        expect(errors.join('\n')).toContain('csszyx:');
        expect(logs.join('\n')).toContain('explain');
        expect(process.exitCode).toBe(1);
    });
});
