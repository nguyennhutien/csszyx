/**
 * A test run merges what the build merges.
 *
 * jest compiles each file on its own and cannot read the project's CSS, so it
 * reads the table the build or `csszyx next prebuild` settled in
 * `.csszyx/merge-table.json`. A suite that snapshots a class list then sees
 * the classes production ships, not the ones before the merge.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { MERGE_TABLE_FILE, writeMergeRegistration } from '../src/merge-registration.js';
import { prepareNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(() => {
    removeTailwindProjects();
    vi.restoreAllMocks();
});

const SOURCE = [
    'export const Covered = () => <div className="card pb-2" sz={{ p: 4 }} />;',
    'export const Keys = () => <b sz={{ pb: 2, p: 4 }} />;',
    '',
].join('\n');

/**
 * The class lists the emitted code carries, in order.
 *
 * @param code - Emitted module code.
 * @returns Each `className` string literal.
 */
function classNames(code: string): string[] {
    return [...code.matchAll(/className[=:]\s*"([^"]*)"/g)].map(match => match[1] as string);
}

/**
 * A project whose build settled its merge table.
 *
 * @param settled - Whether a table has been written.
 * @returns The root and the component's path.
 */
async function project(settled = true): Promise<{ root: string; file: string }> {
    const root = tailwindProject('csszyx-jest-merge-', {
        'package.json': '{ "name": "app" }\n',
        'app/globals.css': '@import "tailwindcss";',
        'app/page.tsx': SOURCE,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const facts = await prepareNextStylesheetFacts({ explicitRoot: root });
    if (settled) {
        writeMergeRegistration({
            root,
            model: facts.model,
            classes: ['pb-2', 'p-4'],
            authoredClasses: ['card', 'pb-2'],
            mergeLiterals: [],
        });
    }
    return { root, file: join(root, 'app/page.tsx') };
}

describe('a jest run with a settled merge table', () => {
    it('merges a static object and a static class name as the build does', async () => {
        const { root, file } = await project();
        const transformer = createTransformer({ root });
        const { code } = transformer.process(SOURCE, file, { config: { rootDir: root } });
        expect(classNames(code)).toEqual(['card p-4', 'p-4']);
    }, 60_000);

    it('keeps every class when told not to merge', async () => {
        const { root, file } = await project();
        const transformer = createTransformer({ root, mergeCoveredClasses: false });
        const { code } = transformer.process(SOURCE, file, { config: { rootDir: root } });
        expect(classNames(code)).toEqual(['card pb-2 p-4', 'pb-2 p-4']);
    }, 60_000);

    it('keeps every class before any table is written', async () => {
        const { root, file } = await project(false);
        const transformer = createTransformer({ root });
        const options = { config: { rootDir: root } };
        const { code } = transformer.process(SOURCE, file, options);
        expect(classNames(code)).toEqual(['card pb-2 p-4', 'pb-2 p-4']);
        // A first run before any build still keys its cache.
        expect(transformer.getCacheKey(SOURCE, file, options)).toMatch(/\S/);
    }, 60_000);

    // The build's cached answer is the pass before the merge; the table the
    // same build settled is applied to it.
    it('merges the answer a build cached', async () => {
        const { root, file } = await project();
        const call = callHooks(
            vitePlugin({ production: { mangle: false } }) as unknown as Record<string, unknown>[],
        );
        await call('configResolved', { root, command: 'build' });
        await call('transform', SOURCE, file);
        const transformer = createTransformer({ root });
        const { code } = transformer.process(SOURCE, file, { config: { rootDir: root } });
        expect(classNames(code)).toEqual(['card p-4', 'p-4']);
    }, 60_000);

    // jest caches a file's output by key, so a new table must change the key.
    it('keys its cache on the table', async () => {
        const { root, file } = await project();
        const transformer = createTransformer({ root });
        const options = { config: { rootDir: root } };
        const before = transformer.getCacheKey(SOURCE, file, options);
        writeFileSync(
            join(root, '.csszyx', MERGE_TABLE_FILE),
            '{"format":1,"signatures":{},"coverage":[]}',
        );
        expect(transformer.getCacheKey(SOURCE, file, options)).not.toBe(before);
    }, 60_000);
});
