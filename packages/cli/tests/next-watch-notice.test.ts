/**
 * A notice from the watcher loop is one `next watch` keeps running through, so
 * it goes to stderr with the warning marker rather than through the failure path
 * that ends the process.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { printWatcherNotice } from '../src/commands/next-watch.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('next watch notices', () => {
    it('prints a watcher notice on stderr with the warning marker', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
            lines.push(parts.join(' '));
        });

        printWatcherNotice('[csszyx] next watch is waiting for the safelist lock');

        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('⚠');
        expect(lines[0]).toContain('[csszyx] next watch is waiting for the safelist lock');
    });
});
