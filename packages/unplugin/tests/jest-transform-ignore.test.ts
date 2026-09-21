/**
 * The jest transformer's `ignore` option.
 *
 * On Next.js the transformer follows the patterns `csszyx next prebuild --ignore`
 * recorded. A suite that runs before any command, as on a fresh CI checkout,
 * has no record to follow, so another app's Tailwind entry under the same root
 * would stop it over a prefix the build itself accepts. The option carries the
 * same patterns for that case.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { readNextStylesheetFacts, writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

// Wrapped, not replaced: the child that reads the stylesheets is real, and a
// test can count how many were started.
vi.mock('node:child_process', async importOriginal => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const SOURCE = 'export const A = () => <div sz={{ p: 4 }} />;';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

/**
 * An app beside a directory that holds another app's Tailwind entry.
 *
 * @returns The root, the component path and the cache directories.
 */
function appBesideAnother(): { root: string; file: string; cacheRoot: string; cacheDir: string } {
    const root = tailwindProject('csszyx-jest-ignore-', {
        'src/index.css': '@import "tailwindcss" prefix(tw);\n',
        'src/A.tsx': SOURCE,
        'legacy/old.css': '@import "tailwindcss" prefix(old);\n',
    });
    return {
        root,
        file: join(root, 'src/A.tsx'),
        cacheRoot: join(root, '.csszyx/cache/transform'),
        cacheDir: join(root, '.csszyx/cache'),
    };
}

describe('the jest transformer with `ignore`', () => {
    it('lowers with the prefix of the entries left when nothing was recorded', () => {
        const { root, file, cacheRoot, cacheDir } = appBesideAnother();

        const transformer = createTransformer({ root, cacheRoot, ignore: 'legacy/**' });

        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');
        const read = readNextStylesheetFacts(join(cacheDir, 'jest'));
        expect(read.ok ? read.record.ignore : null).toEqual(['legacy/**']);
    }, 60_000);

    it('reads the record it wrote without starting another child', () => {
        const { root, file, cacheRoot } = appBesideAnother();
        const transformer = createTransformer({ root, cacheRoot, ignore: ['legacy/**'] });
        transformer.process(SOURCE, file);
        vi.mocked(spawnSync).mockClear();

        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');
        expect(spawnSync).not.toHaveBeenCalled();
    }, 60_000);

    it('leaves the facts the Next command recorded exactly as they were', async () => {
        // The Turbopack loader follows whatever patterns that file holds. A
        // suite configured with other patterns must not be able to change what
        // `next dev` votes on, so it keeps facts of its own.
        const { root, file, cacheRoot, cacheDir } = appBesideAnother();
        writeFileSync(join(root, 'legacy/old.css'), '@import "tailwindcss" prefix(tw);\n');
        const { path: shared } = await writeNextStylesheetFacts({ root, cacheDir, ignore: [] });
        const before = readFileSync(shared, 'utf8');

        createTransformer({ root, cacheRoot, ignore: ['legacy/**'] }).process(SOURCE, file);

        expect(readFileSync(shared, 'utf8')).toBe(before);
        expect(readNextStylesheetFacts(join(cacheDir, 'jest')).ok).toBe(true);
    }, 60_000);

    it('settles a pattern it cannot honour once, not once per file', () => {
        const { root, file, cacheRoot } = appBesideAnother();
        const transformer = createTransformer({ root, cacheRoot, ignore: ['!legacy/keep.css'] });
        const failures: unknown[] = [];

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                transformer.process(SOURCE, file);
            } catch (error) {
                failures.push(error);
            }
        }

        expect(String(failures[0])).toContain('is negated');
        expect(failures[1]).toBe(failures[0]);
    }, 60_000);

    it('takes its own patterns over the ones a command recorded', async () => {
        // The option is what this suite was configured with. Following a record
        // written under other patterns would make the answer depend on which
        // command ran last.
        const { root, file, cacheRoot, cacheDir } = appBesideAnother();
        await writeNextStylesheetFacts({ root, cacheDir, ignore: ['legacy/**'] });

        const transformer = createTransformer({ root, cacheRoot, ignore: [] });

        expect(() => transformer.process(SOURCE, file)).toThrow('set different prefixes');
    }, 60_000);

    it('names its option where the entries disagree', () => {
        const { root, file, cacheRoot } = appBesideAnother();

        expect(() => createTransformer({ root, cacheRoot }).process(SOURCE, file)).toThrow(
            "or leave another app's directory out with the csszyx `ignore` option.",
        );
    }, 60_000);

    it('does not retry a failure over an edit under an ignored path', () => {
        const { root, file, cacheRoot } = tailwindProjectWithBrokenEntry();
        const transformer = createTransformer({ root, cacheRoot, ignore: 'legacy/**' });
        expect(() => transformer.process(SOURCE, file)).toThrow();
        vi.mocked(spawnSync).mockClear();
        writeFileSync(join(root, 'legacy/old.css'), '@import "tailwindcss" prefix(older);\n');

        expect(() => transformer.process(SOURCE, file)).toThrow();
        expect(spawnSync).not.toHaveBeenCalled();
    }, 60_000);
});

/**
 * An app whose own entries disagree, beside an ignored directory.
 *
 * @returns The root, the component path and the transform cache directory.
 */
function tailwindProjectWithBrokenEntry(): { root: string; file: string; cacheRoot: string } {
    const root = tailwindProject('csszyx-jest-ignore-broken-', {
        'src/index.css': '@import "tailwindcss" prefix(tw);\n',
        'src/other.css': '@import "tailwindcss";\n',
        'src/A.tsx': SOURCE,
        'legacy/old.css': '@import "tailwindcss" prefix(old);\n',
    });
    return {
        root,
        file: join(root, 'src/A.tsx'),
        cacheRoot: join(root, '.csszyx/cache/transform'),
    };
}
