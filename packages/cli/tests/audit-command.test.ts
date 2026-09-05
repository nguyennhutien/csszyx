/**
 * Coverage for the `audit` command. It scans a project's build output and prints
 * a bundle report; the tests run it against a throwaway directory and silence
 * its console output.
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
    it('emits a json document carrying the build output and nothing else', async () => {
        await expect(audit({ cwd: dir, json: true })).resolves.toBeUndefined();
        const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n');
        const stats = JSON.parse(printed);
        // `totalClasses` and `tierDistribution` used to sit beside `output`.
        // Neither was ever written to, so every project that ran the command
        // read 0 and {} out of the document as if they were measurements.
        expect(Object.keys(stats)).toEqual(['output']);
        expect(stats.output).toEqual({ html: null, css: null });
    });

    it('prints the human report with no tier section to explain away', async () => {
        await expect(audit({ cwd: dir })).resolves.toBeUndefined();
        const printed = logSpy.mock.calls.map(c => String(c[0])).join('\n');
        expect(printed).not.toContain('Mangle Statistics');
        expect(printed).not.toContain('Tier distribution');
        expect(printed).not.toContain('the tier each one came from');
        expect(printed).toContain('Build Output');
        expect(printed).toContain('No built HTML or CSS found under dist/.');
        expect(printed).toContain('does not shrink a gzip-served payload');
        expect(printed).toContain('csszyx/lite');
    });
});
