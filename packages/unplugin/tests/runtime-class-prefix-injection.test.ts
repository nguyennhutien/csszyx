/**
 * Every lane that imports the runtime also registers the Tailwind prefix.
 *
 * A module that keeps an sz object for the runtime lowers it in the browser,
 * where no stylesheet can be read. The build knows the prefix, and every lane
 * already inserts the runtime helper import into such a module, so it inserts
 * the registration beside it. A project with no prefix gets exactly the code it
 * got before, and a module that never lowers an object registers nothing.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTransformer } from '../src/jest-transform.js';
import { injectNextRuntimeImports } from '../src/next-runtime-injection.js';
import { writeNextStylesheetFacts } from '../src/next-stylesheet-facts.js';
import { runNextTurboLoader } from '../src/next-turbo-loader.js';
import { vitePlugin } from '../src/unplugin.js';
import { callHooks, removeTailwindProjects, tailwindProject } from './tailwind-project.js';

const REGISTRATION = '__szRegisterClassPrefix("tw");';
const SPREAD = 'export const A = ({ rest }) => <div sz={{ p: 4, ...rest }} />;\n';

afterEach(removeTailwindProjects);

describe('injectNextRuntimeImports with a prefix', () => {
    it('registers the prefix beside the helper that lowers an object', () => {
        const { code } = injectNextRuntimeImports(
            'const a = _sz({ p: 4, ...rest });\n',
            { usesRuntime: true },
            'tw',
        );

        expect(code).toContain("import { _sz } from '@csszyx/runtime';");
        expect(code).toContain(
            "import { registerSzClassPrefix as __szRegisterClassPrefix } from '@csszyx/runtime';",
        );
        expect(code).toContain(REGISTRATION);
    });

    it('registers for a merge that lowers an object too', () => {
        expect(
            injectNextRuntimeImports('const a = _szMerge(x);\n', { usesMerge: true }, 'tw').code,
        ).toContain(REGISTRATION);
    });

    it('keeps a use-client directive first', () => {
        const { code } = injectNextRuntimeImports(
            '"use client";\nconst a = _sz(x);\n',
            { usesRuntime: true },
            'tw',
        );

        expect(code.startsWith('"use client";')).toBe(true);
    });

    it('registers no prefix explicitly so an incompatible shared build fails loudly', () => {
        const source = 'const a = _sz({ p: 4, ...rest });\n';

        expect(injectNextRuntimeImports(source, { usesRuntime: true }, null).code).toContain(
            '__szRegisterClassPrefix(null);',
        );
    });

    it('registers nothing for a module that never lowers an object', () => {
        const picks = injectNextRuntimeImports(
            'const a = __szvPick(t, s);\n',
            { usesSzvPick: true },
            'tw',
        );
        const slim = injectNextRuntimeImports(
            'const a = _szPart("p-4");\n',
            { usesSzPart: true, szPartArgsProvable: true },
            'tw',
        );

        expect(picks.code).not.toContain('__szRegisterClassPrefix');
        expect(slim.code).not.toContain('__szRegisterClassPrefix');
    });

    it('registers once, however many times the module is finished', () => {
        const once = injectNextRuntimeImports(
            'const a = _sz(x);\n',
            { usesRuntime: true },
            'tw',
        ).code;
        const twice = injectNextRuntimeImports(once, { usesRuntime: true }, 'tw').code;

        expect(twice.split(REGISTRATION)).toHaveLength(2);
    });
});

describe('the lanes register the prefix', () => {
    /**
     * A prefixed project holding one module that keeps its object for the runtime.
     *
     * @returns The root and the module path.
     */
    function project(): { root: string; file: string } {
        const root = tailwindProject('csszyx-runtime-prefix-', {
            'package.json': '{ "name": "app" }\n',
            'src/index.css': '@import "tailwindcss" prefix(tw);\n',
            'src/A.tsx': SPREAD,
        });
        return { root, file: join(root, 'src/A.tsx') };
    }

    it('vite', async () => {
        const { root, file } = project();
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', SPREAD, file)) as { code: string };

        expect(result.code).toContain(REGISTRATION);
    }, 60_000);

    it('vite, for a stock project, writes no registration', async () => {
        const root = tailwindProject('csszyx-runtime-stock-', {
            'src/index.css': '@import "tailwindcss";\n',
            'src/A.tsx': SPREAD,
        });
        const call = callHooks(
            vitePlugin({
                build: { cache: false },
                production: { mangle: false },
            }) as unknown as Record<string, unknown>[],
        );

        await call('configResolved', { root, command: 'build' });
        const result = (await call('transform', SPREAD, join(root, 'src/A.tsx'))) as {
            code: string;
        };

        expect(result.code).toContain('__szRegisterClassPrefix(null);');
    }, 60_000);

    it('the Next Turbopack loader', async () => {
        const { root, file } = project();
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });

        const result = runNextTurboLoader(
            SPREAD,
            {
                resourcePath: file,
                rootContext: root,
                context: join(root, 'src'),
                mode: 'development',
            },
            {
                parserMode: 'auto' as never,
                config: { mangleVars: false },
                nextVersion: '16.2.7',
                csszyxVersion: '0.9.0',
                compilerVersion: '0.9.0',
                nativeVersion: '0.9.0-test',
                writeOptions: { retryDelayMs: 0 },
            },
        );

        expect(result.code).toContain(REGISTRATION);
    }, 60_000);

    it('the jest transformer', async () => {
        const { root, file } = project();
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });

        const { code } = createTransformer({
            root,
            cacheRoot: join(root, '.csszyx/cache/transform'),
        }).process(SPREAD, file);

        expect(code).toContain(REGISTRATION);
    }, 60_000);
});
