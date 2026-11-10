/**
 * The Next commands read `.gitignore` where the build does, and only there.
 *
 * `next prebuild` and `next watch` build the safelist shards Tailwind reads.
 * Their default source glob leaves out what `.gitignore` covers, as the
 * bundler plugin's prescan does, and takes back what a stylesheet's `@source`
 * names (ADR 0033). Their stylesheet walk follows `.gitignore` too, so a stale
 * copy under a gitignored `out/` does not vote on the prefix.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextPrebuild } from '../src/commands/next-prebuild.js';
import { startNextWatch } from '../src/commands/next-watch.js';
import { linkTailwind, linkTailwindIntegration } from './link-tailwind.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * A Next app resolving Tailwind v4, with a gitignored generated component and
 * a gitignored stale export.
 *
 * @param source - An `@source` line for `app/globals.css`, if any.
 * @param integration - False to leave out Tailwind's integration, which
 *        carries the Scanner.
 * @returns Absolute project root.
 */
function app(source = '', integration = true): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-next-gitignore-')));
    roots.push(root);
    linkTailwind(root);
    if (integration) linkTailwindIntegration(root);
    for (const [file, content] of Object.entries({
        'package.json': '{"name":"app","private":true}\n',
        '.gitignore': 'out/\nsrc/generated/\n',
        'app/globals.css': `@import "tailwindcss" prefix(tw);\n${source}`,
        'app/page.tsx': 'export default () => <div sz={{ p: 4 }} />;\n',
        'src/generated/Badge.tsx': 'export const Badge = () => <div sz={{ m: 9 }} />;\n',
        'out/_next/static/app.css': '@import "tailwindcss";\n',
    })) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content, 'utf8');
    }
    return root;
}

/**
 * The safelist `next prebuild` writes.
 *
 * @param root - The app root.
 * @returns Its lines.
 */
async function prebuildSafelist(root: string): Promise<string[]> {
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
    logSpy.mockRestore();
    return readFileSync(summary.safelistOutputPath, 'utf8').split('\n');
}

const SOURCE = '@source "../src/generated";\n';

describe('the Next commands and .gitignore', () => {
    it('next prebuild leaves out a gitignored component no `@source` names', async () => {
        const safelist = await prebuildSafelist(app());
        expect(safelist).toContain('tw:p-4');
        expect(safelist).not.toContain('tw:m-9');
    }, 60_000);

    it('next prebuild safelists a gitignored folder a stylesheet names', async () => {
        const safelist = await prebuildSafelist(app(SOURCE));
        expect(safelist).toContain('tw:p-4');
        expect(safelist).toContain('tw:m-9');
    }, 60_000);

    it('next prebuild reads what git keeps when no Scanner can list a rule', async () => {
        const safelist = await prebuildSafelist(app(SOURCE, false));
        expect(safelist).toContain('tw:p-4');
        expect(safelist).not.toContain('tw:m-9');
    }, 60_000);

    it.each([
        ['leaves it out', '', undefined, false, true],
        [
            'safelists it from the first cycle when a stylesheet names it',
            SOURCE,
            undefined,
            true,
            true,
        ],
        // A pattern names its files, as an `@source` does, so the rule adds none.
        ['reads only what `--pattern` matches', SOURCE, 'app/**/*.tsx', false, true],
        ['reads what git keeps when no Scanner can list a rule', SOURCE, undefined, false, false],
    ])(
        'next watch %s',
        async (_name, source, pattern, listed, integration) => {
            const root = app(source, integration);
            const session = await startNextWatch({
                root,
                cwd: root,
                pattern,
                parserMode: 'wasm',
                debounceMs: 10,
                silent: true,
            });
            try {
                const safelist = readFileSync(session.safelistOutputPath, 'utf8').split('\n');
                expect(safelist).toContain('tw:p-4');
                expect(safelist.includes('tw:m-9')).toBe(listed);
            } finally {
                await session.close();
            }
        },
        60_000,
    );
});
