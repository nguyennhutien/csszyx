/**
 * `csszyx check` reporting a value written on the wrong sz key.
 *
 * `color: 'balance'` emits `text-balance`. Nothing else in this command sees a
 * problem: the key is canonical, so the key pass is quiet, and the class is
 * real, so the dead-class pass is quiet too. The page renders without the
 * colour that was asked for, and no tool says why.
 *
 * The project's own stylesheet decides, which is why these fixtures each carry
 * their own Tailwind: a project that declares `--color-balance` has given the
 * spelling a meaning, and the report must disappear for it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
const TAILWIND_V4 = path.dirname(
    createRequire(path.join(REPO, 'scripts/')).resolve('tailwindcss/package.json'),
);
const roots: string[] = [];

/**
 * Build a throwaway project carrying its own Tailwind.
 *
 * @param files - Project-relative files to write.
 * @returns Absolute project root.
 */
function projectWith(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-sibling-')));
    roots.push(root);
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    symlinkSync(TAILWIND_V4, path.join(root, 'node_modules/tailwindcss'), 'junction');
    writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n', 'utf8');
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content, 'utf8');
    }
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * Run the command and return everything it printed.
 *
 * @param cwd - Project root.
 * @returns Concatenated report text.
 */
async function reportFor(cwd: string): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd });
    return log.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('csszyx check — a value that belongs to a sibling key', () => {
    it('reports the pair, the class it emits, and what that class actually sets', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ color: 'balance' }} />;`,
        });

        const report = await reportFor(cwd);

        expect(report).toContain("color: 'balance'");
        expect(report).toContain('text-balance');
        expect(report).toContain('text-wrap');
        // A linter that names a file but no line leaves an editor and a CI
        // annotation with nowhere to point.
        expect(report).toContain('src/App.tsx:1');
        expect(process.exitCode).toBe(1);
    });

    it('stops blaming the USE once the project declares that token itself', async () => {
        // The declaration is still reported — by the theme-collision pass,
        // which owns it — so the command still fails. What must stop is THIS
        // pass pointing at the sz prop: the author who wrote `color: 'balance'`
        // spelled it exactly as their own theme defines it, and the one line
        // worth changing is in the stylesheet.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': `export const A = () => <div sz={{ color: 'balance' }} />;`,
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain("color: 'balance'");
        expect(report).toContain('src/app.css:3');
    });

    it('stays silent for a value that sets the key own property', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <svg sz={{ fill: 'none' }} />;`,
        });

        expect(await reportFor(cwd)).not.toContain("fill: 'none'");
        expect(process.exitCode).toBeUndefined();
    });

    it('stays silent for a project with no colliding values at all', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ color: 'red-500', p: 4 }} />;`,
        });

        expect(await reportFor(cwd)).not.toContain('belongs to');
        expect(process.exitCode).toBeUndefined();
    });
});

// A project may compile more than one stylesheet — a design system plus a page
// theme is an ordinary shape — and this command cannot know which one a given
// component renders under. So a value is foreign only when EVERY design system
// says so; one stylesheet resolving it as a token has given the spelling a
// meaning somewhere in the project.
describe('csszyx check — a project with more than one stylesheet', () => {
    it('stays quiet when only one of them reads the value as foreign', async () => {
        // `a.css` is stock Tailwind, under which `color: 'balance'` is the
        // mistake this whole rule exists for. `b.css` declares the token, so
        // somewhere in this project the spelling is deliberate — and a report
        // would send its author to a line that is correct for their page.
        const cwd = projectWith({
            'src/a.css': '@import "tailwindcss";',
            'src/b.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': `export const A = () => <div sz={{ color: 'balance' }} />;`,
        });

        expect(await reportFor(cwd)).not.toContain("color: 'balance' emits text-balance");
    });
});
