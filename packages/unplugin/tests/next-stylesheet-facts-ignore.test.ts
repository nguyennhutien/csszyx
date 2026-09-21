/**
 * `csszyx next watch --ignore` and `next prebuild --ignore` reach the stylesheets.
 *
 * Every Tailwind entry votes on the prefix and on the merge signatures, and a
 * disagreement stops the build. A directory the command was told to ignore may
 * hold another app's entry, so its stylesheets must not vote. The loader walks
 * the project itself, so the patterns travel in the facts record: taught to the
 * writer alone, the loader would find the ignored stylesheet, see that the
 * record was not written with it, and refuse the record.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    failedNextClassPrefixInputsStamp,
    projectStylesheetCandidates,
    readNextStylesheetFacts,
    resolveNextClassPrefix,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const PREFIXED = '@import "tailwindcss" prefix(tw);\n';
const OTHER_APP = '@import "tailwindcss" prefix(old);\n';

afterEach(removeTailwindProjects);

/**
 * A Next-shaped app beside a directory that holds another app's entry.
 *
 * @returns The root and its csszyx cache directory.
 */
function appBesideAnother(): { root: string; cacheDir: string } {
    const root = tailwindProject('csszyx-next-facts-ignore-', {
        'app/globals.css': PREFIXED,
        'legacy/old.css': OTHER_APP,
    });
    return { root, cacheDir: join(root, '.csszyx/cache') };
}

describe('the writer leaves ignored stylesheets out', () => {
    it('stops over the other entry when nothing is ignored', async () => {
        const { root, cacheDir } = appBesideAnother();

        await expect(writeNextStylesheetFacts({ root, cacheDir })).rejects.toThrow(/prefix/);
    }, 60_000);

    it('records the prefix of the entries that are left, and the patterns', async () => {
        const { root, cacheDir } = appBesideAnother();

        const { record } = await writeNextStylesheetFacts({
            root,
            cacheDir,
            ignore: ['legacy/**'],
        });

        expect(record.facts?.prefix).toBe('tw');
        expect(record.ignore).toEqual(['legacy/**']);
        expect(record.candidates).toEqual([join(root, 'app/globals.css')]);
    }, 60_000);

    it('drops a stylesheet an earlier record kept once a pattern covers it', async () => {
        const { root, cacheDir } = appBesideAnother();
        writeFileSync(join(root, 'legacy/old.css'), PREFIXED);
        await writeNextStylesheetFacts({ root, cacheDir });

        const { record } = await writeNextStylesheetFacts({
            root,
            cacheDir,
            ignore: ['legacy/**'],
        });

        expect(record.candidates).toEqual([join(root, 'app/globals.css')]);
    }, 60_000);

    it('keeps an ignored stylesheet that a source file imports', async () => {
        // An import from a file the command does read is evidence the app
        // loads the stylesheet, wherever it lives.
        const { root, cacheDir } = appBesideAnother();
        const imported = join(root, 'legacy/old.css');
        writeFileSync(imported, PREFIXED);

        const { record } = await writeNextStylesheetFacts({
            root,
            cacheDir,
            ignore: ['legacy/**'],
            extraCandidates: [imported],
        });

        expect(record.candidates).toContain(imported);
    }, 60_000);

    it('keeps the recorded patterns when a writer is given none', async () => {
        // The jest lane writes the same file and has no `--ignore` of its own.
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        const { record } = await writeNextStylesheetFacts({ root, cacheDir });

        expect(record.ignore).toEqual(['legacy/**']);
        expect(record.facts?.prefix).toBe('tw');
    }, 60_000);

    it('forgets the recorded patterns when a writer is given an empty list', async () => {
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        await expect(writeNextStylesheetFacts({ root, cacheDir, ignore: [] })).rejects.toThrow(
            /prefix/,
        );
    }, 60_000);

    it('does not take patterns from a record written for another project', async () => {
        const a = appBesideAnother();
        const b = appBesideAnother();
        await writeNextStylesheetFacts({
            root: a.root,
            cacheDir: a.cacheDir,
            ignore: ['legacy/**'],
        });

        await expect(
            writeNextStylesheetFacts({ root: b.root, cacheDir: a.cacheDir }),
        ).rejects.toThrow(/prefix/);
    }, 60_000);
});

