/**
 * The Next stylesheet facts follow `.gitignore`, and say when it changed.
 *
 * The prebuild, the watcher and the loader each walk the project for
 * stylesheets, and must find the same ones: a stale copy under a gitignored
 * `out/` would otherwise vote on the prefix in one and not in another. The
 * record carries a fingerprint of every `.gitignore` its walk applied, so an
 * edit that drops a stylesheet makes it stale rather than silently wrong.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    projectStylesheetCandidates,
    projectStylesheetGitignore,
    readNextStylesheetFacts,
    resolveNextClassPrefix,
    unreadNextPrefixMessage,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

const PREFIXED = '@import "tailwindcss" prefix(tw);\n';

/**
 * A Next-shaped app with the given files.
 *
 * @param files - Files relative to the root.
 * @returns The root and its csszyx cache directory.
 */
function app(files: Record<string, string>): { root: string; cacheDir: string } {
    const root = tailwindProject('csszyx-next-facts-gitignore-', files);
    return { root, cacheDir: join(root, '.csszyx/cache') };
}

describe('the stylesheet facts a Next command writes', () => {
    it('leave out a stylesheet .gitignore covers', async () => {
        const { root, cacheDir } = app({
            '.gitignore': 'out/\n',
            'app/globals.css': PREFIXED,
            // A stale export from an older build, with an older prefix.
            'out/_next/static/app.css': '@import "tailwindcss" prefix(old);\n',
        });

        const { record } = await writeNextStylesheetFacts({ root, cacheDir });

        expect(record.schema).toBe(4);
        expect(record.facts?.prefix).toBe('tw');
        expect(record.candidates).toEqual([join(root, 'app/globals.css')]);
        expect(record.gitignore.map(entry => entry.file)).toEqual([join(root, '.gitignore')]);
        expect(resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] })).toMatchObject({
            ok: true,
            prefix: 'tw',
        });
    }, 60_000);

    it('keep a gitignored stylesheet a recorded one imports', async () => {
        const { root, cacheDir } = app({
            '.gitignore': 'generated/\n',
            'app/globals.css': '@import "../generated/tailwind.css";\n',
            'generated/tailwind.css': PREFIXED,
        });

        const { record } = await writeNextStylesheetFacts({ root, cacheDir });

        expect(record.facts?.prefix).toBe('tw');
        expect(record.candidates.sort()).toEqual([
            join(root, 'app/globals.css'),
            join(root, 'generated/tailwind.css'),
        ]);
    }, 60_000);

    it('read as stale once a .gitignore changes what the walk finds', async () => {
        const { root, cacheDir } = app({
            '.gitignore': 'out/\n',
            'app/globals.css': PREFIXED,
            'legacy/theme.css': '@theme { --color-brand: #123456; }\n',
        });
        await writeNextStylesheetFacts({ root, cacheDir });
        // Warm the loader's walk, which is kept until the facts file changes.
        expect(projectStylesheetCandidates(root, cacheDir)).toHaveLength(2);

        writeFileSync(join(root, '.gitignore'), 'out/\nlegacy/\n');

        const read = readNextStylesheetFacts(cacheDir, {
            root,
            candidates: projectStylesheetCandidates(root, cacheDir),
            gitignore: projectStylesheetGitignore(root, cacheDir),
        });
        expect(read.ok ? '' : read.reason).toContain('.gitignore changed');
        const loader = resolveNextClassPrefix({
            root,
            cacheDir,
            tailwindStylesheet: [],
            candidates: projectStylesheetCandidates(root, cacheDir),
            gitignore: projectStylesheetGitignore(root, cacheDir),
        });
        expect(loader).toMatchObject({ ok: false });
        // A caller that hands candidates alone is still told: the recorded
        // `.gitignore` files are read as they are now.
        expect(
            resolveNextClassPrefix({
                root,
                cacheDir,
                tailwindStylesheet: [],
                candidates: projectStylesheetCandidates(root, cacheDir),
            }),
        ).toMatchObject({ ok: false });
    }, 60_000);

    it('ask for a new prebuild when the record is from before the fingerprint', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        const { path: file } = await writeNextStylesheetFacts({ root, cacheDir });
        const { gitignore: _gitignore, ...older } = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...older, schema: 3 }));

        const prefix = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] });

        expect(prefix.ok).toBe(false);
        const reason = prefix.ok ? '' : prefix.reason;
        expect(reason).toContain('an older csszyx');
        expect(unreadNextPrefixMessage(root, reason, 'the loader')).toContain(
            'csszyx next prebuild',
        );
    }, 60_000);

    it('read as stale once a recorded .gitignore is deleted', async () => {
        const { root, cacheDir } = app({
            '.gitignore': 'out/\n',
            'app/globals.css': PREFIXED,
        });
        await writeNextStylesheetFacts({ root, cacheDir });
        const candidates = [join(root, 'app/globals.css')];
        expect(
            resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [], candidates }),
        ).toMatchObject({ ok: true, prefix: 'tw' });

        rmSync(join(root, '.gitignore'));

        const read = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [], candidates });
        expect(read.ok ? '' : read.reason).toContain('.gitignore changed');
    }, 60_000);

    it('ask for a prebuild when a caller hands candidates and nothing was recorded', () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });

        const read = resolveNextClassPrefix({
            root,
            cacheDir,
            tailwindStylesheet: [],
            candidates: [join(root, 'app/globals.css')],
        });

        expect(read).toEqual({ ok: false, reason: 'no stylesheet facts have been written yet' });
    });
});
