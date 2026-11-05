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
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CheckOptions, check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
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
    return findingsWith({ cwd, files });
}

/**
 * Run the command with any options and return its findings.
 *
 * @param options - Options for the run; `json` is forced on.
 * @returns The parsed findings.
 */
async function findingsWith(
    options: CheckOptions,
): Promise<Array<{ rule: string; file?: string }>> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check({ ...options, json: true });
    return JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;
}

/**
 * Run the command with prose output and return everything it printed.
 *
 * @param options - Options for the run.
 * @returns The printed text.
 */
async function printedBy(options: CheckOptions): Promise<string> {
    // The reporter writes every level through console.log, warnings too.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await check(options);
    return log.mock.calls.flat().join('\n');
}

// BOTH files carry a problem, so a run that ignored the list would report two
// findings and the scoping assertions would pass for the wrong reason.
const BAD = `export const A = () => <div sz={{ nonsenseKey: 4 }} />;`;
const OTHER_BAD = `export const B = () => <div sz={{ otherNonsense: 2 }} />;`;

describe('csszyx check --files', () => {
    it('checks exactly the files it was given', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['src/Bad.tsx']);

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Bad.tsx']));
        expect(process.exitCode).toBe(1);
    });

    it('leaves a file out of the run when it was not listed', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/Clean.tsx': `export const B = () => <div sz={{ p: 4 }} />;`,
        });

        const findings = await findingsFor(cwd, ['src/Clean.tsx']);

        expect(findings).toEqual([]);
        expect(process.exitCode).toBeUndefined();
    });

    it('takes several paths, as a hook hands them over', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
            'src/AlsoBad.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['src/Bad.tsx', 'src/AlsoBad.tsx']);
        const files = new Set(findings.map(entry => entry.file));

        expect(files).toEqual(new Set(['src/Bad.tsx', 'src/AlsoBad.tsx']));
    });

    it('accepts an absolute path, which is what a hook usually passes', async () => {
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'README.md': '# hi\n',
            'src/Bad.tsx': BAD,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsFor(cwd, ['README.md', 'src/Bad.tsx']);

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Bad.tsx']));
    });

    it('reports nothing when the list holds no source files at all', async () => {
        const cwd = tailwindProject({
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
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Real.tsx': BAD,
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, files: ['src/Missing.tsx'] });

        expect(process.exitCode).toBe(1);
    });

    it('names the path it could not read', async () => {
        const cwd = tailwindProject({ 'src/app.css': '@import "tailwindcss";' });
        // The reporter writes every level through console.log, warnings too.
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await check({ cwd, files: ['src/Missing.tsx'] });

        expect(log.mock.calls.flat().join('\n')).toContain('src/Missing.tsx');
    });

    it('reads a windows-style path as the file it names', async () => {
        // The separator a hook passes is not a statement about the filesystem.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Real.tsx': BAD,
        });

        const findings = await findingsFor(cwd, ['src\\Real.tsx']);

        expect(findings.some(finding => finding.rule === 'sz-diagnostic')).toBe(true);
    });

    it('accepts a windows-style glob for the same files as a posix one', async () => {
        const cwd = tailwindProject({
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

/**
 * `csszyx check <dir>` — the positional a person types first.
 *
 * `migrate [dir]` takes one, so `check src` failed with `Unused args`. The
 * directory narrows which files are scanned and nothing else: the stylesheet
 * and the Tailwind install are still found from the project root, because a
 * component folder carries neither, and findings keep project-relative paths.
 */
describe('csszyx check [dir]', () => {
    it('scans only the files under the directory', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/components/Bad.tsx': BAD,
            'src/pages/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsWith({ cwd, dir: 'src/components' });

        expect(new Set(findings.map(entry => entry.file))).toEqual(
            new Set(['src/components/Bad.tsx']),
        );
        expect(process.exitCode).toBe(1);
    });

    it('reads --pattern relative to the directory', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/components/Bad.tsx': BAD,
            'src/components/Other.jsx': OTHER_BAD,
            'src/pages/Also.jsx': BAD,
        });

        const findings = await findingsWith({ cwd, dir: 'src/components', pattern: '**/*.jsx' });

        expect(new Set(findings.map(entry => entry.file))).toEqual(
            new Set(['src/components/Other.jsx']),
        );
    });

    it('reads a windows-style directory as the one it names', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/components/Bad.tsx': BAD,
            'src/pages/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsWith({ cwd, dir: 'src\\components' });

        expect(new Set(findings.map(entry => entry.file))).toEqual(
            new Set(['src/components/Bad.tsx']),
        );
    });

    it('refuses a directory together with --files, since both choose the files', async () => {
        // Either answer would silently drop what the other one asked for.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
        });

        const printed = await printedBy({ cwd, dir: 'src', files: ['src/Bad.tsx'] });

        expect(process.exitCode).toBe(1);
        expect(printed).toContain(
            '✖ A directory and `--files` both choose the files to check: pass `src` or `--files`, not both.',
        );
        expect(printed).not.toContain('nonsenseKey');
    });

    it('fails on a directory that does not exist rather than passing on no files', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
        });

        const printed = await printedBy({ cwd, dir: 'scr' });

        expect(process.exitCode).toBe(1);
        expect(printed).toContain(
            `✖ \`scr\` does not exist under \`${cwd}\`, so there is nothing to check: pass a directory under it, or leave \`[dir]\` out to check the whole project.`,
        );
    });

    it('refuses an absolute --pattern, which would not stay inside the directory', async () => {
        // fast-glob reads an absolute pattern as absolute whatever root it is
        // given, so the run would scan outside the directory and not say so.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/components/Clean.tsx': 'export const C = () => <div sz={{ p: 4 }} />;',
            'src/pages/Bad.tsx': BAD,
        });

        const printed = await printedBy({
            cwd,
            dir: 'src/components',
            pattern: path.join(cwd, 'src/pages/**/*.tsx'),
        });

        expect(process.exitCode).toBe(1);
        expect(printed).toContain(
            'is an absolute path, so it would not stay inside `src/components`: pass a pattern relative to the directory.',
        );
        expect(printed).not.toContain('nonsenseKey');
    });

    it('points a single file at --files', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Bad.tsx': BAD,
        });

        const printed = await printedBy({ cwd, dir: 'src/Bad.tsx' });

        expect(process.exitCode).toBe(1);
        expect(printed).toContain(
            '✖ `src/Bad.tsx` is a file: to check single files, pass `--files src/Bad.tsx`.',
        );
    });
});

