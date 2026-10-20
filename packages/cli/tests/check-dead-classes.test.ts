/**
 * `csszyx check` asking Tailwind whether the classes it emitted are real.
 *
 * Each fixture gets its own `node_modules/tailwindcss`, because that is what
 * the command resolves and what a real project has. Leaving it out is not a
 * neutral simplification: resolution would walk up into whatever tree the
 * fixture happens to sit in — inside this repository that finds the v3 copy
 * `csszyx migrate` pins — and every case would pass as a skip.
 */
import { mkdirSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

/** The repository's `@tailwindcss/node`, whose resolver the oracle borrows. */
const TAILWIND_NODE = path.resolve(
    path.dirname(
        createRequire(path.resolve(import.meta.dirname, '../../../package.json')).resolve(
            '@tailwindcss/node',
        ),
    ),
    '..',
);

afterEach(() => {
    removeTailwindProjects();
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

/**
 * Run the command over a project and return everything it printed, without
 * the colour codes a CI runner with `FORCE_COLOR` adds around each line.
 *
 * @param cwd - Project root.
 * @param allow - Classes to accept even when they produce no CSS.
 * @returns Concatenated report text.
 */
async function reportFor(cwd: string, allow?: string[]): Promise<string> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ cwd, allow });
    return stripVTControlCharacters(log.mock.calls.map(call => call.join(' ')).join('\n'));
}

describe('csszyx check — classes that style nothing', () => {
    it('reports a class the mapping emitted that Tailwind does not serve', async () => {
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme { --color-brand: #123456; }',
            'src/Good.tsx': "export const Good = () => <div sz={{ bg: 'brand' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).not.toContain('bg-brand');
        expect(process.exitCode).not.toBe(1);
    });

    it('accepts a custom breakpoint and rejects a typo of it', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@theme { --breakpoint-tablet: 900px; }',
            'src/Ok.tsx': 'export const Ok = () => <div sz={{ tablet: { p: 4 } }} />;',
            'src/Typo.tsx': 'export const Typo = () => <div sz={{ tablt: { p: 4 } }} />;',
        });

        const report = await reportFor(cwd);

        expect(report).toContain('tablt');
        expect(report).not.toContain('tablet:p-4');
    });

    it('says why it could not check when the project has no Tailwind installed', async () => {
        const cwd = tailwindProject(
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
        const cwd = tailwindProject({
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(cwd);

        expect(report).toMatch(/skipped|could not/i);
        expect(report).not.toContain('pointer-none');
    });

    // A skip is the honest answer when there is nothing to ask, and a silent
    // pass when the question WAS asked and could not be answered. The two look
    // identical in CI unless the second one fails, so a project whose entry
    // stops compiling keeps a green check that has not run since.
    it('fails when the project has a stylesheet that will not compile', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@import "@absent/design-system/tokens";',
            'src/Good.tsx': 'export const Good = () => <div sz={{ p: 4 }} />;',
        });

        const report = await reportFor(cwd);

        expect(report).toContain('skipped');
        expect(process.exitCode).toBe(1);
    });

    // Tailwind's own resolver (`@tailwindcss/node` 4.3.3) reads a bare target
    // as a package; Vite's reads the file next door first. The check knows no
    // bundler, so a stylesheet a Vite build compiles must not fail it.
    it('reads a bare import as the sibling file, with a Tailwind integration installed', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";\n@import "tokens.css";',
            'src/tokens.css': '@theme { --color-brand: #123456; }',
            'src/Good.tsx': "export const Good = () => <div sz={{ bg: 'brand' }} />;",
        });
        const node = path.join(cwd, 'node_modules/@tailwindcss');
        mkdirSync(node, { recursive: true });
        symlinkSync(TAILWIND_NODE, path.join(node, 'node'), 'junction');

        const report = await reportFor(cwd);

        expect(report).not.toContain('skipped');
        expect(report).not.toContain('bg-brand');
        expect(process.exitCode).not.toBe(1);
    });

    it('still passes when the environment simply has nothing to ask', async () => {
        // No Tailwind installed is not a broken project — there is no design
        // system to consult, and failing here would break every consumer whose
        // build does not use one.
        const cwd = tailwindProject(
            {
                'src/app.css': '@import "tailwindcss";',
                'src/Good.tsx': 'export const Good = () => <div sz={{ p: 4 }} />;',
            },
            { tailwind: false },
        );

        await reportFor(cwd);

        expect(process.exitCode).not.toBe(1);
    });

    // Without a way to accept a known finding, the only lever a project has is
    // to stop running the check at all.
    it('accepts a class the project vouched for, and keeps reporting the rest', async () => {
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
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

describe('csszyx check — a relative --cwd', () => {
    // `--cwd apps/web` is how a monorepo root runs it. Tailwind and the content
    // scanner are resolved from that directory, and a relative path reached
    // them as-is: the dead-class pass skipped with an info line, and the merge
    // audit threw inside `createRequire`.
    it('asks Tailwind about the emitted classes, as an absolute --cwd does', async () => {
        const root = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });

        const report = await reportFor(path.relative(process.cwd(), root));

        expect(report).toMatch(/pointer-none\s+src\/Bad\.tsx/);
        expect(report).not.toContain('Dead-class check skipped');
        expect(process.exitCode).toBe(1);
    });

    it('reads the project from the working directory when no --cwd is given', async () => {
        const root = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': "export const Bad = () => <div sz={{ pointer: 'none' }} />;",
        });
        vi.spyOn(process, 'cwd').mockReturnValue(root);
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({});

        expect(log.mock.calls.flat().join('\n')).toMatch(/pointer-none\s+src\/Bad\.tsx/);
    });

    it('runs the merge audit', async () => {
        const root = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Card.tsx': 'export const Card = () => <div sz={{ pb: 2, p: 4 }} />;',
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd: path.relative(process.cwd(), root), rule: ['merge-covered-key'] });

        expect(log.mock.calls.flat().join('\n')).toContain('pb-2');
    });
});

