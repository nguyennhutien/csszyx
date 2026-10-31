/**
 * The jest transformer reads the project's prefix once per test file.
 *
 * jest builds one `cacheFS` map per test file and hands it to every
 * `getCacheKey` and `process` call made for that file, so the map is the
 * identity of that test file's run. Reading the prefix walks the project's
 * stylesheets, and doing it for every module of every test file made that walk
 * most of the lane's time. One answer per run still sees an edit at the next
 * test file, which is what watch mode needs.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { resolveNextClassPrefix, writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

// Wrapped, not replaced: the walk is real, and a test can count it.
vi.mock('../src/next-stylesheet-facts.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../src/next-stylesheet-facts.js')>();
    return { ...actual, resolveNextClassPrefix: vi.fn(actual.resolveNextClassPrefix) };
});

const SOURCE = 'export const A = () => <div sz={{ p: 4 }} />;';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/**
 * A prefixed project with recorded stylesheet facts and three components.
 *
 * @returns The root, the component paths and the transform cache directory.
 */
async function project(): Promise<{ root: string; files: string[]; cacheRoot: string }> {
    const root = tailwindProject('csszyx-jest-run-', {
        'package.json': '{ "name": "app" }\n',
        'src/index.css': '@import "tailwindcss" prefix(tw);\n',
        'src/A.tsx': SOURCE,
        'src/B.tsx': SOURCE,
        'src/C.tsx': SOURCE,
    });
    await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
    return {
        root,
        files: ['A', 'B', 'C'].map(name => join(root, `src/${name}.tsx`)),
        cacheRoot: join(root, '.csszyx/cache/transform'),
    };
}

describe('the jest transformer, run by run', () => {
    it('reads the prefix once for every module of one test file', async () => {
        const { root, files, cacheRoot } = await project();
        const transformer = createTransformer({ root, cacheRoot });
        const cacheFS = new Map<string, string>();

        for (const file of files) {
            transformer.getCacheKey(SOURCE, file, { cacheFS });
            expect(transformer.process(SOURCE, file, { cacheFS }).code).toContain('tw:p-4');
        }

        expect(resolveNextClassPrefix).toHaveBeenCalledTimes(1);
    }, 60_000);

    it('reads it again for the next test file', async () => {
        const { root, files, cacheRoot } = await project();
        const transformer = createTransformer({ root, cacheRoot });

        for (const file of files) transformer.process(SOURCE, file, { cacheFS: new Map() });

        expect(resolveNextClassPrefix).toHaveBeenCalledTimes(files.length);
    }, 60_000);

    it('reads it on every call when jest names no run', async () => {
        const { root, files, cacheRoot } = await project();
        const transformer = createTransformer({ root, cacheRoot });

        for (const file of files) transformer.process(SOURCE, file);

        expect(resolveNextClassPrefix).toHaveBeenCalledTimes(files.length);
    }, 60_000);

    it('takes no options from a key asked for another file', async () => {
        const { root, files } = await project();
        // The current directory, which `process` without options falls back to:
        // a project whose stylesheet sets no prefix.
        const plain = tailwindProject('csszyx-jest-run-plain-', {
            'package.json': '{ "name": "plain" }\n',
            'src/index.css': '@import "tailwindcss";\n',
        });
        await writeNextStylesheetFacts({ root: plain, cacheDir: join(plain, '.csszyx/cache') });
        vi.spyOn(process, 'cwd').mockReturnValue(plain);
        const transformer = createTransformer();
        const [first, second] = files as [string, string];
        const cacheFS = new Map<string, string>();

        transformer.getCacheKey(SOURCE, first, { config: { rootDir: root }, cacheFS });

        expect(transformer.process(SOURCE, second).code).toContain('className="p-4"');
    }, 60_000);

    // The wrapper the testing guide shows hands `process` no options, so the
    // root jest named for the key is the one the code must be lowered under.
    it('lowers a module a wrapper processes under the root its key named', async () => {
        const { files } = await project();
        const transformer = createTransformer();
        const [file] = files as [string];
        const root = join(file, '../..');
        const cacheFS = new Map<string, string>();

        transformer.getCacheKey(SOURCE, file, { config: { rootDir: root }, cacheFS });

        expect(transformer.process(SOURCE, file).code).toContain('className="tw:p-4"');
        expect(resolveNextClassPrefix).toHaveBeenCalledTimes(1);
    }, 60_000);
});
