/**
 * The merge table carries the format it was written in.
 *
 * `.csszyx/merge-registration.*` outlives an upgrade: jest imports whatever
 * the last build left, and a Next command rewrites it only when it runs. A
 * runtime that read a table written in another shape would merge on data it
 * misreads, with a green build. It refuses such a table instead, keeps every
 * class as it does with no table, and says how to rebuild it in every environment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
});

const TABLE = [{ 'pb-2': 0, 'p-4': 1 }, [[0], [0, 1]]] as const;

/**
 * A fresh runtime and what it prints.
 *
 * @returns The runtime and the printed warnings.
 */
async function fresh() {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = await import('../src/index.js');
    const state = await import('../src/merge-signatures.js');
    return {
        runtime,
        state,
        warn,
        printed: () => warn.mock.calls.map(args => String(args[0])).join('\n'),
    };
}

describe('a table the build wrote', () => {
    it('is used when its format is the one this runtime reads', async () => {
        const { runtime } = await fresh();
        runtime.registerMergeSignatures(TABLE, { format: runtime.MERGE_TABLE_FORMAT });

        expect(runtime.szcn('pb-2', 'p-4')).toBe('p-4');
    });

    it('is refused, keeping every class, when written in another format', async () => {
        const { runtime, printed } = await fresh();
        runtime.registerMergeSignatures(TABLE, { format: runtime.MERGE_TABLE_FORMAT + 1 });

        expect(runtime.szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
        expect(printed()).toContain('written in format');
        expect(printed()).toContain('csszyx next prebuild');
    });

    it('is refused in production with a regeneration warning', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { runtime, printed } = await fresh();
        runtime.registerMergeSignatures(TABLE, { format: runtime.MERGE_TABLE_FORMAT + 1 });

        expect(runtime.szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
        expect(printed()).toContain('written in format');
        expect(printed()).toContain('csszyx next prebuild');
    });

    it('is used when registered by hand, with no format', async () => {
        const { runtime } = await fresh();
        runtime.registerMergeSignatures(TABLE);

        expect(runtime.szcn('pb-2', 'p-4')).toBe('p-4');
    });
});

describe.each(['development', 'production'])('format replacement in %s', environment => {
    it('depends only on the latest registration across every three-step history', async () => {
        vi.stubEnv('NODE_ENV', environment);
        const { runtime } = await fresh();
        // Exhaust all histories over accepted evidence, accepted empty data,
        // and incompatible evidence. Each call primes the next step's memo.
        for (let history = 0; history < 27; history++) {
            runtime.registerMergeSignatures(TABLE);
            runtime.szcn('pb-2', 'p-4');
            let events = history;
            for (let step = 0; step < 3; step++) {
                const event = events % 3;
                events = Math.floor(events / 3);
                runtime.registerMergeSignatures(event === 1 ? [{}, []] : TABLE, {
                    format: runtime.MERGE_TABLE_FORMAT + (event === 2 ? 1 : 0),
                });
                const expected = event === 0 ? 'p-4' : 'pb-2 p-4';
                expect(runtime.szcn('pb-2', 'p-4'), `history ${history}, step ${step}`).toBe(
                    expected,
                );
                expect(runtime._szcn('pb-2', 'p-4')).toBe(expected);
            }
        }
    });

    it('revokes old evidence and cached merges on every rejection, then accepts a rebuild', async () => {
        vi.stubEnv('NODE_ENV', environment);
        const { runtime, state, warn } = await fresh();
        // An unknown writer may use an entirely different shape. A rejected
        // registration must not even inspect the payload before discarding it.
        const unreadable = new Proxy(TABLE, {
            get() {
                throw new Error('read incompatible payload');
            },
        });
        for (const format of [
            runtime.MERGE_TABLE_FORMAT + 1,
            runtime.MERGE_TABLE_FORMAT + 2,
            runtime.MERGE_TABLE_FORMAT + 1,
        ]) {
            runtime.registerMergeSignatures(TABLE);
            expect(runtime.szcn('pb-2', 'p-4')).toBe('p-4');
            expect(runtime._szcn('pb-2', 'p-4')).toBe('p-4');
            const generation = state.getMergeSignatureGeneration();

            runtime.registerMergeSignatures(unreadable, { format });

            expect.soft(state.getMergeSignatureTable()).toBeUndefined();
            expect.soft(state.getMergeSignatureGeneration()).toBe(generation + 1);
            expect.soft(runtime.szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
            expect.soft(runtime._szcn('pb-2', 'p-4')).toBe('pb-2 p-4');
            expect.soft(runtime.szcn('pb-2 p-4', 'pb-2')).toBe('p-4 pb-2');
        }
        expect(
            warn.mock.calls.filter(args => String(args[0]).includes('written in format')),
        ).toHaveLength(1);
        runtime.registerMergeSignatures(TABLE, { format: runtime.MERGE_TABLE_FORMAT });
        expect(runtime.szcn('pb-2', 'p-4')).toBe('p-4');
        expect(runtime._szcn('pb-2', 'p-4')).toBe('p-4');
    });
});
