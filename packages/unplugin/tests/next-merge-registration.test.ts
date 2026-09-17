import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transformSource } from '@csszyx/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureUnservedRuntimeFile } from '../src/mangle-runtime-file.js';
import { MERGE_REGISTRATION_FILE, writeMergeRegistration } from '../src/merge-registration.js';
import {
    materializeNextSafelist,
    resolveNextSafelistStatePaths,
    writeNextSafelistShard,
} from '../src/next-safelist-state.js';
import {
    prepareNextStylesheetFacts,
    writeNextStylesheetFacts,
} from '../src/next-stylesheet-facts.js';
import {
    collectNextTransformMetadata,
    createNextSafelistShardFromMetadata,
} from '../src/next-transform-metadata.js';
import { type NextTurboLoaderContext, runNextTurboLoader } from '../src/next-turbo-loader.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

afterEach(removeTailwindProjects);

/**
 * Run a registration module the way a bundle would, capturing what it registers.
 *
 * @param file - Path of the module.
 * @returns The two registrations.
 */
function registrations(file: string): { unserved: unknown; table: unknown } {
    let unserved: unknown;
    let table: unknown;
    runInNewContext(readFileSync(file, 'utf8').replace(/^import .*;$/m, ''), {
        JSON,
        registerUnservedClasses(value: unknown) {
            unserved = value;
        },
        registerMergeSignatures(value: unknown) {
            table = value;
        },
    });
    return { unserved, table };
}

const SOURCE = [
    "'use client';",
    "import { szcn } from '@csszyx/runtime';",
    'export const App = () => (',
    "    <div className={szcn('card p-2', 'p-4')} sz={{ m: 4 }} />",
    ');',
].join('\n');

describe('the census a Next source contributes', () => {
    it('keeps nested merge literals when writing a source shard', () => {
        const nested = `${'_szcn('.repeat(64)}'p-2'${')'.repeat(64)}`;
        const source = `import { szcn, _szcn } from '@csszyx/runtime';
export const value = szcn('p-4', ${nested});`;
        const result = transformSource(source, '/repo/src/value.ts');
        const metadata = collectNextTransformMetadata(result, source, '/repo/src/value.ts');
        expect(metadata.mergeLiterals).toEqual(['p-2', 'p-4']);
        expect(createNextSafelistShardFromMetadata(metadata).mergeLiterals).toEqual(['p-2', 'p-4']);
    });

    it('records the strings written inside szcn calls beside the classes', () => {
        const result = transformSource(SOURCE, '/repo/src/App.tsx');
        const metadata = collectNextTransformMetadata(result, SOURCE, '/repo/src/App.tsx');
        expect(metadata.mergeLiterals).toEqual(['card', 'p-2', 'p-4']);

        const shard = createNextSafelistShardFromMetadata(metadata, 'key');
        expect(shard.authoredClasses).toEqual(metadata.rawClassNames);
        expect(shard.mergeLiterals).toEqual(['card', 'p-2', 'p-4']);
    });

    it('is aggregated across shards when the safelist materializes', () => {
        const root = tailwindProject('csszyx-next-census-', {
            'src/a.tsx': 'a',
            'src/b.tsx': 'b',
            'src/old.tsx': 'old',
        });
        const paths = resolveNextSafelistStatePaths(root);
        mkdirSync(paths.shardsDir, { recursive: true });
        writeNextSafelistShard(
            paths.shardsDir,
            {
                sourcePath: join(root, 'src/a.tsx'),
                sourceHash: 'a',
                classes: ['m-4', 'p-4'],
                authoredClasses: ['card'],
                mergeLiterals: ['p-2', 'p-4'],
            },
            { retryDelayMs: 0 },
        );
        writeNextSafelistShard(
            paths.shardsDir,
            {
                sourcePath: join(root, 'src/b.tsx'),
                sourceHash: 'b',
                classes: ['gap-2'],
                authoredClasses: ['card', 'hero'],
                mergeLiterals: ['gap-8'],
            },
            { retryDelayMs: 0 },
        );
        // A shard written before these fields existed still counts for its classes.
        writeNextSafelistShard(
            paths.shardsDir,
            { sourcePath: join(root, 'src/old.tsx'), sourceHash: 'old', classes: ['mt-2'] },
            { retryDelayMs: 0 },
        );

        const result = materializeNextSafelist(paths, { retryDelayMs: 0 });

        expect(result.classes).toEqual(['gap-2', 'm-4', 'mt-2', 'p-4']);
        expect(result.authoredClasses).toEqual(['card', 'hero']);
        expect(result.mergeLiterals).toEqual(['gap-8', 'p-2', 'p-4']);
    });
});

