/**
 * The Next commands read `.gitignore` where the build does, and only there.
 *
 * `next prebuild` and `next watch` build the safelist shards Tailwind reads,
 * so their source walk reads a gitignored generated component like any other:
 * Tailwind cannot read an sz object, and skipping the file would ship it
 * without CSS. Their stylesheet walk follows `.gitignore`, as the bundler
 * plugin's does, so a stale copy under a gitignored `out/` does not vote on
 * the prefix.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { startNextWatch } from '../src/commands/next-watch.js';
import { linkTailwind } from './link-tailwind.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * A Next app resolving Tailwind v4, with a gitignored generated component and
 * a gitignored stale export.
 *
 * @returns Absolute project root.
 */
function app(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-next-gitignore-')));
    roots.push(root);
    linkTailwind(root);
    for (const [file, content] of Object.entries({
        'package.json': '{"name":"app","private":true}\n',
        '.gitignore': 'out/\nsrc/generated/\n',
        'app/globals.css': '@import "tailwindcss" prefix(tw);\n',
        'app/page.tsx': 'export default () => <div sz={{ p: 4 }} />;\n',
        'src/generated/Badge.tsx': 'export const Badge = () => <div sz={{ m: 9 }} />;\n',
        'out/_next/static/app.css': '@import "tailwindcss";\n',
    })) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content, 'utf8');
    }
    return root;
}

describe('the Next commands and .gitignore', () => {
    it('next prebuild safelists a gitignored generated component', async () => {
        const root = app();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const code = await nextPrebuild({
            root,
            cwd: root,
            mode: 'development',
            parserMode: 'wasm',
            json: true,
        });
        expect(code).toBe(0);
        const summary = JSON.parse(logSpy.mock.calls.flat().join('\n')) as {
            safelistOutputPath: string;
        };
        const safelist = readFileSync(summary.safelistOutputPath, 'utf8').split('\n');
        expect(safelist).toContain('tw:p-4');
        expect(safelist).toContain('tw:m-9');
    }, 60_000);

    it('next watch safelists it from the first cycle', async () => {
        const root = app();
        const session = await startNextWatch({
            root,
            cwd: root,
            parserMode: 'wasm',
            debounceMs: 10,
            silent: true,
        });
        try {
            const safelist = readFileSync(session.safelistOutputPath, 'utf8').split('\n');
            expect(safelist).toContain('tw:p-4');
            expect(safelist).toContain('tw:m-9');
        } finally {
            await session.close();
        }
    }, 60_000);
});
