/**
 * `csszyx check --json` — the shape a CI annotator reads.
 *
 * The human report groups by file and explains itself; neither survives being
 * parsed. A GitHub annotation, an editor problem-matcher and a dashboard all
 * want the same four things per finding — which rule, which file, which line,
 * what happened — so that is what this emits, and nothing else goes to stdout.
 *
 * `rule` is a stable id rather than the message text, because the message is
 * free to be rewritten for clarity and a consumer filtering on it would break
 * every time it was.
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
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-json-')));
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
 * Run the command in JSON mode and parse everything it wrote to stdout.
 *
 * @param cwd - Project root.
 * @returns The parsed report.
 */
async function jsonFor(cwd: string): Promise<{
    version: number;
    findings: Array<{ rule: string; file?: string; line?: number; message: string }>;
}> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd, json: true });
    const written = log.mock.calls.map(call => call.join(' ')).join('\n');
    return JSON.parse(written);
}

describe('csszyx check --json', () => {
    it('writes one parseable document and nothing else', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ p: 4 }} />;`,
        });

        const report = await jsonFor(cwd);

        expect(report.version).toBe(1);
        expect(report.findings).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });

    it('carries the rule, file, line and message for a sibling-key value', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ color: 'balance' }} />;`,
        });

        const report = await jsonFor(cwd);
        const finding = report.findings.find(entry => entry.rule === 'sibling-keyword');

        expect(finding).toBeDefined();
        expect(finding?.file).toBe('src/App.tsx');
        expect(finding?.line).toBe(1);
        expect(finding?.message).toContain('text-balance');
        expect(process.exitCode).toBe(1);
    });

    it('carries a theme collision with the stylesheet line it was declared on', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";\n@theme {\n  --color-balance: #0af;\n}\n',
            'src/App.tsx': `export const A = () => <div sz={{ p: 4 }} />;`,
        });

        const report = await jsonFor(cwd);
        const finding = report.findings.find(entry => entry.rule === 'theme-collision');

        expect(finding?.file).toBe('src/app.css');
        expect(finding?.line).toBe(3);
    });

    it('carries an sz diagnostic, which already knew its own position', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ nonsenseKey: 4 }} />;`,
        });

        const report = await jsonFor(cwd);

        expect(report.findings.some(entry => entry.rule === 'sz-diagnostic')).toBe(true);
    });

    it('carries a dead class, naming the file that emitted it', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            // `pointer` is not an sz key, so the kebab pass-through ships
            // `pointer-none` — a class Tailwind has never served.
            'src/App.tsx': `export const A = () => <div sz={{ pointer: 'none' }} />;`,
        });

        const report = await jsonFor(cwd);
        const finding = report.findings.find(entry => entry.rule === 'dead-class');

        expect(finding?.file).toBe('src/App.tsx');
        expect(finding?.message).toContain('pointer-none');
    });

    it('still exits non-zero, so the flag changes the format and not the verdict', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ nonsenseKey: 4 }} />;`,
        });

        await jsonFor(cwd);

        expect(process.exitCode).toBe(1);
    });
});