describe('csszyx check — a sign this project serves no negative of', () => {
    /**
     * Run the command in JSON mode over a project.
     *
     * @param cwd - Project root.
     * @param rule - The `--rule` ids, when the run narrows to some.
     * @returns The findings.
     */
    async function findingsFor(
        cwd: string,
        rule?: string[],
    ): Promise<Array<{ rule: string; kind: string; file?: string; message: string }>> {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await check({ cwd, json: true, rule });
        return JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;
    }

    const SIGNED =
        "export const A = () => <div sz={{ p: -2, mt: -2, 'data-[state=open]': { p: -3 }, 'group-hover': { w: -4 } }} />;";

    it('reports each class once, as unsigned-value under the dead-class pass', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx': SIGNED,
        });
        const findings = (await findingsFor(cwd)).filter(entry => entry.rule === 'dead-class');
        // `-mt-2` is served: margins have negatives.
        expect(findings).toEqual([
            {
                rule: 'dead-class',
                kind: 'unsigned-value',
                file: 'src/A.tsx',
                level: 'error',
                message:
                    '"-p-2" is emitted, and this project\'s Tailwind serves no negative "p-2": drop the sign, or define it with @utility.',
            },
            expect.objectContaining({
                kind: 'unsigned-value',
                message: expect.stringContaining('"data-[state=open]:-p-3"'),
            }),
            expect.objectContaining({
                kind: 'unsigned-value',
                message: expect.stringContaining('"group-hover:-w-4"'),
            }),
        ]);
        expect(process.exitCode).toBe(1);
    });

    it('says it apart from the dead classes in the human report', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx': "export const A = () => <div sz={{ p: -2, break: 'bogus' }} />;",
        });
        const report = await reportFor(cwd);
        expect(report).toContain('break-bogus');
        expect(report).toMatch(
            /Negative values this project's Tailwind does not serve:\n.*-p-2 +src\/A\.tsx/,
        );
        expect(report).not.toMatch(/Classes that produce no CSS:\n(.*\n)*.*-p-2 /);
    });

    it('runs the pass for --rule unsigned-value alone', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx': "export const A = () => <div sz={{ p: -2, break: 'bogus' }} />;",
        });
        const findings = await findingsFor(cwd, ['unsigned-value']);
        expect(findings.filter(entry => entry.rule === 'dead-class')).toEqual([
            expect.objectContaining({ kind: 'unsigned-value', file: 'src/A.tsx' }),
        ]);
    });

    it('says a class dead without its sign too as dead-class, once', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx':
                "export const A = () => <div sz={{ p: '-medium', hover: { p: '-wide' } }} />;",
        });
        const findings = (await findingsFor(cwd)).filter(entry => entry.rule === 'dead-class');
        expect(findings).toEqual([
            expect.objectContaining({
                file: 'src/A.tsx',
                message:
                    '"-p-medium" is emitted but produces no CSS under this project\'s Tailwind.',
            }),
            expect.objectContaining({
                message:
                    '"hover:-p-wide" is emitted but produces no CSS under this project\'s Tailwind.',
            }),
        ]);
        expect(findings.filter(entry => entry.kind === 'unsigned-value')).toEqual([]);
    });

    it('passes a project that defines the negative with @utility', async () => {
        const cwd = tailwindProject({
            'src/app.css':
                '@import "tailwindcss";\n@utility -p-* { padding: calc(--value(integer) * -1px); }',
            'src/A.tsx': 'export const A = () => <div sz={{ p: -2 }} />;',
        });
        const findings = await findingsFor(cwd);
        expect(findings.filter(entry => entry.kind === 'unsigned-value')).toEqual([]);
        expect(process.exitCode).not.toBe(1);
    });
});

