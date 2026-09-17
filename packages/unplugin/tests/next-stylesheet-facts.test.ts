/**
 * The Tailwind prefix, recorded ahead of time for the Next Turbopack lane.
 *
 * A Turbopack loader runs synchronously, one module at a time, and reading the
 * prefix means compiling the stylesheet, which is asynchronous. So the prebuild
 * and the watcher read it and write it down, and the loader reads the file.
 * The file records the content of every stylesheet it was read from, so a
 * loader can tell when an edit left it describing stylesheets that no longer
 * exist in that form.
 */
import { rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    failedNextClassPrefixInputsStamp,
    NEXT_STYLESHEET_FACTS_FILE,
    prepareNextStylesheetFacts,
    projectStylesheetCandidates,
    readNextStylesheetFacts,
    resolveNextClassPrefix,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import { readStableTextFileSnapshotSync } from '../src/stable-file-snapshot.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const PREFIXED = '@import "tailwindcss" prefix(tw);\n';

afterEach(removeTailwindProjects);

/**
 * A Next-shaped app with the given stylesheets.
 *
 * @param files - Stylesheets and sources, relative to the root.
 * @returns The root and its csszyx cache directory.
 */
function app(files: Record<string, string>): { root: string; cacheDir: string } {
    const root = tailwindProject('csszyx-next-facts-', files);
    return { root, cacheDir: join(root, '.csszyx/cache') };
}

describe('next stylesheet facts', () => {
    it('stamps only explicitly selected stylesheets when a selection is configured', () => {
        const { root, cacheDir } = app({
            'app/globals.css': PREFIXED,
            'legacy/old.css': '@import "tailwindcss";\n',
        });
        const input = { root, cacheDir, tailwindStylesheet: ['app/globals.css'] };
        const before = failedNextClassPrefixInputsStamp(input);

        writeFileSync(join(root, 'legacy/old.css'), '@import "tailwindcss" prefix(old);\n');
        const afterUnselectedEdit = failedNextClassPrefixInputsStamp(input);
        writeFileSync(join(root, 'app/globals.css'), '@import "tailwindcss" prefix(next);\n');

        expect(afterUnselectedEdit).toBe(before);
        expect(failedNextClassPrefixInputsStamp(input)).not.toBe(before);
    });

    it('records the prefix, and a loader reads it back', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });

        const written = await writeNextStylesheetFacts({ root, cacheDir });
        const read = readNextStylesheetFacts(cacheDir);

        expect(written.path).toBe(join(cacheDir, NEXT_STYLESHEET_FACTS_FILE));
        expect(written.record.facts).toEqual({ prefix: 'tw', important: false });
        expect(written.record.entries.map(entry => entry.file)).toEqual([
            join(root, 'app/globals.css'),
        ]);
        expect(read).toEqual({ ok: true, record: written.record });
    }, 60_000);

    it('reads as stale once a recorded stylesheet changes', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        await writeNextStylesheetFacts({ root, cacheDir });

        writeFileSync(join(root, 'app/globals.css'), '@import "tailwindcss";\n');
        const read = readNextStylesheetFacts(cacheDir);

        expect(read.ok).toBe(false);
        expect(read.ok ? '' : read.reason).toContain('app/globals.css changed');
    }, 60_000);

    it('reads as missing before any prebuild wrote it', () => {
        const { cacheDir } = app({ 'app/globals.css': PREFIXED });

        const read = readNextStylesheetFacts(cacheDir);

        expect(read.ok ? '' : read.reason).toContain('no stylesheet facts');
    });

    it('reads a file that is not a facts record as unusable', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        const { path } = await writeNextStylesheetFacts({ root, cacheDir });

        // An older shape, and the current schema number on a file that holds none of its fields.
        for (const content of ['{"schema": 1, "root": "/x", "entries": []}', '{"schema": 2}']) {
            writeFileSync(path, content);
            expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
        }
    }, 60_000);

    it('stops when the stylesheets disagree on the prefix', async () => {
        const { root, cacheDir } = app({
            'app/globals.css': PREFIXED,
            'legacy/old.css': '@import "tailwindcss";\n',
        });

        await expect(writeNextStylesheetFacts({ root, cacheDir })).rejects.toThrow(
            'set different prefixes',
        );
    }, 60_000);

    it('reads only the stylesheets it is told the app loads', async () => {
        const { root, cacheDir } = app({
            'app/globals.css': PREFIXED,
            'legacy/old.css': '@import "tailwindcss";\n',
        });

        const { record } = await writeNextStylesheetFacts({
            root,
            cacheDir,
            tailwindStylesheet: ['app/globals.css'],
        });

        expect(record.facts?.prefix).toBe('tw');
    }, 60_000);

    it('leaves the file alone when nothing it records changed', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        const { path } = await writeNextStylesheetFacts({ root, cacheDir });
        const before = readStableTextFileSnapshotSync(path);

        await new Promise(resolve => setTimeout(resolve, 20));
        await writeNextStylesheetFacts({ root, cacheDir });

        const after = readStableTextFileSnapshotSync(path);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        expect(after.source).toBe(before.source);
    }, 60_000);

    it('reads a file that is not JSON, or holds no record, as unusable', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        const { path } = await writeNextStylesheetFacts({ root, cacheDir });

        writeFileSync(path, '{ not json');
        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
        writeFileSync(path, 'null');
        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
    }, 60_000);

    it('reads as stale once a recorded stylesheet is deleted', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        await writeNextStylesheetFacts({ root, cacheDir });

        rmSync(join(root, 'app/globals.css'));

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
    }, 60_000);

    it('stops when a listed stylesheet is not there', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });

        await expect(
            writeNextStylesheetFacts({ root, cacheDir, tailwindStylesheet: ['app/gone.css'] }),
        ).rejects.toThrow('app/gone.css');
    });
});

