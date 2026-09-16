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
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    NEXT_STYLESHEET_FACTS_FILE,
    readNextStylesheetFacts,
    resolveNextClassPrefix,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
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

        writeFileSync(path, '{"schema": 2}');

        expect(readNextStylesheetFacts(cacheDir).ok).toBe(false);
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
        const before = statSync(path).mtimeMs;
        const content = readFileSync(path, 'utf8');

        await new Promise(resolve => setTimeout(resolve, 20));
        await writeNextStylesheetFacts({ root, cacheDir });

        expect(statSync(path).mtimeMs).toBe(before);
        expect(readFileSync(path, 'utf8')).toBe(content);
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
