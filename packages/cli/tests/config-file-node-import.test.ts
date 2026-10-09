/**
 * The built config loader under plain Node, for every name and package type.
 *
 * vitest loads modules through Vite, which strips TypeScript and accepts ES
 * syntax whatever the package type, so an in-process test cannot see what a
 * build process sees. This one runs the shipped `@csszyx/unplugin/diagnostics`
 * in a child `node`. Measured on Node 24.18 without the loader's retry:
 * `csszyx.config.ts` and `.js` written with `export default` throw "Cannot use
 * import statement outside a module" under `"type": "commonjs"`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const LOADER = pathToFileURL(
    createRequire(import.meta.url).resolve('@csszyx/unplugin/diagnostics'),
).href.replace(/\.cjs$/, '.mjs');
const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TS_CONFIG = [
    "import type { CsszyxFileConfig } from 'csszyx';",
    "const level: 'warn' | 'off' = 'warn';",
    "const config: CsszyxFileConfig = { diagnostics: { rules: { 'dead-class': level } } };",
    'export default config;',
].join('\n');
const JS_CONFIG = "export default { diagnostics: { rules: { 'dead-class': 'warn' } } };\n";
/** The file `csszyx init` wrote before csszyx read it, whatever the language. */
const INIT_TEMPLATE = `import type { CsszyxConfig } from 'csszyx';

const config: CsszyxConfig = {
  development: {
    debug: true,
  },
};

export default config;
`;

/**
 * Load a project's config in a child Node and answer what it read.
 *
 * @param root - The project root.
 * @returns The dead-class level, the problems, and the child's stderr.
 */
function loadInNode(root: string): {
    level: string;
    problems: Array<{ severity: string; path: string; message: string }>;
    stderr: string;
} {
    const script = `
        const { loadDiagnosticPolicy } = await import(${JSON.stringify(LOADER)});
        const loaded = await loadDiagnosticPolicy(${JSON.stringify(root)});
        console.log(JSON.stringify({
            level: loaded.policy.levelOf({ rule: 'dead-class' }),
            problems: loaded.problems,
        }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
    });
    return { ...JSON.parse(child.stdout), stderr: child.stderr };
}

/**
 * Lay down a project with a package type and one config file.
 *
 * @param type - The package type, or undefined for none.
 * @param name - The config file name.
 * @param text - Its contents.
 * @returns The project root.
 */
function project(type: string | undefined, name: string, text: string): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-node-config-')));
    dirs.push(root);
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(type === undefined ? { name: 'app' } : { name: 'app', type }),
    );
    writeFileSync(join(root, name), text);
    return root;
}

describe('csszyx.config under plain Node', () => {
    it.each([
        ['module', 'csszyx.config.ts', TS_CONFIG],
        ['commonjs', 'csszyx.config.ts', TS_CONFIG],
        [undefined, 'csszyx.config.ts', TS_CONFIG],
        ['commonjs', 'csszyx.config.mts', TS_CONFIG],
        ['commonjs', 'csszyx.config.js', JS_CONFIG],
        ['commonjs', 'csszyx.config.mjs', JS_CONFIG],
    ])('reads a %s-typed %s', (type, name, text) => {
        const loaded = loadInNode(project(type, name, text));

        expect(loaded.problems).toEqual([]);
        expect(loaded.level).toBe('warn');
    });

    it.each([
        ['an ES-module', 'module'],
        ['an untyped', undefined],
        ['a CommonJS', 'commonjs'],
    ])(
        'only warns about the TypeScript text `csszyx init` wrote into csszyx.config.js in %s package',
        (_label, type) => {
            const loaded = loadInNode(project(type, 'csszyx.config.js', INIT_TEMPLATE));

            expect(loaded.problems).toHaveLength(1);
            expect(loaded.problems[0]).toMatchObject({
                severity: 'warning',
                path: 'csszyx.config.js',
            });
            expect(loaded.problems[0]?.message).toContain('sets no `diagnostics`');
            expect(loaded.level).toBe('error');
        },
    );

    it('keeps a commonjs-typed csszyx.config.js that sets diagnostics and fails to load an error', () => {
        const loaded = loadInNode(
            project(
                'commonjs',
                'csszyx.config.js',
                `import type { CsszyxFileConfig } from 'csszyx';\n${JS_CONFIG}`,
            ),
        );

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({ severity: 'error', path: 'csszyx.config.js' });
    });
});
