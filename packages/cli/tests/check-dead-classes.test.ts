/**
 * `csszyx check` asking Tailwind whether the classes it emitted are real.
 *
 * Each fixture gets its own `node_modules/tailwindcss`, because that is what
 * the command resolves and what a real project has. Leaving it out is not a
 * neutral simplification: resolution would walk up into whatever tree the
 * fixture happens to sit in — inside this repository that finds the v3 copy
 * `csszyx migrate` pins — and every case would pass as a skip.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';

const REPO = path.resolve(import.meta.dirname, '../../..');
/** The v4 install a project of its own would carry. */
const TAILWIND_V4 = path.dirname(
    createRequire(path.join(REPO, 'package.json')).resolve('tailwindcss/package.json'),
);
const roots: string[] = [];

/**
 * Materialise a project that resolves Tailwind v4 the way a real one does.
 *
 * @param files - Project-relative paths mapped to their contents.
 * @param options - Fixture switches.
 * @param options.tailwind - False to model a project with Tailwind not installed.
 * @returns Absolute project root.
 */
function projectWith(files: Record<string, string>, options: { tailwind?: boolean } = {}): string {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-check-')));
    roots.push(root);
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    if (options.tailwind !== false) {
        symlinkSync(TAILWIND_V4, path.join(root, 'node_modules/tailwindcss'), 'dir');
    }
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
 * Run the command over a project and return everything it printed.
 *
 * @param cwd - Project root.
 * @param allow - Classes to accept even when they produce no CSS.
 * @returns Concatenated report text.
 */
async function reportFor(cwd: string, allow?: string[]): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd, allow });
    return log.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('csszyx check — classes that style nothing', () => {
    it('reports a class the mapping emitted that Tailwind does not serve', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            // `pointer` is not an sz key, so the kebab pass-through ships
            // `pointer-none` — a class Tailwind has never served.
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toContain('pointer-none');
        expect(report).toContain('Bad.tsx');
        expect(process.exitCode).toBe(1);
    });

    it('accepts a class the project theme makes real', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";\n@theme { --color-brand: #123456; }',
            'src/Good.tsx': "export const Good = () => <div sz={{ bg: 'brand' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('bg-brand');
        expect(process.exitCode).not.toBe(1);
    });

    it('accepts a custom breakpoint and rejects a typo of it', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";\n@theme { --breakpoint-tablet: 900px; }',
            'src/Ok.tsx': 'export const Ok = () => <div sz={{ tablet: { p: 4 } }} />;',
            'src/Typo.tsx': 'export const Typo = () => <div sz={{ tablt: { p: 4 } }} />;',
        });

        const report = await reportFor(cwd);

        expect(report).toContain('tablt');
        expect(report).not.toContain('tablet:p-4');
    });

    it('says why it could not check when the project has no Tailwind installed', async () => {
        const cwd = projectWith(
            {
                'src/app.css': '@import "tailwindcss";',
                'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
            },
            { tailwind: false },
        );

        const report = await reportFor(cwd);

        expect(report).toContain('skipped');
        expect(report).toContain('could not resolve');
        expect(report).not.toContain('pointer-none');
    });

    it('says why it could not check when the project has no Tailwind stylesheet', async () => {
        const cwd = projectWith({
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toMatch(/skipped|could not/i);
        expect(report).not.toContain('pointer-none');
    });

    // Without a way to accept a known finding, the only lever a project has is
    // to stop running the check at all.
    it('accepts a class the project vouched for, and keeps reporting the rest', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx':
                "export const Bad = () => <div sz={{ pointer: 'none', breakWord: true }} />;",
        });

        const report = await reportFor(cwd, ['pointer-none']);

        expect(report).not.toContain('pointer-none');
        expect(report).toContain('break-word');
        expect(process.exitCode).toBe(1);
    });

    // `bg` is a real key, so the key pass stays silent and the run's exit code
    // reflects the dead-class pass alone.
    it('passes once every remaining finding is vouched for', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': "export const Bad = () => <div sz={{ bg: 'brnad' }} />;",
        });

        const report = await reportFor(cwd, ['bg-brnad']);

        expect(report).toContain('1 accepted');
        expect(process.exitCode).not.toBe(1);
    });
});

describe('projects with more than one Tailwind entry', () => {
    it('accepts a token declared in the entry that is not the shallowest one', async () => {
        // Two stylesheets each import Tailwind — a design system plus a page
        // theme, which is an ordinary shape. Picking one and asking only that
        // one reports every token of the other as dead: the class is real, it
        // is served, and the report says to go delete it.
        const cwd = projectWith({
            'src/design-system.css': '@import "tailwindcss";',
            'src/landing.css': '@import "tailwindcss";\n@theme { --color-primary: #2dd597; }',
            'src/Landing.tsx': "export const Landing = () => <div sz={{ bg: 'primary' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('bg-primary');
        expect(process.exitCode).not.toBe(1);
    });

    it('still reports a class no entry serves', async () => {
        // The union must not become a way to pass: a class none of the design
        // systems can produce is still dead.
        const cwd = projectWith({
            'src/design-system.css': '@import "tailwindcss";',
            'src/landing.css': '@import "tailwindcss";\n@theme { --color-primary: #2dd597; }',
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toContain('pointer-none');
        expect(process.exitCode).toBe(1);
    });
});

describe('csszyx check — what it does with nothing to check', () => {
    it('skips the dead-class query when no file emitted a class', async () => {
        // Building a design system costs a Tailwind compile. A project whose
        // sources author no sz has nothing to ask about, and paying for the
        // answer would slow every run that needed it least.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/Plain.tsx': 'export const Plain = () => <div className="static" />;',
        });

        const report = await reportFor(cwd);

        expect(report).toContain('No sz issues found');
        expect(report).not.toContain('emitted class(es)');
        expect(process.exitCode).not.toBe(1);
    });

    it('attributes a class shared by two files to the first that emitted it', async () => {
        // One origin per class is the contract: the report answers "where did
        // this come from", not "everywhere it appears". Overwriting on each
        // sighting would name whichever file the scan happened to reach last.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx': "export const A = () => <div sz={{ pointer: 'none' }} />;",
            'src/B.tsx': "export const B = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(cwd);

        // Matched as the dead-class ROW, not anywhere in the report: both files
        // also appear above it, each carrying its own unknown-key diagnostic.
        expect(report).toMatch(/pointer-none\s+src\/A\.tsx/);
        expect(report).not.toMatch(/pointer-none\s+src\/B\.tsx/);
    });
});
