/**
 * `csszyx check --files` — the shape a git hook can actually pass.
 *
 * lefthook and husky hand a command a LIST of staged paths, space-separated.
 * `--pattern` takes one glob, so the only way to use it was to splice the list
 * into brace syntax in shell — which works until a commit is large enough to
 * hit the argument limit, and reads like a trick either way.
 *
 * Scoping to a subset is sound here in a way it would not be everywhere: the
 * scan lowers each file on its own, with no cross-module registry, so a file
 * checked alone yields exactly what it yields in a whole-project run. That is
 * what makes a staged-files hook honest rather than approximate.
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
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-files-')));
    roots.push(root);
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    symlinkSync(TAILWIND_V4, path.join(root, 'node_modules/tailwindcss'), 'dir');
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
 * Run the command over an explicit file list and return its findings.
 *
 * @param cwd - Project root.
 * @param files - Paths as a hook would pass them.
 * @returns The parsed findings.
 */
async function findingsFor(
    cwd: string,
    files: string[],
): Promise<Array<{ rule: string; file?: string }>> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd, files, json: true });
    return JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;
}

// BOTH files carry a problem, so a run that ignored the list would report two
// findings and the scoping assertions would pass for the wrong reason.
const BAD = `export const A = () => <div sz={{ nonsenseKey: 4 }} />;`;
const OTHER_BAD = `export const B = () => <div sz={{ otherNonsense: 2 }} />;`;

describe('csszyx check --files', () => {
    it('checks exactly the files it was given', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['src/Bad.tsx']);

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Bad.tsx']));
        expect(process.exitCode).toBe(1);
    });

    it('leaves a file out of the run when it was not listed', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/Clean.tsx': `export const B = () => <div sz={{ p: 4 }} />;`,
        });

        const findings = await findingsFor(cwd, ['src/Clean.tsx']);

        expect(findings).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });

    it('takes several paths, as a hook hands them over', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/AlsoBad.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['src/Bad.tsx', 'src/AlsoBad.tsx']);
        const files = new Set(findings.map(entry => entry.file));

        expect(files).toEqual(new Set(['src/Bad.tsx', 'src/AlsoBad.tsx']));
    });

    it('accepts an absolute path, which is what a hook usually passes', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, [path.join(cwd, 'src/Bad.tsx')]);

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Bad.tsx']));
    });

    it('ignores a listed path that is not a source file, rather than failing', async () => {
        // A hook passes everything staged. Refusing the run because a README
        // was committed alongside would make the hook useless.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'README.md': '# hi\n',
            'src/Bad.tsx': BAD,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['README.md', 'src/Bad.tsx']);

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Bad.tsx']));
    });

    it('reports nothing when the list holds no source files at all', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'README.md': '# hi\n',
            'src/Bad.tsx': BAD,
        });

        expect(await findingsFor(cwd, ['README.md'])).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });
});

/**
 * A path in the list that does not resolve.
 *
 * The command counted these and reported them clean: `--files typo.tsx`
 * printed "Found 1 files" and "No sz issues found across 1 files" and exited
 * 0. For a check whose whole job is to gate a commit, that is the one failure
 * shape that must never happen — it claims to have looked.
 *
 * A hook reaches it without anyone making a typo. lefthook on Windows hands
 * over `src\App.tsx`, and joining that onto a posix cwd produces a filename
 * with a literal backslash in it, which exists nowhere.
 */
describe('csszyx check --files with a path that does not resolve', () => {
    it('fails rather than reporting a file it never read as clean', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Real.tsx': BAD,
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, files: ['src/Missing.tsx'] });

        expect(process.exitCode).toBe(1);
    });

    it('names the path it could not read', async () => {
        const cwd = projectWith({ 'src/app.css': '@import "tailwindcss";' });
        // The reporter writes every level through console.log, warnings too.
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, files: ['src/Missing.tsx'] });

        expect(log.mock.calls.flat().join('\n')).toContain('src/Missing.tsx');
    });

    it('reads a windows-style path as the file it names', async () => {
        // The separator a hook passes is not a statement about the filesystem.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Real.tsx': BAD,
        });

        const findings = await findingsFor(cwd, ['src\\Real.tsx']);

        expect(findings.some(finding => finding.rule === 'sz-diagnostic')).toBe(true);
    });

    it('accepts a windows-style glob for the same files as a posix one', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Real.tsx': BAD,
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, pattern: 'src\\**\\*.tsx', json: true });
        const findings = JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;

        expect(findings.some((finding: { rule: string }) => finding.rule === 'sz-diagnostic')).toBe(
            true,
        );
    });
});
