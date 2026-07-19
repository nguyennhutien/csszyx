/**
 * The CLI binary's non-CACError rethrow surface. The module-level try/catch
 * around `cli.parse()` only absorbs cac's own errors — anything else must
 * escape untouched so real bugs keep their stack trace. cac is mocked here
 * because no argv makes the real parse throw a foreign error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ throwValue: undefined as unknown }));

vi.mock('cac', () => {
    const chain = (): unknown =>
        new Proxy(() => chain(), {
            get: (_target, prop) => {
                if (prop === 'parse') {
                    return () => {
                        throw state.throwValue;
                    };
                }
                return () => chain();
            },
        });
    return { default: () => chain() };
});

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.restoreAllMocks();
    vi.resetModules();
    process.exitCode = undefined;
});

describe('csszyx bin non-CACError rethrow', () => {
    it('rethrows an Error whose name is not CACError', async () => {
        process.argv = ['node', 'csszyx'];
        state.throwValue = new Error('boom');
        await expect(import('../src/bin.js?case=foreign-error')).rejects.toThrow('boom');
        expect(process.exitCode).toBeUndefined();
    });

    it('rethrows a non-Error throw untouched', async () => {
        process.argv = ['node', 'csszyx'];
        state.throwValue = 'boom-string';
        await expect(import('../src/bin.js?case=foreign-string')).rejects.toBe('boom-string');
        expect(process.exitCode).toBeUndefined();
    });
});
