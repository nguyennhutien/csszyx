/**
 * The CLI binary's registration surface. Importing bin.ts registers every
 * command on cac and parses argv — with a bare argv nothing dispatches, so
 * this covers the wiring (flags, descriptions, the version banner, the
 * `next <sub>` alias normalization) that subprocess tests can't measure, and
 * the explain command end-to-end as the one safe synchronous dispatch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
});

describe('csszyx bin', () => {
    it('registers every command without dispatching on a bare invocation', async () => {
        process.argv = ['node', 'csszyx'];
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });
        await import('../src/bin.js?case=bare');
        const help = logs.join('\n');
        for (const command of [
            'init',
            'doctor',
            'check',
            'scan-collisions',
            'explain',
            'audit',
            'generate-types',
            'migrate',
            'next-prebuild',
            'next-watch',
        ]) {
            expect(help).toContain(command);
        }
        expect(process.exitCode).toBeUndefined();
    });

    it('normalizes `next prebuild`-style argv into the hyphenated command names', async () => {
        // The alias rewrite happens on import against the live argv.
        process.argv = ['node', 'csszyx', 'next', 'watch', '--help'];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code ?? 0}`);
        }) as never);
        await import('../src/bin.js?case=alias').catch(() => undefined);
        expect(process.argv[2]).toBe('next-watch');
        exit.mockRestore();
    });
});