describe('the disagreement message on a lane that can ignore', () => {
    it('names the ignore setting beside the stylesheet list', async () => {
        const { root, cacheDir } = appBesideAnother();

        await expect(
            writeNextStylesheetFacts({
                root,
                cacheDir,
                setting: 'the `--tailwind-stylesheet` flag',
                ignoreSetting: 'the `--ignore` flag',
            }),
        ).rejects.toThrow(
            "list the stylesheets this build loads in the `--tailwind-stylesheet` flag, or leave another app's directory out with the `--ignore` flag.",
        );
    }, 60_000);

    it('says nothing about ignoring on a lane that cannot', async () => {
        const { root, cacheDir } = appBesideAnother();

        await expect(writeNextStylesheetFacts({ root, cacheDir })).rejects.toThrow(
            /or list the stylesheets this build loads in [^\n]*\.\n {2}note:/,
        );
    }, 60_000);
});

describe('the loader walks with the recorded patterns', () => {
    it('reads the record although it finds the ignored stylesheet on disk', async () => {
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        const walked = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] });
        const handed = resolveNextClassPrefix({
            root,
            cacheDir,
            tailwindStylesheet: [],
            candidates: projectStylesheetCandidates(root, cacheDir),
        });

        expect(walked).toMatchObject({ ok: true, prefix: 'tw' });
        expect(handed).toMatchObject({ ok: true, prefix: 'tw' });
        expect(projectStylesheetCandidates(root, cacheDir)).toEqual([
            join(root, 'app/globals.css'),
        ]);
    }, 60_000);

    it('reads the record after a stylesheet appears under an ignored path', async () => {
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        mkdirSync(join(root, 'legacy/nested'), { recursive: true });
        writeFileSync(join(root, 'legacy/nested/new.css'), OTHER_APP);

        expect(resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] })).toMatchObject({
            ok: true,
            prefix: 'tw',
        });
    }, 60_000);

    it('still reads as stale once a stylesheet appears anywhere else', async () => {
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        writeFileSync(join(root, 'app/extra.css'), PREFIXED);
        const read = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] });

        expect(read.ok ? '' : read.reason).toContain('app/extra.css');
    }, 60_000);

    it('does not retry a failed resolution over an edit under an ignored path', async () => {
        const { root, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });
        const input = { root, cacheDir, tailwindStylesheet: [] };
        const before = failedNextClassPrefixInputsStamp(input);

        writeFileSync(join(root, 'legacy/old.css'), '@import "tailwindcss" prefix(older);\n');
        const afterIgnoredEdit = failedNextClassPrefixInputsStamp(input);
        writeFileSync(join(root, 'app/globals.css'), `${PREFIXED}/* edited */\n`);

        expect(afterIgnoredEdit).toBe(before);
        expect(failedNextClassPrefixInputsStamp(input)).not.toBe(before);
    }, 60_000);

    it('walks everything when the record on disk is for another project', async () => {
        const a = appBesideAnother();
        const b = appBesideAnother();
        await writeNextStylesheetFacts({
            root: a.root,
            cacheDir: a.cacheDir,
            ignore: ['legacy/**'],
        });

        expect(projectStylesheetCandidates(b.root, a.cacheDir)).toContain(
            join(b.root, 'legacy/old.css'),
        );
    }, 60_000);
});

describe('a record from before the patterns were recorded', () => {
    it('reads as unusable, so the loader asks for a new one', async () => {
        const { root, cacheDir } = appBesideAnother();
        const { path: file, record } = await writeNextStylesheetFacts({
            root,
            cacheDir,
            ignore: ['legacy/**'],
        });
        const { ignore: _ignore, ...older } = record;
        writeFileSync(file, JSON.stringify({ ...older, schema: 2 }));

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
    }, 60_000);
});