describe('csszyx check — a variant the project does not serve', () => {
    /**
     * Run the command with `--json` and return its findings.
     *
     * @param cwd - Project root.
     * @param rule - The `--rule` selection, when given.
     * @returns The findings.
     */
    async function findingsFor(
        cwd: string,
        rule?: string[],
    ): Promise<Array<Record<string, unknown>>> {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await check({ cwd, json: true, rule });
        return JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;
    }

    const STATES =
        'export const A = () => <div sz={{ hidden: { p: 4 }, hovr: { p: 4 }, checked: { p: 2 }, aria: { expanded: { p: 1 } }, md: { expanded: { m: 1 } } }} />;';

    it('names the variant, by the project’s Tailwind, once per class', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx': STATES,
        });
        const findings = (await findingsFor(cwd)).filter(entry => entry.rule === 'dead-class');

        // `checked:p-2` and `aria-expanded:p-1` are served, and not named.
        expect(findings).toEqual([
            expect.objectContaining({
                kind: 'unserved-variant',
                file: 'src/A.tsx',
                level: 'error',
                args: { form: 'attribute-or-aria', variant: 'hidden', className: 'hidden:p-4' },
                message: expect.stringContaining('`hidden:p-4`'),
                help: expect.stringContaining("`{ '[hidden]': { … } }`"),
                url: 'https://csszyx.com/e/unserved-variant',
            }),
            expect.objectContaining({
                kind: 'unserved-variant',
                args: { form: 'unknown', variant: 'hovr', className: 'hovr:p-4' },
                help: 'check the spelling of `hovr`.',
                note: expect.stringContaining('@custom-variant'),
            }),
            expect.objectContaining({
                kind: 'unserved-variant',
                args: { form: 'aria', variant: 'expanded', className: 'md:expanded:m-1' },
            }),
        ]);
        expect(process.exitCode).toBe(1);
    });

    it('lists them apart from the classes that produce no CSS', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx':
                "export const A = () => <div sz={{ hidden: { p: 4 }, break: 'bogus' }} />;",
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await check({ cwd });
        const report = stripVTControlCharacters(
            log.mock.calls.map(call => call.join(' ')).join('\n'),
        );

        expect(report).toMatch(
            /Variants this project's Tailwind does not serve:\n.*hidden:p-4 +src\/A\.tsx/,
        );
        expect(report).not.toMatch(/Classes that produce no CSS:\n(.*\n)*.*hidden:p-4 /);
        expect(report).toContain('break-bogus');
    });

    it('runs the pass for --rule unserved-variant alone', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/A.tsx':
                "export const A = () => <div sz={{ hidden: { p: 4 }, break: 'bogus' }} />;",
        });
        const findings = await findingsFor(cwd, ['unserved-variant']);
        expect(findings.filter(entry => entry.rule === 'dead-class')).toEqual([
            expect.objectContaining({ kind: 'unserved-variant', file: 'src/A.tsx' }),
        ]);
    });

    it('passes a project that defines the variant with @custom-variant', async () => {
        const cwd = tailwindProject({
            'src/app.css':
                '@import "tailwindcss";\n@custom-variant expanded (&[aria-expanded=true]);',
            'src/A.tsx': 'export const A = () => <div sz={{ expanded: { p: 4 } }} />;',
        });
        const findings = await findingsFor(cwd);
        expect(findings.filter(entry => entry.rule === 'dead-class')).toEqual([]);
        expect(process.exitCode).not.toBe(1);
    });
});
