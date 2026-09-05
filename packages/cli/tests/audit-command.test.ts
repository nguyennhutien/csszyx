/**
 * Coverage for the `audit` command. It scans a project's build output and prints
 * a mangle/bundle report; the tests run it against a throwaway directory and
 * silence its console output.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audit } from '../src/commands/audit.js';

let dir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'csszyx-audit-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
});

describe('audit', () => {
    it('emits JSON stats for an empty project without throwing', async () => {
        await expect(audit({ cwd: dir, json: true })).resolves.toBeUndefined();
        const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n');
        const stats = JSON.parse(printed);
        expect(stats).toHaveProperty('totalClasses', 0);
        expect(stats).toHaveProperty('output');
        expect(stats).not.toHaveProperty('bundleSavings');
    });

    it('prints the human report and notes when no build output exists', async () => {
        await expect(audit({ cwd: dir })).resolves.toBeUndefined();
        const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n');
        expect(printed).toContain('Run a production build first');
    });
});
