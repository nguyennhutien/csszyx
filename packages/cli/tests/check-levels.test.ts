/**
 * `csszyx check` reading levels from `csszyx.config` and failing on `error`.
 *
 * Before levels, every finding failed the run, so a gate that wanted unknown
 * keys but not precedence notes had to `--ignore-rule` them and lose them from
 * the report as well. Now a finding carries a level; the run fails only on
 * `error` (or on what `--fail-on` names), and `info`/`warn` findings are still
 * reported.
 *
 * The recommended preset must give the verdict 0.17.2 gave on every project,
 * except the two notes that report a choice rather than a mistake. The first
 * block pins that, one fixture per finding.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CheckOptions, check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

const CSS = '@import "tailwindcss";';

/**
 * Run the command quietly and answer its exit code and what it printed.
 *
 * @param cwd - Project root.
 * @param options - Options besides the root.
 * @returns The exit code and the printed text.
 */
async function run(
    cwd: string,
    options: Omit<CheckOptions, 'cwd'> = {},
): Promise<{ exitCode: number | undefined; printed: string }> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ ...options, cwd });
    const printed = [...log.mock.calls, ...warn.mock.calls].flat().join('\n');
    const exitCode = process.exitCode === undefined ? undefined : Number(process.exitCode);
    process.exitCode = undefined;
    log.mockRestore();
    warn.mockRestore();
    return { exitCode, printed };
}

/**
 * Run in JSON mode and parse the document.
 *
 * @param cwd - Project root.
 * @param options - Options besides the root and the format.
 * @returns The findings and the exit code.
 */
async function json(
    cwd: string,
    options: Omit<CheckOptions, 'cwd' | 'json'> = {},
): Promise<{
    exitCode: number | undefined;
    findings: Array<{ rule: string; kind: string; level: string; file?: string }>;
}> {
    const { exitCode, printed } = await run(cwd, { ...options, json: true });
    return { exitCode, findings: JSON.parse(printed).findings };
}

/** One component per finding check reports, and the 0.17.2 exit code for it. */
const PARITY: ReadonlyArray<
    readonly [
        name: string,
        files: Record<string, string>,
        before: 1 | undefined,
        now: 1 | undefined,
    ]
> = [
    [
        'a clean project',
        { 'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;' },
        undefined,
        undefined,
    ],
    [
        'unknown-key',
        { 'src/A.tsx': 'export const A = () => <div sz={{ nonsenseKey: 4 }} />;' },
        1,
        1,
    ],
    [
        'canonical-key',
        { 'src/A.tsx': "export const A = () => <div sz={{ fontWeight: 'bold' }} />;" },
        1,
        1,
    ],
    [
        'moved-value',
        { 'src/A.tsx': "export const A = () => <div sz={{ touchAction: 'pan-y' }} />;" },
        1,
        1,
    ],
    ['szs-slot-map', { 'src/A.tsx': 'export const A = () => <Card szs={slots} />;' }, 1, 1],
    [
        'dead-class',
        { 'src/A.tsx': "export const A = () => <div sz={{ pointer: 'none' }} />;" },
        1,
        1,
    ],
    [
        'sibling-keyword',
        { 'src/A.tsx': "export const A = () => <div sz={{ color: 'balance' }} />;" },
        1,
        1,
    ],
    [
        'theme-collision',
        {
            'src/app.css': `${CSS}\n@theme {\n  --color-balance: #0af;\n}\n`,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
        },
        1,
        1,
    ],
    [
        'broken-opacity',
        {
            'src/app.css': `${CSS}\n@theme {\n  --color-direct: 17, 119, 224;\n}\n`,
            'src/A.tsx': "export const A = () => <div sz={{ bg: { color: 'direct', op: 30 } }} />;",
        },
        1,
        1,
    ],
    [
        'prefix-disagreement',
        {
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss" prefix(ad);\n',
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
        },
        1,
        1,
    ],
    [
        'class-precedence',
        {
            'src/A.tsx':
                'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
        },
        1,
        undefined,
    ],
    [
        'duplicate-sz',
        { 'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;' },
        1,
        undefined,
    ],
];

