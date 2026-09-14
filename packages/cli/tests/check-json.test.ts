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

import { type CheckOptions, check } from '../src/commands/check.js';

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
 * Run the command in JSON mode and parse everything it wrote to stdout.
 *
 * @param cwd - Project root.
 * @param options - Options for the run besides the root and the format.
 * @returns The parsed report.
 */
async function jsonFor(
    cwd: string,
    options: Omit<CheckOptions, 'cwd' | 'json'> = {},
): Promise<{
    version: number;
    findings: Array<{
        rule: string;
        kind?: string;
        file?: string;
        line?: number;
        message: string;
    }>;
}> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ ...options, cwd, json: true });
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

// `line` is optional in the document, and a consumer has to be able to tell
// "no position" from "line zero". The engine renders the position into its own
// message text and this reads it back from there rather than deriving a second
// answer, so a diagnostic the engine could not place carries none here either.
describe('csszyx check --json — a diagnostic that names no line', () => {
    it('omits the line rather than inventing one', async () => {
        // An `szs` slot map built from a variable: the engine reports the
        // attribute it left alone, but has no single position to blame.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <Card szs={slots} />;`,
        });

        const doc = await jsonFor(cwd);
        const finding = doc.findings.find(entry => entry.rule === 'sz-diagnostic');

        expect(finding?.message).toContain('slot');
        expect(finding?.line).toBeUndefined();
    });
});

/**
 * One `rule` covered three different things: a typo'd key, an alias, and a note
 * that `sz` beats a runtime `className`. A gate that wanted only the first two
 * had to match the English of each message, and rewording one turned the gate
 * green. Each finding now carries the kind the compiler reads from its own
 * wording, and a run can be narrowed to the rules and kinds it gates on.
 */
describe('csszyx check --json — diagnostic kinds and rule selection', () => {
    const PRECEDENCE_AND_TYPO = [
        'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
        'export const B = () => <div sz={{ nonsenseKey: 4 }} />;',
    ].join('\n');

    it('names the kind of each sz diagnostic', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': PRECEDENCE_AND_TYPO,
        });

        const report = await jsonFor(cwd);
        const diagnostics = report.findings.filter(entry => entry.rule === 'sz-diagnostic');

        expect(diagnostics.map(entry => entry.kind)).toEqual(
            expect.arrayContaining(['class-precedence', 'unknown-key']),
        );
    });

    it('gives a finding from another pass its rule as its kind', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ pointer: 'none' }} />;`,
        });

        const report = await jsonFor(cwd);
        const dead = report.findings.find(entry => entry.rule === 'dead-class');

        expect(dead?.kind).toBe('dead-class');
    });

    it('drops an ignored kind from the findings and from the exit code', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx':
                'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
        });

        const report = await jsonFor(cwd, { ignoreRule: ['class-precedence'] });

        expect(report.findings).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });

    it('leaves an ignored pass out while the passes beside it still run', async () => {
        // The dead-class pass also reports broken opacity, so ignoring one of
        // its two rules must not drop the other or print the pass as clean.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ pointer: 'none' }} />;`,
        });

        const report = await jsonFor(cwd, { ignoreRule: ['dead-class'] });

        expect(report.findings.some(entry => entry.rule === 'dead-class')).toBe(false);
    });

    it('keeps only the selected kinds when --rule is given', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `${PRECEDENCE_AND_TYPO}\nexport const C = () => <div sz={{ pointer: 'none' }} />;`,
        });

        const report = await jsonFor(cwd, { rule: ['unknown-key'] });

        expect(new Set(report.findings.map(entry => entry.kind))).toEqual(new Set(['unknown-key']));
        expect(process.exitCode).toBe(1);
    });

    it('selects a whole pass by its rule id', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `${PRECEDENCE_AND_TYPO}\nexport const C = () => <div sz={{ pointer: 'none' }} />;`,
        });

        const report = await jsonFor(cwd, { rule: ['dead-class'] });

        expect(new Set(report.findings.map(entry => entry.rule))).toEqual(new Set(['dead-class']));
    });

    it('suggests the key an unknown key most likely misspells', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ workBreak: 'all' }} />;`,
        });

        const report = await jsonFor(cwd);
        const unknown = report.findings.find(entry => entry.kind === 'unknown-key') as
            | { suggestion?: string }
            | undefined;

        expect(unknown?.suggestion).toBe('break');
    });

    it('prints the suggestion under the diagnostic in the prose report', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': `export const A = () => <div sz={{ workBreak: 'all' }} />;`,
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd });

        expect(log.mock.calls.flat().join('\n')).toContain('Did you mean "break"?');
    });

    it.each(['runtime-fallback', 'parse-error', 'mangle-vars-hoist-skip'])(
        'refuses %s, which check never reports, rather than selecting nothing',
        async id => {
            const cwd = projectWith({
                'src/app.css': '@import "tailwindcss";',
                'src/App.tsx': PRECEDENCE_AND_TYPO,
            });
            const log = vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            await check({ cwd, rule: [id] });

            expect(process.exitCode).toBe(1);
            expect(log.mock.calls.flat().join('\n')).toContain(`"${id}"`);
        },
    );

    it('does not call a run clean when its only issues were left out', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx':
                'export const A = (props) => <div className={props.className} sz={{ p: 4 }} />;',
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, ignoreRule: ['class-precedence'] });
        const printed = log.mock.calls.flat().join('\n');

        expect(printed).not.toContain('No sz issues found');
        expect(printed).toContain('1 left out by --rule or --ignore-rule');
        expect(process.exitCode).toBeUndefined();
    });

    it('counts the issues left out beside the ones it reports', async () => {
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': PRECEDENCE_AND_TYPO,
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, ignoreRule: ['class-precedence'] });

        expect(log.mock.calls.flat().join('\n')).toContain(
            '1 more sz issue(s) left out by --rule or --ignore-rule.',
        );
    });

    it('refuses an id no rule or kind has, rather than selecting nothing', async () => {
        // A misspelt --rule that matched nothing would pass every run.
        const cwd = projectWith({
            'src/app.css': '@import "tailwindcss";',
            'src/App.tsx': PRECEDENCE_AND_TYPO,
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, rule: ['unknwn-key'] });

        expect(process.exitCode).toBe(1);
        expect(log.mock.calls.flat().join('\n')).toContain('"unknwn-key"');
    });
});