describe('the design system the Next commands read', () => {
    it('comes back with the facts, so the same compile can sign the merge table', async () => {
        const root = tailwindProject('csszyx-next-model-', {
            'app/globals.css': '@import "tailwindcss";',
        });
        const facts = await prepareNextStylesheetFacts({ explicitRoot: root, cwd: root });
        expect(facts.model?.signature('p-4') ?? null).not.toBeNull();
    }, 60_000);
});

describe('the Turbopack loader and the registration file', () => {
    const OPTIONS = {
        parserMode: 'auto' as never,
        config: { mangleVars: false },
        writeOptions: { retryDelayMs: 0 },
        materializeSafelist: false,
    };

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

    async function app(): Promise<{ root: string; page: string; file: string }> {
        const root = tailwindProject('csszyx-next-registration-', {
            'package.json': '{ "name": "app" }\n',
            'app/globals.css': '@import "tailwindcss";',
            'app/page.tsx': SOURCE,
        });
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
        return {
            root,
            page: join(root, 'app/page.tsx'),
            file: join(root, '.csszyx', MERGE_REGISTRATION_FILE),
        };
    }

    it('imports the file the Next commands wrote, after the use client directive', async () => {
        const { root, page, file } = await app();
        writeFileSync(file, '// written by csszyx next prebuild\n');
        const context = loaderContext(root, page);

        const output = runNextTurboLoader(SOURCE, context, OPTIONS);

        const code = output.code;
        const directive = code.indexOf("'use client'");
        const registration = code.indexOf(`import '../.csszyx/${MERGE_REGISTRATION_FILE}';`);
        expect(directive).toBe(0);
        expect(registration).toBeGreaterThan(directive);
        expect(context.dependencies).toContain(file);
    }, 60_000);

    it('imports the file from a module that re-exports szcn under another name', async () => {
        const { root, file } = await app();
        writeFileSync(file, '// written by csszyx next prebuild\n');
        const helper = join(root, 'lib/cn.ts');
        const context = loaderContext(root, helper);

        const output = runNextTurboLoader(
            "export { szcn as cn } from '@csszyx/runtime';\n",
            context,
            OPTIONS,
        );

        expect(output.code).toContain(`import '../.csszyx/${MERGE_REGISTRATION_FILE}';`);
        expect(context.dependencies).toContain(file);
    }, 60_000);

    it('imports an empty table before a Next command has written one', async () => {
        // `csszyx next watch` writes the table after its first full prebuild,
        // and Turbopack compiles pages meanwhile. A module that imported
        // nothing then would never re-run when the table appears; one that
        // imports the empty file and depends on it re-runs on the write.
        const { root, page, file } = await app();
        const context = loaderContext(root, page);

        const output = runNextTurboLoader(SOURCE, context, OPTIONS);

        expect(output.code).toContain(`import '../.csszyx/${MERGE_REGISTRATION_FILE}';`);
        expect(context.dependencies).toContain(file);
        expect(registrations(file)).toEqual({ unserved: [], table: [{}, []] });
    }, 60_000);

    it('never replaces a table a Next command has written', async () => {
        const { root, page, file } = await app();
        writeFileSync(file, '// written by csszyx next prebuild\n');

        runNextTurboLoader(SOURCE, loaderContext(root, page), OPTIONS);

        expect(readFileSync(file, 'utf8')).toBe('// written by csszyx next prebuild\n');
    }, 60_000);
});

describe('the two lanes of one Next app', () => {
    it('keep the webpack placeholder module apart from the settled module', () => {
        // `next dev --webpack` and `next dev --turbo` share `.csszyx`. The
        // webpack lane writes its registration with placeholders that its own
        // `processAssets` fills in over the emitted assets; imported as-is, the
        // bare placeholder is a ReferenceError. The settled module Turbopack
        // and jest import is final on disk, so the two may never share a path.
        const root = tailwindProject('csszyx-next-registration-lanes-', {
            'package.json': '{ "name": "app" }\n',
        });

        const webpack = ensureUnservedRuntimeFile(join(root, '.csszyx'));
        const next = writeMergeRegistration({
            root,
            model: null,
            classes: [],
            authoredClasses: [],
            mergeLiterals: [],
        });

        expect(webpack).not.toBeNull();
        expect(next.path).not.toBe(webpack);
        expect(readFileSync(webpack as string, 'utf8')).toContain('___CSSZYX_UNSERVED___');
        expect(readFileSync(next.path, 'utf8')).not.toContain('___CSSZYX_UNSERVED___');
    });
});