/**
 * The files a run reads when it is not told which.
 *
 * The build lowers every script module, `.ts` included: a `szv` call in a
 * `button.styles.ts` ships its classes like a component's `sz` prop does.
 * A default that read only `.jsx`/`.tsx` passed a project whose build
 * reported a dead class in such a file. Declaration files are not modules
 * the build lowers, so they stay out.
 */
describe('csszyx check — the files a default run reads', () => {
    // `outline-offset` takes whole pixels: Tailwind serves no `-0.5` step.
    const STYLES = `import { szv } from 'csszyx';
export const button = szv({ base: { outlineOffset: 0.5 } });
`;

    it('reports a dead class from a `.ts` module the build lowers', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/button.styles.ts': STYLES,
        });

        const findings = await findingsWith({ cwd });

        expect(findings).toContainEqual(
            expect.objectContaining({ rule: 'dead-class', file: 'src/button.styles.ts' }),
        );
    });

    it('reads the module flavours the build lowers too', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/a.mjs': BAD,
            'src/b.cts': `import { szv } from 'csszyx';\nexport const b = szv({ base: { otherNonsense: 2 } });\n`,
        });

        const files = new Set((await findingsWith({ cwd })).map(entry => entry.file));

        expect(files).toEqual(new Set(['src/a.mjs', 'src/b.cts']));
    });

    it('leaves a declaration file out of a default run', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/button.d.ts': STYLES,
        });

        expect(await findingsWith({ cwd })).toEqual([]);
    });

    it('drops a listed declaration file, as it drops a README', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/button.d.ts': STYLES,
        });

        expect(await findingsFor(cwd, ['src/button.d.ts'])).toEqual([]);
    });

    it('leaves out what `--ignore` names, the way a plugin `exclude` would be mirrored', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Button.stories.tsx': BAD,
            'src/button.stories.ts': STYLES,
            'src/Other.tsx': OTHER_BAD,
        });

        const findings = await findingsWith({
            cwd,
            ignore: ['**/*.stories.tsx', '**/*.stories.ts'],
        });

        expect(new Set(findings.map(entry => entry.file))).toEqual(new Set(['src/Other.tsx']));
    });

    it('lowers no file the build would not parse, though its text says `sz`', async () => {
        // `size` and a variable named `sz` carry no sz marker, so the build's
        // prescan never parses this file and never reports its syntax error.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'public/vendor.js': 'const sz = 1; const size = sz +;\n',
            'src/Real.jsx': BAD,
        });

        const files = new Set((await findingsWith({ cwd })).map(entry => entry.file));

        expect(files).toEqual(new Set(['src/Real.jsx']));
    });

    it('checks a file the build lowers though its `sz:` key is spaced', async () => {
        // The build's transform gate reads `sz :` followed by a value; the
        // check has to read the same file, or it passes what the build lowers.
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/Card.tsx':
                'export const C = () => <Card szs = {{ sz : { nonsenseKey: 4 } }} />;\n',
        });

        const files = new Set((await findingsWith({ cwd })).map(entry => entry.file));

        expect(files).toEqual(new Set(['src/Card.tsx']));
    });

    it.each(['src/button.d.mts', 'src/button.d.cts'])(
        'leaves the declaration file %s out of a default run',
        async name => {
            const cwd = tailwindProject({
                'src/app.css': '@import "tailwindcss";',
                [name]: STYLES,
            });

            expect(await findingsWith({ cwd })).toEqual([]);
        },
    );

    it('leaves the project config out, though it holds sz text', async () => {
        // Lowered, this text is a finding: the probe file proves it.
        const sz =
            'export default {};\nexport const b = () => szv({ base: { otherNonsense: 2 } });\n';
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'csszyx.config.mjs': sz,
            'src/probe.mjs': sz,
        });

        const files = new Set((await findingsWith({ cwd })).map(entry => entry.file));

        expect(files).toEqual(new Set(['src/probe.mjs']));
    });

    it('drops the project config from a file list', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'csszyx.config.mjs':
                'export default {};\nexport const b = () => szv({ base: { otherNonsense: 2 } });\n',
        });

        expect(await findingsFor(cwd, ['csszyx.config.mjs'])).toEqual([]);
    });

    it('checks a listed `.ts` file', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss";',
            'src/button.styles.ts': STYLES,
        });

        const findings = await findingsFor(cwd, ['src/button.styles.ts']);

        expect(findings.map(entry => entry.file)).toContain('src/button.styles.ts');
    });
});