describe('the recommended preset keeps the 0.17.2 verdict', () => {
    it.each(PARITY)('%s', async (name, files, before, now) => {
        const cwd = tailwindProject({ 'src/app.css': CSS, ...files });

        const { exitCode, findings } = await json(cwd);

        if (name !== 'a clean project') {
            expect(findings.map(finding => finding.kind)).toContain(name);
        }
        // Only the two notes about a choice changed their verdict.
        if (name === 'class-precedence' || name === 'duplicate-sz') {
            expect(before).toBe(1);
            expect(now).toBeUndefined();
        } else {
            expect(now).toBe(before);
        }
        expect(exitCode).toBe(now);
    });

    it('fails on the two notes again under --fail-on info, as 0.17.2 did', async () => {
        for (const [name, files, before] of PARITY.filter(([id]) =>
            ['class-precedence', 'duplicate-sz'].includes(id),
        )) {
            const cwd = tailwindProject({ 'src/app.css': CSS, ...files });
            expect([name, (await run(cwd, { failOn: 'info' })).exitCode]).toEqual([name, before]);
        }
    });
});

const PRECEDENCE = 'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;';
const TYPO = 'export const B = () => <div sz={{ nonsenseKey: 4 }} />;';
// An alias: a diagnostic whose class is still served, so no dead-class finding rides along.
const ALIAS = "export const C = () => <div sz={{ fontWeight: 'bold' }} />;";

describe('levels from csszyx.config', () => {
    it('still reports an info finding, with its level, and passes', async () => {
        const cwd = tailwindProject({ 'src/app.css': CSS, 'src/A.tsx': PRECEDENCE });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([
            expect.objectContaining({ kind: 'class-precedence', level: 'info' }),
        ]);
        expect(exitCode).toBeUndefined();
    });

    it('gives every finding its level in --json', async () => {
        const cwd = tailwindProject({ 'src/app.css': CSS, 'src/A.tsx': `${PRECEDENCE}\n${TYPO}` });

        const { findings } = await json(cwd);

        expect(findings.map(finding => [finding.kind, finding.level])).toEqual(
            expect.arrayContaining([
                ['class-precedence', 'info'],
                ['unknown-key', 'error'],
            ]),
        );
    });

    it('fails on a note the config raises to error', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': PRECEDENCE,
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'class-precedence': 'error' } } };",
        });

        expect((await run(cwd)).exitCode).toBe(1);
    });

    it('leaves a finding set to off out of the report and the verdict', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': ALIAS,
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'canonical-key': 'off' } } };",
        });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([]);
        expect(exitCode).toBeUndefined();
    });

    it('lowers a finding to warn, reports it and passes, unless --fail-on warn', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': ALIAS,
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'canonical-key': 'warn' } } };",
        });

        const passed = await run(cwd);
        expect(passed.exitCode).toBeUndefined();
        expect(passed.printed).toContain('(warn)');
        expect(passed.printed).toContain('1 below --fail-on error');
        expect((await run(cwd, { failOn: 'warn' })).exitCode).toBe(1);
    });

    it('applies a pass level to the kind it reports under the dead-class pass', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': "export const A = () => <div sz={{ pointer: 'none' }} />;",
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'dead-class': 'warn', 'unknown-key': 'off' } } };",
        });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([expect.objectContaining({ rule: 'dead-class', level: 'warn' })]);
        expect(exitCode).toBeUndefined();
    });

    it('applies an override to the files it matches only', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/legacy/Old.tsx': ALIAS,
            'src/New.tsx': ALIAS,
            'csszyx.config.mjs':
                "export default { diagnostics: { overrides: [{ files: ['src/legacy/**'], rules: { 'canonical-key': 'off' } }] } };",
        });

        const { findings } = await json(cwd);

        expect(findings.map(finding => finding.file)).toEqual(['src/New.tsx']);
    });

    it('reads the allow lists as --allow and --allow-token', async () => {
        const cwd = tailwindProject({
            'src/app.css': `${CSS}\n@theme {\n  --color-balance: #0af;\n}\n`,
            'src/A.tsx': "export const A = () => <div sz={{ pointer: 'none' }} />;",
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'unknown-key': 'off' }, allow: { classes: ['pointer-none'], tokens: ['balance'] } } };",
        });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([]);
        expect(exitCode).toBeUndefined();
    });

    it('runs the merge audit without --rule once the config reports it as warn', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <b sz={{ px: 2, p: 4 }} />;',
            'csszyx.config.mjs': "export default { diagnostics: { preset: 'atomic' } };",
        });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([
            expect.objectContaining({ rule: 'merge-covered-key', level: 'warn' }),
        ]);
        expect(exitCode).toBeUndefined();
    });

    it('runs the merge audit when an override reports it as warn', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <b sz={{ px: 2, p: 4 }} />;',
            'csszyx.config.mjs':
                "export default { diagnostics: { overrides: [{ files: ['src/**'], rules: { 'merge-covered-key': 'warn', 'dead-class': 'info' } }] } };",
        });

        const { findings } = await json(cwd);

        expect(findings).toEqual([
            expect.objectContaining({ rule: 'merge-covered-key', level: 'warn' }),
        ]);
    });

    it('leaves out a prefix disagreement the config sets to off, and passes', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss" prefix(tw);\n',
            'admin/admin.css': '@import "tailwindcss" prefix(ad);\n',
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'prefix-disagreement': 'off' } } };",
        });

        const { exitCode, findings } = await json(cwd);

        expect(findings).toEqual([]);
        expect(exitCode).toBeUndefined();
    });

    it('fails on a merge-audit finding the config raises to error', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <b sz={{ px: 2, p: 4 }} />;',
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'merge-covered-key': 'error' } } };",
        });

        expect((await run(cwd)).exitCode).toBe(1);
    });

    it('keeps --rule a selection: it does not raise an info finding to a failure', async () => {
        const cwd = tailwindProject({ 'src/app.css': CSS, 'src/A.tsx': PRECEDENCE });

        const { exitCode, findings } = await json(cwd, { rule: ['class-precedence'] });

        expect(findings).toEqual([expect.objectContaining({ level: 'info' })]);
        expect(exitCode).toBeUndefined();
    });
});

