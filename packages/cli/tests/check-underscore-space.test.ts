/**
 * `csszyx check` names each `_` an `sz` value carries that the project's
 * Tailwind reads as a space, at the key that writes it.
 *
 * The question goes to every stylesheet the check compiled, through the same
 * `underscoreSpaceFindings` the build reads (PROJECT-RULES §4): `url()` keeps
 * its `_` because this Tailwind says so.
 */
import { stripVTControlCharacters } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '../src/commands/check.js';
import { removeTailwindProjects, tailwindProject } from './helpers/tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    process.exitCode = undefined;
    vi.restoreAllMocks();
});

const LINE =
    "export const A = () => <div sz={{ p: 4, content: \"'a_b'\", gridCols: '1fr 2fr', bgImg: 'url(/a_b.png)' }} />;";

/**
 * @param config - `csszyx.config.mjs`, when the case sets levels.
 * @returns The project root.
 */
function project(config?: string): string {
    return tailwindProject({
        'src/app.css': '@import "tailwindcss";',
        'src/A.tsx': LINE,
        ...(config === undefined ? {} : { 'csszyx.config.mjs': config }),
    });
}

/**
 * @param cwd - Project root.
 * @returns The findings `--json` writes.
 */
async function findingsFor(cwd: string): Promise<
    Array<{
        rule: string;
        kind: string;
        file?: string;
        line?: number;
        column?: number;
        args?: Record<string, unknown>;
    }>
> {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // One run's document only, when a case runs the command twice.
    log.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await check({ cwd, json: true });
    return JSON.parse(log.mock.calls.map(call => call.join(' ')).join('\n')).findings;
}

describe('csszyx check — an `_` read as a space', () => {
    it('reports the one Tailwind reads as a space, at its key, in the registry words', async () => {
        const findings = (await findingsFor(project())).filter(
            finding => finding.kind === 'underscore-space',
        );
        expect(findings).toEqual([
            expect.objectContaining({
                rule: 'dead-class',
                kind: 'underscore-space',
                file: 'src/A.tsx',
                line: 1,
                column: LINE.indexOf('content') + 1,
                args: expect.objectContaining({
                    key: 'content',
                    spaced: `"'a b'"`,
                    escaped: `"'a\\\\_b'"`,
                }),
            }),
        ]);
    });

    it('prints the site and what to write', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await check({ cwd: project() });
        const report = stripVTControlCharacters(
            log.mock.calls.map(call => call.join(' ')).join('\n'),
        );
        expect(report).toContain(`src/A.tsx:1:${LINE.indexOf('content') + 1}`);
        expect(report).toContain(`write \`content: "'a b'"\` for a space`);
    });

    it('reports it in a project whose stylesheet sets a prefix', async () => {
        const cwd = tailwindProject({
            'src/app.css': '@import "tailwindcss" prefix(tw);',
            'src/A.tsx': LINE,
        });
        const found = (await findingsFor(cwd)).filter(
            finding => finding.kind === 'underscore-space',
        );
        expect(found).toEqual([
            expect.objectContaining({
                args: expect.objectContaining({ className: "tw:content-['a_b']" }),
            }),
        ]);
    });

    it('leaves it out of a run that ignores its id, and keeps the dead-class pass', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        log.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await check({ cwd: project(), json: true, ignoreRule: ['underscore-space'] });
        const findings: Array<{ kind: string }> = JSON.parse(
            log.mock.calls.map(call => call.join(' ')).join('\n'),
        ).findings;
        expect(findings.filter(finding => finding.kind === 'underscore-space')).toEqual([]);
        // The rest of the dead-class pass still runs: `content-['a_b']` styles
        // something, so it is no `dead-class`, and nothing else is missing.
        expect(findings.filter(finding => finding.kind === 'dead-class')).toEqual([]);
    });

    it('says nothing when the config turns it off, or allows the class', async () => {
        const off = await findingsFor(
            project('export default { diagnostics: { rules: { "underscore-space": "off" } } };\n'),
        );
        expect(off.filter(finding => finding.kind === 'underscore-space')).toEqual([]);
        const allowed = await findingsFor(
            project(
                `export default { diagnostics: { allow: { classes: ["content-['a_b']"] } } };\n`,
            ),
        );
        expect(allowed.filter(finding => finding.kind === 'underscore-space')).toEqual([]);
    });
});
