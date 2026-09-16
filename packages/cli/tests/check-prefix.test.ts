/**
 * `csszyx check` lowers with the Tailwind prefix the project's stylesheet sets.
 *
 * Under `@import "tailwindcss" prefix(tw)` the project serves `tw:p-4` and
 * nothing for `p-4`. A check that lowered without the prefix asked Tailwind
 * about `p-4`, called every class dead, and told the author to fix `sz` keys
 * that were correct. The check reads the prefix from the stylesheets it
 * compiles anyway, and stops when they disagree on one, as a build does.
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
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'csszyx-check-prefix-')));
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
 * @param options - More check options.
 * @returns Every line written to the console.
 */
async function reportFor(
    cwd: string,
    options: Omit<Parameters<typeof check>[0], 'cwd'> = {},
): Promise<string> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'warn').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
    await check({ cwd, ...options });
    return lines.join('\n');
}

const CARD = 'export const Card = () => <div sz={{ p: 4 }} />;\n';

describe('csszyx check and the Tailwind prefix', () => {
    it('finds nothing dead in a prefixed project whose sz keys are right', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd);

        expect(report).not.toMatch(/style nothing|dead class/i);
        expect(process.exitCode).not.toBe(1);
    }, 60_000);

    it('stops when the stylesheets set different prefixes', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd);

        expect(report).toContain('set different prefixes');
        expect(report).toContain('src/app.css');
        expect(report).toContain('legacy/old.css');
        expect(process.exitCode).toBe(1);
    }, 60_000);

    it('names every entry, however many disagree', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'admin/admin.css': '@import "tailwindcss" prefix(ad);\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd);

        expect(report).toContain('admin/admin.css');
        expect(report).toContain('cannot be checked against all of them');
        expect(report).not.toContain('both');
    }, 60_000);

    it('skips the dead-class check, and says so, when the disagreement is ignored', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd, { ignoreRule: ['prefix-disagreement'] });

        expect(report).toContain('Dead-class check skipped');
        expect(report).toContain('--ignore-rule prefix-disagreement');
        expect(report).not.toContain('✖');
        expect(process.exitCode).not.toBe(1);
    }, 60_000);

    it('records the disagreement as a finding in the JSON report', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        await check({ cwd, json: true });

        const report = JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')) as {
            findings: Array<{ rule: string; kind: string }>;
        };
        expect(report.findings).toContainEqual(
            expect.objectContaining({ rule: 'dead-class', kind: 'prefix-disagreement' }),
        );
        expect(process.exitCode).toBe(1);
    }, 60_000);

    it('finds nothing dead in a stock project either', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd);

        expect(report).not.toMatch(/style nothing|dead class/i);
        expect(process.exitCode).not.toBe(1);
    }, 60_000);
});