describe('a config check cannot trust', () => {
    it('fails the run on an id it does not know, naming the one it most likely means', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'dead-clas': 'off' } } };",
        });

        const { exitCode, printed } = await run(cwd);

        expect(printed).toContain('did you mean `dead-class`?');
        expect(exitCode).toBe(1);
    });

    it('prints the config problems on stderr in --json, keeping stdout one document', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
            'csszyx.config.mjs':
                "export default { diagnostics: { rules: { 'dead-clas': 'off' } } };",
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await check({ cwd, json: true });

        expect(JSON.parse(log.mock.calls.flat().join('\n')).findings).toEqual([]);
        expect(error.mock.calls.flat().join('\n')).toContain('dead-clas');
        expect(process.exitCode).toBe(1);
    });

    it('passes on a plugin option in the file, warning that only the bundler reads it', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
            'csszyx.config.mjs': 'export default { development: { debug: true } };',
        });

        const { exitCode, printed } = await run(cwd);

        expect(printed).toContain('`development` is not read from this file');
        expect(exitCode).toBeUndefined();
    });

    it('fails the run when the config does not load', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
        });
        writeFileSync(join(cwd, 'csszyx.config.mjs'), 'export default { diagnostics: {;\n');

        const { exitCode, printed } = await run(cwd);

        expect(printed).toContain('could not be loaded');
        expect(exitCode).toBe(1);
    });

    it('passes on the config `csszyx init` wrote into a JavaScript project, warning that it is ignored', async () => {
        const cwd = tailwindProject({
            'src/app.css': CSS,
            'src/A.tsx': 'export const A = () => <div sz={{ p: 4 }} />;',
        });
        writeFileSync(
            join(cwd, 'csszyx.config.js'),
            "import type { CsszyxConfig } from 'csszyx';\n\nconst config: CsszyxConfig = {\n  development: {\n    debug: true,\n  },\n};\n\nexport default config;\n",
        );

        const { exitCode, printed } = await run(cwd);

        expect(printed).toContain('could not be loaded');
        expect(printed).toContain('`csszyx init`');
        expect(exitCode).toBeUndefined();
    });

    it('refuses a --fail-on level it does not know', async () => {
        const cwd = tailwindProject({ 'src/app.css': CSS, 'src/A.tsx': PRECEDENCE });

        const { exitCode, printed } = await run(cwd, { failOn: 'fatal' as 'error' });

        expect(printed).toContain('--fail-on "fatal"');
        expect(exitCode).toBe(1);
    });
});
