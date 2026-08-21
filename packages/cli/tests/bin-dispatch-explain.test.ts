/**
 * bin.ts explain action end-to-end: dispatching `explain <sz>` through cac
 * carries the positional argument into the command and prints the className.
 *
 * One bin dispatch per file (see bin-dispatch-migrate.test.ts for why).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

describe('bin explain dispatch (real command)', () => {
    it('compiles the positional sz literal and prints its className', async () => {
        const logs: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
            logs.push(parts.join(' '));
        });

        process.argv = ['node', 'csszyx', 'explain', "{ p: 4, bg: 'blue-500' }"];
        await import('../src/bin.js?scenario=explain-literal');
        // Poll for the effect rather than sleeping a fixed span: the action is
        // async and loads its command module on demand, so any constant is a
        // race that passes alone and fails under a loaded suite.
        for (let waited = 0; waited < 10_000 && logs.length === 0; waited += 25) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        expect(logs.join('\n')).toContain('p-4');
        expect(logs.join('\n')).toContain('bg-blue-500');
        expect(process.exitCode).toBeUndefined();
    }, 15000);
});
