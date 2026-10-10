/**
 * `csszyx check` reads `.gitignore` where the build does, and only there.
 *
 * Its stylesheet walk follows `.gitignore`, as the bundler plugin's does, so a
 * stale copy under a gitignored `out/` does not stop the check over a prefix no
 * build reads. Its source walk does not: the build safelists a gitignored
 * generated component like any other, so the check audits it too.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { linkTailwind } from './link-tailwind.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * A project resolving Tailwind v4, holding the given files.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @returns Absolute project root.
 */
function projectWith(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-check-gitignore-')));
    roots.push(root);
    linkTailwind(root);
    writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, 'utf8');
    }
    return root;
}

/**
 * Run the check over a project and collect everything it printed.
 *
 * @param cwd - Project root.
 * @returns Every line written to the console.
 */
async function reportFor(cwd: string): Promise<string> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'warn').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
    await check({ cwd });
    return lines.join('\n');
}

const CARD = 'export const Card = () => <div sz={{ p: 4 }} />;\n';

describe('csszyx check and .gitignore', () => {
    it('leaves out a stylesheet .gitignore covers', async () => {
        const cwd = projectWith({
            '.gitignore': 'out/\n',
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'out/static/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('set different prefixes');
        expect(process.exitCode).not.toBe(1);
    }, 60_000);

    it('still audits a gitignored generated component', async () => {
        const cwd = projectWith({
            '.gitignore': 'src/generated/\n',
            'src/app.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
            'src/generated/Badge.tsx': 'export const Badge = () => <div sz={{ colr: "red" }} />;\n',
        });

        const report = await reportFor(cwd);

        expect(report).toContain('src/generated/Badge.tsx');
        expect(report).toContain('colr');
        expect(process.exitCode).toBe(1);
    }, 60_000);
});