describe('resolveNextClassPrefix without recorded facts', () => {
    it('answers null for listed stylesheets that cannot reach Tailwind, and depends on them', () => {
        const { root, cacheDir } = app({ 'app/plain.css': '.card { color: red; }\n' });

        const answer = resolveNextClassPrefix({
            root,
            cacheDir,
            tailwindStylesheet: ['app/plain.css'],
        });

        expect(answer).toEqual({
            ok: true,
            prefix: null,
            dependencies: [join(cacheDir, NEXT_STYLESHEET_FACTS_FILE), join(root, 'app/plain.css')],
        });
    });

    it('waits for a read when a listed stylesheet cannot be read, rather than guess no prefix', () => {
        const { root, cacheDir } = app({ 'app/plain.css': '.card { color: red; }\n' });

        const answer = resolveNextClassPrefix({
            root,
            cacheDir,
            tailwindStylesheet: ['app/gone.css'],
        });

        expect(answer.ok).toBe(false);
    });
});

describe('prepareNextStylesheetFacts', () => {
    it('reads a stylesheet that the source files it is given import', async () => {
        const layout = "import '@fixture/ui/globals.css';\nexport default () => null;\n";
        const { root } = app({
            'package.json': '{ "name": "app" }\n',
            'app/layout.tsx': layout,
            'node_modules/@fixture/ui/package.json': JSON.stringify({
                name: '@fixture/ui',
                exports: { './globals.css': './globals.css' },
            }),
            'node_modules/@fixture/ui/globals.css': PREFIXED,
        });

        const { record } = await prepareNextStylesheetFacts({
            explicitRoot: root,
            files: [join(root, 'app/layout.tsx')],
        });

        expect(record.facts?.prefix).toBe('tw');
    }, 60_000);

    it('writes where the prebuild and the loader look for it', async () => {
        const { root } = app({
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': PREFIXED,
        });

        const { path, record } = await prepareNextStylesheetFacts({
            explicitRoot: root,
            cwd: root,
            cacheDir: 'build/csszyx-cache',
        });

        expect(path).toBe(join(root, 'build/csszyx-cache', NEXT_STYLESHEET_FACTS_FILE));
        expect(record.facts?.prefix).toBe('tw');
        expect(readNextStylesheetFacts(join(root, 'build/csszyx-cache')).ok).toBe(true);
    }, 60_000);
});

describe('the facts describe one project and every stylesheet they were read from', () => {
    it('read as stale for a project other than the one they were written for', async () => {
        const a = app({ 'app/globals.css': PREFIXED });
        const b = app({ 'app/globals.css': '@import "tailwindcss";\n' });
        await writeNextStylesheetFacts({ root: a.root, cacheDir: a.cacheDir });

        const read = resolveNextClassPrefix({
            root: b.root,
            cacheDir: a.cacheDir,
            tailwindStylesheet: [],
        });

        expect(read.ok ? '' : read.reason).toContain('written for');
    }, 60_000);

    it('read as stale once a stylesheet appears that they were not written with', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': '@import "tailwindcss";\n' });
        await writeNextStylesheetFacts({ root, cacheDir });

        writeFileSync(join(root, 'app/tw.css'), PREFIXED);
        const read = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] });

        expect(read.ok ? '' : read.reason).toContain('app/tw.css');
    }, 60_000);

    it('keep a stylesheet they were written with that a later writer cannot find', async () => {
        // A bundler build reaches a package stylesheet through a JavaScript
        // import; a writer that only walks the project cannot, and must not
        // drop it and record no prefix.
        const { root, cacheDir } = app({
            'app/globals.css': '.card { color: red; }\n',
            'node_modules/@fixture/ui/globals.css': PREFIXED,
        });
        const packaged = join(root, 'node_modules/@fixture/ui/globals.css');
        await writeNextStylesheetFacts({ root, cacheDir, extraCandidates: [packaged] });

        writeFileSync(packaged, `${PREFIXED}/* edited */\n`);
        const { record } = await writeNextStylesheetFacts({ root, cacheDir });

        expect(record.facts?.prefix).toBe('tw');
        expect(record.candidates).toContain(packaged);
    }, 60_000);

    it('depend on the stylesheets that reach Tailwind, not on every CSS module', async () => {
        const { root, cacheDir } = app({
            'app/globals.css': PREFIXED,
            'app/Button.module.css': '.button { color: red; }\n',
        });
        await writeNextStylesheetFacts({ root, cacheDir });

        const read = resolveNextClassPrefix({ root, cacheDir, tailwindStylesheet: [] });
        const dependencies = read.ok ? read.dependencies : [];

        expect(dependencies).toContain(join(root, 'app/globals.css'));
        expect(dependencies).not.toContain(join(root, 'app/Button.module.css'));
    }, 60_000);

    it('read as stale after an edit that keeps the file the same size', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        await writeNextStylesheetFacts({ root, cacheDir });
        expect(readNextStylesheetFacts(cacheDir).ok).toBe(true);

        writeFileSync(join(root, 'app/globals.css'), PREFIXED.replace('tw', 'ab'));

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
    }, 60_000);
});

