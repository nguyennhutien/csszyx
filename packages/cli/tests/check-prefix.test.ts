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

/** The skip line when `--rule` or `--ignore-rule` leaves the disagreement out. */
const SKIPPED_BY_SELECTION =
    'Dead-class check skipped: the Tailwind stylesheets set different prefixes, and `--rule` or `--ignore-rule` leaves `prefix-disagreement` out of this run.';

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

        expect(report).toContain(
            '\u2716 The Tailwind stylesheets of this project set different prefixes (`admin/admin.css` with `prefix(ad)`, `legacy/old.css` with none, `src/app.css` with `prefix(tw)`), so no class csszyx emits is served by all of them.\n' +
                '  help: give every Tailwind stylesheet the same `@import "tailwindcss"` line.\n' +
                '  note: the dead-class check did not run.',
        );
        expect(report).not.toContain('both');
    }, 60_000);

    it('skips the dead-class check, and says so, when the disagreement is ignored', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd, { ignoreRule: ['prefix-disagreement'] });

        expect(report).toContain(SKIPPED_BY_SELECTION);
        expect(report).not.toContain('✖');
        expect(process.exitCode).not.toBe(1);
    }, 60_000);

    it('names both flags when `--rule` is what left the disagreement out', async () => {
        // `--rule unsigned-value` selects a dead-class kind and leaves
        // `prefix-disagreement` out; the user never passed `--ignore-rule`.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': CARD,
        });

        const report = await reportFor(cwd, { rule: ['unsigned-value'] });

        expect(report).toContain(SKIPPED_BY_SELECTION);
    }, 60_000);

    it("runs the dead-class check with the first stylesheet's prefix when the config sets the disagreement to off", async () => {
        // `off` silences the finding, not the check: a class is dead only when
        // no stylesheet serves it, so `tw:p-4` is served and
        // `tw:pointer-none` is not.
        const cwd = projectWith({
            'app/app.css': '@import "tailwindcss" prefix(tw);\n',
            'legacy/old.css': '@import "tailwindcss";\n',
            'src/Card.tsx': "export const Card = () => <div sz={{ p: 4, pointer: 'none' }} />;\n",
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'prefix-disagreement': 'off' } } };\n",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('set different prefixes');
        expect(report).toMatch(/ {2}tw:pointer-none +src\/Card\.tsx/);
        expect(report).not.toMatch(/p-4 +src\/Card\.tsx/);
        expect(report).toContain('1 emitted class(es) produce no CSS');
        expect(process.exitCode).toBe(1);
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
