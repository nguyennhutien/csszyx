/**
 * bin.ts migrate action end-to-end: dispatching `migrate <dir> --ignore … --no-fouc
 * --inject-runtime cdn` through cac exercises the option-normalization branches
 * (comma-split ignore, positional dir winning over --cwd, --no-fouc → injectFouc
 * false, --inject-runtime cdn) against a real temp project.
 *
 * One bin dispatch per file: re-importing bin.ts within a single module registry
 * reuses cac's already-parsed argv, so each dispatch scenario lives in its own file.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ARGV = process.argv;
let cwd: string;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('bin migrate dispatch (real command)', () => {
    it('splits --ignore, honours the positional dir and --no-fouc, and injects a cdn runtime tag', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'info').mockImplementation(() => {});
        cwd = mkdtempSync(join(tmpdir(), 'csszyx-bin-mig-'));
        mkdirSync(join(cwd, 'src'));
        writeFileSync(
            join(cwd, 'src/page.html'),
            '<html><head></head><body><div class="p-4 bg-blue-500">x</div></body></html>',
        );

        process.argv = [
            'node',
            'csszyx',
            'migrate',
            cwd, // positional dir must win over --cwd below
            '--cwd',
            '/nonexistent-cwd',
            '--pattern',
            'src/**/*.html',
            '--ignore',
            '**/skip/**,**/vendor/**',
            '--no-fouc',
            '--inject-runtime',
            'cdn',
            '--cdn-url',
            'https://cdn.example.com/csszyx-runtime.js',
        ];
        await import('../src/bin.js?scenario=migrate-cdn');
        // Poll for the effect this test is about rather than sleeping a fixed
        // span: the action is async and now loads its command module on
        // demand, so any constant is a race that passes alone and fails under
        // a loaded suite.
        for (let waited = 0; waited < 10_000; waited += 25) {
            if (readFileSync(join(cwd, 'src/page.html'), 'utf8').includes('sz="')) break;
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        const html = readFileSync(join(cwd, 'src/page.html'), 'utf8');
        // className → sz attribute (positional dir was used, so the file was found).
        expect(html).toContain('sz="');
        // --inject-runtime cdn injected the custom CDN script tag.
        expect(html).toContain('https://cdn.example.com/csszyx-runtime.js');
        // --no-fouc suppressed the FOUC style block.
        expect(html).not.toContain('visibility:hidden');
    }, 15000);
});
