/**
 * Saying so when `szcn` runs with no merge table.
 *
 * Without the table the build generates, `szcn` only drops exact repeats: a
 * jest suite run before any build, an app on a lane that ships no table, the
 * runtime used on its own. Each of those upgraded from 0.17 to merges that
 * quietly stopped, with nothing to search for. One development warning, the
 * first time two classes meet with no table, names the cause.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
});

/**
 * A fresh runtime and a spy on what it prints.
 *
 * @returns The runtime and the printed warnings.
 */
async function fresh() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = await import('../src/index.js');
    const printed = () => warn.mock.calls.map(args => String(args[0])).join('\n');
    return { runtime, printed, warn };
}

describe('a merge with no table', () => {
    it('says what szcn does without one and how to get one', async () => {
        const { runtime, printed } = await fresh();

        expect(runtime.szcn('p-2', 'p-4')).toBe('p-2 p-4');

        expect(printed()).toContain('no merge table');
        expect(printed()).toContain('csszyx next prebuild');
    });

    it('says it once, through either helper', async () => {
        const { runtime, warn } = await fresh();
        runtime.szcn('p-2', 'p-4');
        runtime._szcn('m-2', 'm-4');
        runtime.szcn('gap-2', 'gap-4');

        expect(
            warn.mock.calls.filter(args => String(args[0]).includes('no merge table')),
        ).toHaveLength(1);
    });

    it('says nothing for a single class, which needs no table', async () => {
        const { runtime, printed } = await fresh();
        runtime.szcn('p-4');
        runtime.szcn('p-4 p-4');

        expect(printed()).not.toContain('no merge table');
    });

    it('says nothing once a build registered a table, even an empty one', async () => {
        const { runtime, printed } = await fresh();
        runtime.registerMergeSignatures([{}, []]);
        runtime.szcn('p-2', 'p-4');

        expect(printed()).not.toContain('no merge table');
    });

    it('says nothing in production', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { runtime, printed } = await fresh();
        runtime.szcn('p-2', 'p-4');

        expect(printed()).toBe('');
    });
});
