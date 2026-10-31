/**
 * A build pinned to one engine artifact runs every engine call on it, the
 * scans that read a script's `<style>` elements and its runtime loads as well
 * as the transform (`@csszyx/compiler` `chooseEngine`).
 */
import { join } from 'node:path';

import { noClassHooks } from '@csszyx/tailwind-oracle';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { runNextTurboLoader } from '../src/next-turbo-loader.js';
import { readStyleHooks, SourceHookRegistry } from '../src/source-hooks.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const asked = vi.hoisted(() => [] as Array<string | undefined>);

vi.mock('@csszyx/compiler/engine', async importOriginal => {
    const engine = await importOriginal<typeof import('@csszyx/compiler/engine')>();
    return {
        ...engine,
        scanModuleLinks: ((files, options) => {
            asked.push(options?.parser);
            return engine.scanModuleLinks(files, options);
        }) satisfies typeof engine.scanModuleLinks,
    };
});

const STYLE = "export const S = () => <style>{'.card {}'}</style>;\n";
const SZR = "import { szr } from '@csszyx/runtime';\nexport const x = szr({ p: 4 });\n";

afterEach(() => {
    asked.length = 0;
    removeTailwindProjects();
});

describe('the engine artifact a build names', () => {
    it('reads a script’s style elements', () => {
        readStyleHooks(STYLE, 'tsx', noClassHooks(), 'wasm');

        expect(asked).toEqual(['wasm']);
    });

    it('reads every script the registry reads', () => {
        const registry = new SourceHookRegistry(
            () => null,
            () => 'wasm',
        );
        registry.readText('/p/a.tsx', STYLE, 'tsx');
        registry.readTexts([{ file: '/p/b.tsx', text: STYLE, extension: 'tsx' }]);

        expect(asked).toEqual(['wasm', 'wasm']);
    });

    it('reads what a module the Turbopack loader finishes loads', async () => {
        const root = tailwindProject('csszyx-engine-artifact-', {
            'package.json': '{ "name": "app" }\n',
            'src/index.css': '@import "tailwindcss" prefix(tw);\n',
            'src/x.ts': SZR,
        });
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });

        runNextTurboLoader(
            SZR,
            {
                resourcePath: join(root, 'src/x.ts'),
                rootContext: root,
                context: join(root, 'src'),
                mode: 'development',
            },
            {
                parserMode: 'wasm',
                config: { mangleVars: false },
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                compilerVersion: '0.9.0',
                nativeVersion: '0.9.0-test',
                writeOptions: { retryDelayMs: 0 },
            },
        );

        expect(asked).toContain('wasm');
        expect(asked).not.toContain('rust');
    }, 60_000);
});
