/**
 * Whether a stylesheet is a Tailwind root, decided by the project's own
 * compile: the rule Tailwind's bundler integrations use, rather than a search
 * for `@import "tailwindcss"` in the text.
 */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readStylesheetRole, type TailwindLoader } from '../src/emitted-class-oracle.js';

const REPO = path.resolve(import.meta.dirname, '../../..');

const made: string[] = [];
afterAll(() => {
    for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Write stylesheets into a fresh directory.
 *
 * @param files - Filename to content.
 * @returns The directory.
 */
function dir(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-role-'));
    made.push(root);
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, name), content);
    }
    return root;
}

/**
 * Read the role of one stylesheet in a directory.
 *
 * @param root - Directory holding the stylesheet.
 * @param name - Stylesheet filename.
 * @param loadTailwind - Resolver override.
 * @returns The role.
 */
function role(root: string, name: string, loadTailwind?: TailwindLoader) {
    return readStylesheetRole(
        { resolveFrom: REPO, css: fs.readFileSync(path.join(root, name), 'utf8'), cssBase: root },
        loadTailwind,
    );
}

describe('readStylesheetRole', () => {
    it('calls a stylesheet that generates utilities a root, and lists what it loaded', async () => {
        const root = dir({
            'app.css': '@import "./legacy.css";\n',
            'legacy.css': '@import "tailwindcss";\n',
        });

        const answer = await role(root, 'app.css');

        expect(answer.ok && answer.utilities).toBe(true);
        expect(answer.ok && answer.imports[0]).toBe(path.join(root, 'legacy.css'));
    });

    it('does not call a theme-only stylesheet a root', async () => {
        const root = dir({ 'theme.css': '@theme { --color-brand: #123; }\n' });

        const answer = await role(root, 'theme.css');

        expect(answer).toEqual({
            ok: true,
            utilities: false,
            imports: [],
            scanSources: expect.any(Array),
        });
    });

    it('does not call an import inside a comment a root', async () => {
        const root = dir({ 'old.css': '/* @import "tailwindcss"; */\n.card { padding: 1rem }\n' });

        expect(await role(root, 'old.css')).toEqual({
            ok: true,
            utilities: false,
            imports: [],
            scanSources: expect.any(Array),
        });
    });

    it('skips as the environment when the project has no Tailwind', async () => {
        const root = dir({ 'app.css': '@import "tailwindcss";\n' });

        const answer = await role(root, 'app.css', async () => null);

        expect(answer).toMatchObject({ ok: false, kind: 'environment' });
    });

    it('skips as the environment when the Tailwind it finds cannot compile', async () => {
        const root = dir({ 'app.css': '@import "tailwindcss";\n' });

        const v3 = await role(root, 'app.css', async () => ({ version: '3.4.19', root }));
        const noCompile = await role(root, 'app.css', async () => ({ version: '4.3.3', root }));

        expect(v3).toMatchObject({ ok: false, kind: 'environment' });
        expect(noCompile).toMatchObject({ ok: false, kind: 'environment' });
    });

    it('skips as the stylesheet, naming the cause, when the stylesheet does not compile', async () => {
        const root = dir({
            'broken.css': '@import "tailwindcss";\n@plugin "./not-a-module.js";\n',
        });

        const answer = await role(root, 'broken.css');

        expect(answer).toMatchObject({ ok: false, kind: 'stylesheet' });
        expect(answer.ok === false && answer.reason).toContain('not-a-module');
    });
});
