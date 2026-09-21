/**
 * bin.ts next-watch action: `--ignore` reaches the command as a list of globs.
 *
 * The command is replaced here. Started for real it would leave a watcher
 * running, and the no-match run of bin-dispatch-next-watch.test.ts returns
 * before the list is used.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const nextWatch = vi.fn(async (_options: { extraIgnore?: string[] }) => 0);
vi.mock('../src/commands/next-watch.js', () => ({ nextWatch }));

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.restoreAllMocks();
});

describe('bin next-watch dispatch with --ignore', () => {
    it('keeps a brace glob whole, joins repeated flags and uses forward slashes', async () => {
        process.argv = [
            'node',
            'csszyx',
            'next-watch',
            '--ignore',
            'legacy/{a,b}/**,other/**',
            '--ignore',
            String.raw`third\**`,
        ];
        await import('../src/bin.js?scenario=next-watch-ignore');
        await vi.waitFor(() => expect(nextWatch).toHaveBeenCalled());

        expect(nextWatch.mock.calls[0]?.[0].extraIgnore).toEqual([
            'legacy/{a,b}/**',
            'other/**',
            'third/**',
        ]);
    });
});
