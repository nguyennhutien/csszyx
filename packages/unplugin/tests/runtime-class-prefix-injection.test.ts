/**
 * Every lane that imports the runtime also registers the Tailwind prefix.
 *
 * A module that keeps an sz object for the runtime lowers it in the browser,
 * where no stylesheet can be read. The build knows the prefix, and every lane
 * already inserts the runtime helper import into such a module, so it inserts
 * the registration beside it. A project with no prefix gets exactly the code it
 * got before, and a module that never lowers an object registers nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
/** A module that lowers an object itself, through the public runtime call. */
const SZR = "import { szr } from '@csszyx/runtime';\nexport const x = szr({ p: 4 });\n";

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

    // `szr` is the public name of `_sz`: a module that calls it lowers an
    // object in the browser, with no helper of the compiler's in sight.
    it('registers for a module that imports szr itself, from either entry', () => {
        const fromCsszyx = "import { szr as cx } from 'csszyx';\nexport const x = cx({ p: 4 });\n";

        expect(injectNextRuntimeImports(SZR, {}, 'tw').code).toContain(REGISTRATION);
        expect(injectNextRuntimeImports(fromCsszyx, {}, 'tw').code).toContain(REGISTRATION);
    });

    // A design system re-exports `szr` from its own module, so the barrel is
    // the one module that names the runtime; a namespace import or the core
    // entry reaches the same call.
    it.each([
        ['a barrel that re-exports it', "export { szr } from '@csszyx/runtime';\n"],
        [
            'a namespace import',
            "import * as rt from '@csszyx/runtime';\nexport const x = rt.szr({ p: 4 });\n",
        ],
        [
            'the core entry',
            "import { szr } from '@csszyx/runtime/core';\nexport const x = szr({ p: 4 });\n",
        ],
    ])('registers for %s', (_name, source) => {
        expect(injectNextRuntimeImports(source, {}, 'tw').code).toContain(REGISTRATION);
    });

    it('registers for a dynamic import of the runtime, as an ES module', () => {
        const source =
            "export async function cls() {\n    const { szr } = await import('@csszyx/runtime');\n    return szr({ p: 4 });\n}\n";
        const { code } = injectNextRuntimeImports(source, {}, 'tw');

        expect(code).toContain(
            "import { registerSzClassPrefix as __szRegisterClassPrefix } from '@csszyx/runtime';",
        );
        expect(code).toContain(REGISTRATION);
    });

    // A Flow `import type` is no JavaScript, so the parse of a `.js` file stops
    // before it reaches the runtime import; a registration it does not need
    // costs one import, one it needs and lacks costs every class.
    it('registers for a module the engine could not parse', () => {
        const source =
            "import type { A } from './a';\nimport { szr } from '@csszyx/runtime';\nexport const x = szr({ p: 4 });\n";
        const { code } = injectNextRuntimeImports(source, {}, 'tw', { file: '/p/src/a.js' });

        expect(code).toContain(REGISTRATION);
        expect(code).toContain('import { registerSzClassPrefix as __szRegisterClassPrefix }');
    });

    // An `import` statement would make a CommonJS module an ES one.
    it('registers with require in a CommonJS module that requires the runtime', () => {
        const source =
            "const { szr } = require('@csszyx/runtime');\nmodule.exports.cls = szr({ p: 4 });\n";
        const { code } = injectNextRuntimeImports(source, {}, 'tw');

        expect(code).toContain(
            "const { registerSzClassPrefix: __szRegisterClassPrefix } = require('@csszyx/runtime');",
        );
        expect(code).toContain(REGISTRATION);
        expect(code).not.toContain('import ');
    });

    // The form follows the module, not the call: a CommonJS file may load the
    // runtime with `import()`, and an ES module may `require` it through
    // `createRequire` or name it in a string.
    it.each([
        [
            'a CommonJS module that loads it with import()',
            "module.exports = async () => {\n    const { szr } = await import('@csszyx/runtime');\n    return szr({ p: 4 });\n};\n",
            'require',
        ],
        [
            'a CommonJS module with both calls',
            "const { szr } = require('csszyx');\nmodule.exports = () => import('csszyx/core').then(() => szr({ p: 4 }));\n",
            'require',
        ],
        [
            'an ES module that requires it through createRequire',
            "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconst { szr } = require('@csszyx/runtime');\nexport const c = szr({ p: 4 });\n",
            'import',
        ],
    ])('registers %s in its own module format', (_name, source, form) => {
        const { code } = injectNextRuntimeImports(source, {}, 'tw');
        const required = code.includes(
            "const { registerSzClassPrefix: __szRegisterClassPrefix } = require('@csszyx/runtime');",
        );
        const imported = code.includes(
            "import { registerSzClassPrefix as __szRegisterClassPrefix } from '@csszyx/runtime';",
        );

        expect({ required, imported }).toEqual({
            required: form === 'require',
            imported: form === 'import',
        });
    });

    it('registers for a barrel that re-exports the whole runtime', () => {
        expect(
            injectNextRuntimeImports("export * from '@csszyx/runtime';\n", {}, 'tw').code,
        ).toContain(REGISTRATION);
    });

    // The parse tells a call from text: a module that only names the runtime
    // in a string or a comment loads nothing.
    it.each([
        ['a string', 'export const hint = "run require(\'csszyx\') in a script";\n'],
        ['a block comment', "/*\nexport * from '@csszyx/runtime';\n*/\nmodule.exports = 1;\n"],
    ])('registers nothing for a module that names the runtime only in %s', (_name, source) => {
        expect(injectNextRuntimeImports(source, {}, 'tw').code).not.toContain(
            '__szRegisterClassPrefix',
        );
    });

    it('registers nothing for a require of an entry that only joins strings', () => {
        const source =
            "const { szcn } = require('@csszyx/runtime/merge');\nmodule.exports.c = szcn('p-4');\n";

        expect(injectNextRuntimeImports(source, {}, 'tw').code).not.toContain(
            '__szRegisterClassPrefix',
        );
    });

    it('registers nothing for a module that imports only string helpers', () => {
        const strings = "import { szcn } from '@csszyx/runtime';\nexport const x = szcn('p-4');\n";

        expect(injectNextRuntimeImports(strings, {}, 'tw').code).not.toContain(
            '__szRegisterClassPrefix',
        );
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
            'src/x.ts': SZR,
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
        const called = (await call('transform', SZR, join(root, 'src/x.ts'))) as { code: string };

        expect(result.code).toContain(REGISTRATION);
        expect(called.code).toContain(REGISTRATION);
    }, 60_000);

    // Vite hands the plugin TypeScript as written, and `import type` is no
    // JavaScript: read as `.js`, the parse stops, and a module that only joins
    // strings would register as one the parse could not read.
    describe.each(['rust', 'wasm'] as const)('vite on the %s engine, for TypeScript', parser => {
        async function transformTyped(source: string): Promise<string> {
            const { root } = project();
            const call = callHooks(
                vitePlugin({
                    build: { cache: false, parser },
                    production: { mangle: false },
                }) as unknown as Record<string, unknown>[],
            );
            await call('configResolved', { root, command: 'build' });
            const typed = `import type { A } from './A';\n${source}`;
            const result = (await call('transform', typed, join(root, 'src/x.ts'))) as {
                code: string;
            };
            return result.code;
        }

        it('registers for a module that calls szr', async () => {
            expect(await transformTyped(SZR)).toContain(REGISTRATION);
        }, 60_000);

        it('registers nothing for a module that only joins strings', async () => {
            const strings =
                "import { szcn } from '@csszyx/runtime';\nexport const x = szcn('p-4');\n";
            expect(await transformTyped(strings)).not.toContain('__szRegisterClassPrefix');
        }, 60_000);
    });

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
        const called = runNextTurboLoader(
            SZR,
            {
                resourcePath: join(root, 'src/x.ts'),
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
        expect(called.code).toContain(REGISTRATION);
    }, 60_000);

    it('the jest transformer', async () => {
        const { root, file } = project();
        await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });

        const transformer = createTransformer({
            root,
            cacheRoot: join(root, '.csszyx/cache/transform'),
        });

        expect(transformer.process(SPREAD, file).code).toContain(REGISTRATION);
        expect(transformer.process(SZR, join(root, 'src/x.ts')).code).toContain(REGISTRATION);
    }, 60_000);
});

