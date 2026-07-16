import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { esbuildPlugin } from '../src/unplugin.js';

const tempDirs: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of tempDirs.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('esbuild class-mangle safety', () => {
    it('warns and keeps shared and sz-only names readable when mangle is requested', async () => {
        const root = mkdtempSync(join(realpathSync(tmpdir()), 'csszyx-esbuild-mangle-'));
        tempDirs.push(root);
        const input = join(root, 'entry.jsx');
        writeFileSync(
            input,
            'export const App = <div className="p-91 raw-esbuild" sz={{ p: 91, m: 92 }} />;',
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = await build({
            entryPoints: [input],
            bundle: true,
            format: 'esm',
            jsxFactory: 'h',
            logLevel: 'silent',
            plugins: [
                esbuildPlugin({
                    build: { cache: false, parser: 'oxc' },
                    production: { mangle: true },
                }),
            ],
            write: false,
        });
        const javascript = result.outputFiles?.map(file => file.text).join('\n') ?? '';

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('mangling is disabled'));
        expect(javascript).toContain('p-91');
        expect(javascript).toContain('m-92');
        expect(javascript).toContain('raw-esbuild');
    }, 30_000);
});
