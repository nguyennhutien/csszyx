/**
 * The object rule on the Turbopack lane.
 *
 * A Turbopack loader lowers one module at a time and cannot compile the
 * project's CSS, so it cannot tell which class covers which. `csszyx next
 * prebuild` and `csszyx next watch` can: they write the table beside the merge
 * registration, and the loader hands the engine the rows for its module's
 * classes. The shard keeps the classes before the merge, since the next table
 * is built from them.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    MERGE_TABLE_FILE,
    mergeTableFor,
    writeMergeRegistration,
} from '../src/merge-registration.js';
import { resolveNextSafelistStatePaths } from '../src/next-safelist-state.js';
import {
    prepareNextStylesheetFacts,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

const SOURCE = 'export const App = () => <div sz={{ pb: 2, p: 4 }} />;\n';
const OPTIONS = {
    config: { mangleVars: false },
    writeOptions: { retryDelayMs: 0 },
    materializeSafelist: false,
};

/**
 * A Next app whose stylesheet facts are written, as `next prebuild` leaves it.
 *
 * @returns The root, the page, and where the table lives.
 */
async function app(): Promise<{ root: string; page: string; table: string }> {
    const root = tailwindProject('csszyx-next-object-rule-', {
        'package.json': '{ "name": "app" }\n',
        'app/globals.css': '@import "tailwindcss";',
        'app/page.tsx': SOURCE,
    });
    await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
    return {
        root,
        page: join(root, 'app/page.tsx'),
        table: join(root, '.csszyx', MERGE_TABLE_FILE),
    };
}

/**
 * Write the table a Next command settles for the page's classes.
 *
 * @param root - App root.
 */
async function settle(root: string): Promise<void> {
    const facts = await prepareNextStylesheetFacts({ explicitRoot: root, cwd: root });
    writeMergeRegistration({
        root,
        model: facts.model,
        classes: ['pb-2', 'p-4'],
        authoredClasses: [],
        mergeLiterals: [],
    });
}

/**
 * A loader context that records its dependencies.
 *
 * @param root - App root.
 * @param page - The module being loaded.
 * @returns The context, with the dependencies it was given.
 */
function loaderContext(
    root: string,
    page: string,
): NextTurboLoaderContext & { dependencies: string[] } {
    const dependencies: string[] = [];
    return {
        resourcePath: page,
        rootContext: root,
        context: join(root, 'app'),
        mode: 'development',
        addDependency: (file: string) => dependencies.push(file),
        dependencies,
    };
}

describe.each(['rust', 'wasm'] as const)('the object rule under Turbopack (%s)', parserMode => {
    const options = { ...OPTIONS, parserMode };

    it('merges from the table a Next command wrote, and depends on it', async () => {
        const { root, page, table } = await app();
        await settle(root);
        const context = loaderContext(root, page);

        const output = runNextTurboLoader(SOURCE, context, options);

        expect(output.transform.producer).toBe(parserMode);
        expect(output.code).toContain('className="p-4"');
        expect(context.dependencies).toContain(table);
    }, 60_000);

    it('keeps the classes before the merge in the shard the next table is built from', async () => {
        const { root, page } = await app();
        await settle(root);

        runNextTurboLoader(SOURCE, loaderContext(root, page), options);

        const { shardsDir } = resolveNextSafelistStatePaths(root);
        const shards = readdirSync(shardsDir).map(name =>
            readFileSync(join(shardsDir, name), 'utf8'),
        );
        expect(shards.join('\n')).toContain('"pb-2"');
    }, 60_000);

    it('keeps both classes before a Next command has written a table, and waits for one', async () => {
        const { root, page, table } = await app();
        const context = loaderContext(root, page);

        const output = runNextTurboLoader(SOURCE, context, options);

        expect(output.code).toContain('className="pb-2 p-4"');
        expect(context.dependencies).toContain(table);
        expect(JSON.parse(readFileSync(table, 'utf8'))).toMatchObject({
            signatures: {},
            coverage: [],
        });
    }, 60_000);

    it('never replaces a table a Next command has written', async () => {
        const { root, page, table } = await app();
        writeFileSync(table, '{"written":"by csszyx next prebuild"}\n');

        runNextTurboLoader(SOURCE, loaderContext(root, page), options);

        expect(readFileSync(table, 'utf8')).toBe('{"written":"by csszyx next prebuild"}\n');
    }, 60_000);
});

describe('the rows one module reads from the table', () => {
    const TABLE = {
        format: 1,
        signatures: { 'p-4': 0, 'p-8': 0, 'pb-2': 1, 'm-2': 2 },
        coverage: [[1], [], []],
    };

    /**
     * A project holding one table file.
     *
     * @param text - What the file holds.
     * @returns The project root.
     */
    function withTable(text: string): string {
        const root = tailwindProject('csszyx-object-rule-rows-', { 'package.json': '{}\n' });
        mkdirSync(join(root, '.csszyx'), { recursive: true });
        writeFileSync(join(root, '.csszyx', MERGE_TABLE_FILE), text);
        return root;
    }

    it('keeps only the signatures of the classes given, and every row', () => {
        const root = withTable(JSON.stringify(TABLE));
        expect(mergeTableFor(root, new Set(['pb-2', 'p-4', 'flex']))).toEqual({
            format: 1,
            signatures: { 'pb-2': 1, 'p-4': 0 },
            coverage: TABLE.coverage,
        });
    });

    it('answers for two classes of one signature', () => {
        const root = withTable(JSON.stringify(TABLE));
        expect(mergeTableFor(root, new Set(['p-4', 'p-8']))).not.toBeNull();
    });

    it.each([
        ['no two of them cover each other', ['p-4', 'm-2']],
        ['a class covers only a class the module does not hold', ['p-4']],
        ['a class name is an inherited property', ['constructor', 'p-4']],
    ])('is null when %s', (_, classes) => {
        const root = withTable(JSON.stringify(TABLE));
        expect(mergeTableFor(root, new Set(classes))).toBeNull();
    });

    it.each([
        ['no file', null],
        ['a file that is not JSON', '{'],
        ['JSON that is not a table', '[]'],
    ])('is null for %s', (_, text) => {
        const root =
            text === null
                ? tailwindProject('csszyx-object-rule-rows-', { 'package.json': '{}\n' })
                : withTable(text);
        expect(mergeTableFor(root, new Set(['pb-2', 'p-4']))).toBeNull();
    });
});