// The registration has to run, not only be present: the wrong module format
// throws at load (`require` in an ES module, `import` in CommonJS).
describe('the registration runs in the module it was written into', () => {
    /**
     * Write the finished module beside this package, where `@csszyx/runtime`
     * resolves, and run it with Node.
     *
     * @param name - The file name; its extension sets the format.
     * @param source - The author's module, which prints `szr({ p: 4 })`.
     * @returns What it printed.
     */
    function run(name: string, source: string): string {
        const dir = mkdtempSync(join(import.meta.dirname, '..', '.tmp-format-'));
        try {
            const file = join(dir, name);
            // A package with no type, so only the module's own syntax makes a
            // `.js` file an ES module.
            writeFileSync(join(dir, 'package.json'), '{}\n');
            writeFileSync(file, injectNextRuntimeImports(source, {}, 'tw', { file }).code);
            return execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it.each([
        [
            'an .mjs that loads it with a top-level import()',
            'x.mjs',
            "const { szr } = await import('@csszyx/runtime');\nconsole.log(szr({ p: 4 }));\n",
        ],
        [
            'a .cjs that requires it',
            'x.cjs',
            "const { szr } = require('@csszyx/runtime');\nconsole.log(szr({ p: 4 }));\n",
        ],
        [
            'a .cjs that loads it with import()',
            'x.cjs',
            "import('@csszyx/runtime').then(({ szr }) => console.log(szr({ p: 4 })));\n",
        ],
        [
            'a .cjs that loads it with import() of a template',
            'x.cjs',
            'import(`@csszyx/runtime`).then(({ szr }) => console.log(szr({ p: 4 })));\n',
        ],
        [
            'a .cjs that requires it through an escape',
            'x.cjs',
            "const { szr } = require('@csszyx\\/runtime');\nconsole.log(szr({ p: 4 }));\n",
        ],
        [
            'a .js in an untyped package whose template reads import.meta',
            'x.js',
            "import('@csszyx/runtime').then(({ szr }) =>\n" +
                "    console.log(`${import.meta.url ? szr({ p: 4 }) : ''}`),\n" +
                ');\n',
        ],
    ])(
        '%s',
        (_name, file, source) => {
            expect(run(file, source)).toBe('tw:p-4');
        },
        60_000,
    );

    // A comment that spells a re-export is not one: the module stays CommonJS.
    it.each([
        ['a line comment', "// Example: export * from '@csszyx/runtime';\n"],
        ['a block comment', "/*\nexport * from '@csszyx/runtime';\n*/\n"],
    ])(
        'a CommonJS module the jest transformer finishes, with export * in %s',
        async (_name, comment) => {
            const root = tailwindProject('csszyx-runtime-format-', {
                'package.json': '{ "name": "app" }\n',
                'src/index.css': '@import "tailwindcss" prefix(tw);\n',
            });
            await writeNextStylesheetFacts({ root, cacheDir: join(root, '.csszyx/cache') });
            const source = `${comment}const { szr } = require('@csszyx/runtime');\nconsole.log(szr({ p: 4 }));\n`;
            const { code } = createTransformer({
                root,
                cacheRoot: join(root, '.csszyx/cache/transform'),
            }).process(source, join(root, 'src/x.js'));
            const dir = mkdtempSync(join(import.meta.dirname, '..', '.tmp-format-'));
            try {
                const file = join(dir, 'x.cjs');
                writeFileSync(file, code);
                expect(execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim()).toBe(
                    'tw:p-4',
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        60_000,
    );
});