describe('what the facts cover beyond the stylesheets handed over', () => {
    it('read as stale after an edit to a package stylesheet a root imports', async () => {
        const { root, cacheDir } = app({
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "@fixture/ui/theme.css";\n',
            'node_modules/@fixture/ui/package.json': JSON.stringify({
                name: '@fixture/ui',
                exports: { './theme.css': './theme.css' },
            }),
            'node_modules/@fixture/ui/theme.css': PREFIXED,
        });
        const { record } = await writeNextStylesheetFacts({ root, cacheDir });
        expect(record.facts?.prefix).toBe('tw');

        writeFileSync(join(root, 'node_modules/@fixture/ui/theme.css'), '@import "tailwindcss";\n');

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
    }, 60_000);

    it('do not keep what a record for another project looked at', async () => {
        const a = app({
            'app/globals.css': '.card { color: red; }\n',
            'vendor/tw.css': PREFIXED,
        });
        const b = app({ 'app/globals.css': '.card { color: red; }\n' });
        await writeNextStylesheetFacts({
            root: a.root,
            cacheDir: b.cacheDir,
            extraCandidates: [join(a.root, 'vendor/tw.css')],
        });

        const { record } = await writeNextStylesheetFacts({ root: b.root, cacheDir: b.cacheDir });

        expect(record.facts).toBeNull();
        expect(record.candidates).toEqual([join(b.root, 'app/globals.css')]);
    }, 60_000);

    it('skip a source file that cannot be read when looking for imported stylesheets', async () => {
        const { root } = app({
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': PREFIXED,
        });

        const { record } = await prepareNextStylesheetFacts({
            explicitRoot: root,
            files: [join(root, 'app/gone.tsx')],
        });

        expect(record.facts?.prefix).toBe('tw');
    }, 60_000);

    it('trust a settled stylesheet whose size and time have not moved', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        const file = join(root, 'app/globals.css');
        const settled = new Date(Date.now() - 60 * 60 * 1000);
        utimesSync(file, settled, settled);
        await writeNextStylesheetFacts({ root, cacheDir });
        expect(readNextStylesheetFacts(cacheDir).ok).toBe(true);

        // Same size, and the time put back: the hash is not computed again.
        // An editor never does this; a filesystem that stamps coarsely can,
        // which is why a recently stamped file is always hashed afresh.
        writeFileSync(file, PREFIXED.replace('tw', 'ab'));
        utimesSync(file, settled, settled);

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(true);
    }, 60_000);
});

describe('projectStylesheetCandidates', () => {
    it('walks again only once the facts file changes', async () => {
        const { root, cacheDir } = app({ 'app/globals.css': PREFIXED });
        expect(projectStylesheetCandidates(root, cacheDir)).toEqual([
            join(root, 'app/globals.css'),
        ]);

        writeFileSync(join(root, 'app/extra.css'), '.card { color: red; }\n');
        expect(projectStylesheetCandidates(root, cacheDir)).toEqual([
            join(root, 'app/globals.css'),
        ]);

        await writeNextStylesheetFacts({ root, cacheDir });
        expect(projectStylesheetCandidates(root, cacheDir)).toContain(join(root, 'app/extra.css'));
    }, 60_000);
});

describe('prepareNextStylesheetFacts messages', () => {
    it('name the setting the caller was configured with', async () => {
        const { root } = app({
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': PREFIXED,
        });

        await expect(
            prepareNextStylesheetFacts({
                explicitRoot: root,
                tailwindStylesheet: ['app/gone.css'],
                setting: 'the `--tailwind-stylesheet` flag',
            }),
        ).rejects.toThrow('the `--tailwind-stylesheet` flag lists stylesheets that are not there');
    }, 60_000);
});
