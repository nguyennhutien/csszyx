/**
 * Loading `csszyx.config.{ts,mts,js,mjs}` with Node's own `import()`.
 *
 * Node strips TypeScript types natively, but a `.ts` or `.js` file is still
 * read as CommonJS under `"type": "commonjs"`, and the config every project is
 * told to write uses `export default`. Measured on Node 24: `import()` throws
 * "Cannot use import statement outside a module" for exactly that file. The
 * loader retries it as an ES module, the same file under an `.mts`/`.mjs`
 * name beside it, which is how Vite loads its own config.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CSSZYX_CONFIG_FILE_NAMES,
    csszyxConfigFileNameFor,
    DIAGNOSTIC_POLICY_STATE_FILE,
    findCsszyxConfigFile,
    isLegacyInitTemplate,
    loadDiagnosticPolicy,
    readDiagnosticPolicyState,
    writeDiagnosticPolicyState,
} from '../src/csszyx-config-file.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';

const roots: string[] = [];

/**
 * Node's answer for an ES-module file it reads as CommonJS.
 *
 * vitest sends `import()` through Vite, which accepts ESM syntax whatever the
 * package type, so the failure the fallback exists for cannot happen here.
 * This importer fails the way Node does for every name but the twin the
 * loader writes; `config-file-node-import.test.ts` in the CLI runs the built
 * loader under plain Node for the real thing.
 *
 * @param url - The URL the loader imports.
 * @returns The module, for the twin only.
 */
const commonJsNode = (url: string): Promise<unknown> =>
    /\.timestamp-[^/]*\.m[jt]s$/.test(url)
        ? import(url)
        : Promise.reject(new SyntaxError('Cannot use import statement outside a module'));

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

/**
 * An importer that records each URL it is asked for and imports it.
 *
 * @returns The importer and the URLs, in order.
 */
function recordingImporter(): { urls: string[]; importModule: (url: string) => Promise<unknown> } {
    const urls: string[] = [];
    return {
        urls,
        importModule: url => {
            urls.push(url);
            return import(url);
        },
    };
}

/**
 * Whether a URL names the ES-module copy the loader writes.
 *
 * @param url - The imported URL.
 * @returns True for the copy.
 */
const isCopy = (url: string): boolean => /\.timestamp-[^/]*\.m[jt]s$/.test(url);

/**
 * Lay down a project.
 *
 * @param files - Relative path to contents.
 * @returns The project root.
 */
function project(files: Record<string, string>): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'csszyx-config-file-')));
    roots.push(root);
    for (const [name, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), text);
    }
    return root;
}

const TS_CONFIG = [
    "import type { CsszyxFileConfig } from './types';",
    "const level: 'warn' | 'off' = 'warn';",
    'const config: CsszyxFileConfig = { diagnostics: { rules: { "dead-class": level } } };',
    'export default config;',
].join('\n');
const JS_CONFIG = 'export default { diagnostics: { rules: { "dead-class": "warn" } } };\n';
/** The file `csszyx init` wrote before csszyx read it, whatever the language. */
const INIT_TEMPLATE = `import type { CsszyxConfig } from 'csszyx';

const config: CsszyxConfig = {
  development: {
    debug: true,
  },
};

export default config;
`;

describe('loadDiagnosticPolicy', () => {
    // TypeScript under every package type is loaded by plain Node in the CLI's
    // `config-file-node-import.test.ts`; vitest's own transform stands in for
    // Node here and would prove nothing about type stripping.
    it.each([
        ['module', 'csszyx.config.js', JS_CONFIG],
        ['commonjs', 'csszyx.config.js', JS_CONFIG],
        ['commonjs', 'csszyx.config.mjs', JS_CONFIG],
    ])('reads %s-typed %s', async (type, name, text) => {
        const root = project({
            'package.json': JSON.stringify(type === undefined ? { name: 'app' } : { type }),
            [name]: text,
        });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.file).toBe(path.join(root, name));
        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('warn');
        // The ES-module copy is gone, so nothing is left in the project.
        expect(fs.readdirSync(root).filter(entry => entry.includes('timestamp'))).toEqual([]);
    });

    it.each(['csszyx.config.ts', 'csszyx.config.js'])(
        'retries %s as an ES module when Node reads it as CommonJS, and removes the copy',
        async name => {
            const root = project({ 'package.json': '{"type":"commonjs"}', [name]: JS_CONFIG });

            const loaded = await loadDiagnosticPolicy(root, commonJsNode);

            expect(loaded.problems).toEqual([]);
            expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('warn');
            expect(fs.readdirSync(root).filter(entry => entry.includes('timestamp'))).toEqual([]);
        },
    );

    it.each([
        ['an untyped', { name: 'app' }],
        ['a CommonJS', { type: 'commonjs' }],
    ])(
        'imports an ES-module .ts in %s package from its copy, so Node never warns about the type',
        async (_label, packageJson) => {
            // Imported natively, Node prints MODULE_TYPELESS_PACKAGE_JSON (no
            // type) or "Failed to load the ES module" (commonjs), both telling
            // the user to add `"type": "module"`, which would break a CommonJS
            // app. The copy has a name Node never reads as CommonJS.
            const root = project({
                'package.json': JSON.stringify(packageJson),
                'csszyx.config.ts': JS_CONFIG,
            });
            const { urls, importModule } = recordingImporter();

            const loaded = await loadDiagnosticPolicy(root, importModule);

            expect(urls).toHaveLength(1);
            expect(isCopy(urls[0] as string)).toBe(true);
            expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('warn');
        },
    );

    it('imports a .ts config in an ES-module package, and a CommonJS one anywhere, directly', async () => {
        const esm = project({ 'package.json': '{"type":"module"}', 'csszyx.config.ts': JS_CONFIG });
        const cjs = project({
            'csszyx.config.js': 'module.exports = { diagnostics: { preset: "atomic" } };',
        });
        const { urls, importModule } = recordingImporter();

        await loadDiagnosticPolicy(esm, importModule);
        await loadDiagnosticPolicy(cjs, importModule);

        expect(urls.map(isCopy)).toEqual([false, false]);
    });

    it('reads the package type from the nearest package.json above the config', async () => {
        const root = project({
            'package.json': '{"type":"module"}',
            'app/csszyx.config.ts': JS_CONFIG,
        });
        const { urls, importModule } = recordingImporter();

        await loadDiagnosticPolicy(path.join(root, 'app'), importModule);

        expect(urls.map(isCopy)).toEqual([false]);
    });

    it('still retries from a copy when ES syntax it did not recognise fails as CommonJS', async () => {
        const root = project({
            'package.json': '{"type":"commonjs"}',
            'csszyx.config.ts': `;${JS_CONFIG}`,
        });

        const loaded = await loadDiagnosticPolicy(root, commonJsNode);

        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('warn');
    });

    it('gives each concurrent load its own copy, and removes every one', async () => {
        // Two loads in the same millisecond of one process used to write the
        // same name, and the first to finish removed the file the second was
        // about to import.
        vi.spyOn(Date, 'now').mockReturnValue(1);
        const root = project({ 'csszyx.config.ts': JS_CONFIG });
        const copies: string[] = [];
        const importModule = async (url: string): Promise<unknown> => {
            if (!isCopy(url)) return commonJsNode(url);
            copies.push(url);
            await new Promise(resolve => setTimeout(resolve, 5));
            return import(url);
        };

        const loads = await Promise.all([
            loadDiagnosticPolicy(root, importModule),
            loadDiagnosticPolicy(root, importModule),
        ]);

        expect(loads.map(loaded => loaded.problems)).toEqual([[], []]);
        expect(new Set(copies).size).toBe(2);
        expect(fs.readdirSync(root).filter(entry => entry.includes('timestamp'))).toEqual([]);
    });

    it('does not retry an .mjs config, which Node never reads as CommonJS', async () => {
        const root = project({ 'csszyx.config.mjs': JS_CONFIG });

        const loaded = await loadDiagnosticPolicy(root, commonJsNode);

        expect(loaded.problems[0]?.message).toContain('Cannot use import statement');
    });

    it('does not retry a failure that is not a syntax error', async () => {
        // An ES-module package, so the file is imported directly first.
        const root = project({
            'package.json': '{"type":"module"}',
            'csszyx.config.ts': JS_CONFIG,
        });

        const loaded = await loadDiagnosticPolicy(root, () =>
            Promise.reject(new Error('ERR_MODULE_NOT_FOUND')),
        );

        expect(loaded.problems[0]?.message).toContain('ERR_MODULE_NOT_FOUND');
    });

    it('reads a CommonJS config written with module.exports', async () => {
        const root = project({
            'package.json': '{"type":"commonjs"}',
            'csszyx.config.js': 'module.exports = { diagnostics: { preset: "atomic" } };',
        });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.policy.levelOf({ rule: 'merge-covered-key' })).toBe('warn');
    });

    it('resolves the config imports from beside the config', async () => {
        const root = project({
            'package.json': '{"type":"commonjs"}',
            'levels.mjs': 'export const level = "off";',
            'csszyx.config.ts':
                "import { level } from './levels.mjs';\nexport default { diagnostics: { rules: { 'dead-class': level } } };",
        });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('off');
    });

    it('answers the recommended preset when the project has no config', async () => {
        const loaded = await loadDiagnosticPolicy(project({}));

        expect(loaded.file).toBeNull();
        expect(loaded.problems).toEqual([]);
        expect(loaded.policy.levelOf({ rule: 'sz-diagnostic', kind: 'class-precedence' })).toBe(
            'info',
        );
    });

    it('reports a config that does not load as an error, and keeps the defaults', async () => {
        const root = project({ 'csszyx.config.mjs': 'export default { diagnostics: {;\n' });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({ severity: 'error', path: 'csszyx.config.mjs' });
        expect(loaded.problems[0]?.message).toContain('could not be loaded');
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('error');
    });

    it('reports a TypeScript config that fails as ESM too, without leaving its copy', async () => {
        const root = project({
            'package.json': '{"type":"commonjs"}',
            'csszyx.config.ts': 'export default { diagnostics: {;\n',
        });

        const loaded = await loadDiagnosticPolicy(root, commonJsNode);

        expect(loaded.problems[0]?.message).toContain('could not be loaded');
        expect(fs.readdirSync(root).filter(entry => entry.includes('timestamp'))).toEqual([]);
    });

    it('warns, without failing anything, about the old init template, which cannot load', async () => {
        // What `csszyx init` wrote into a JavaScript project before the file was
        // read: TypeScript syntax that no JavaScript loader accepts.
        const root = project({ 'csszyx.config.js': INIT_TEMPLATE });

        const loaded = await loadDiagnosticPolicy(root, () =>
            Promise.reject(new SyntaxError("Unexpected token '{'")),
        );

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({ severity: 'warning', path: 'csszyx.config.js' });
        expect(loaded.problems[0]?.message).toContain('could not be loaded');
        expect(loaded.problems[0]?.message).toContain('`csszyx init` 0.17');
        expect(loaded.problems[0]?.message).toContain('nothing read');
        expect(loaded.problems[0]?.message).toContain('`defineConfig`');
        expect(loaded.problems[0]?.message).toContain("Unexpected token '{'");
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('error');
    });

    /** A Prettier-formatted copy of the template: double quotes, the same body. */
    const PRETTIER_TEMPLATE = INIT_TEMPLATE.replace("'csszyx'", '"csszyx"');
    /** The template a user annotated, re-spaced and wrote without semicolons. */
    const COMMENTED_TEMPLATE = [
        '// csszyx options — see https://csszyx.com/docs',
        '/* generated by csszyx init */',
        'import type {CsszyxConfig} from "csszyx"',
        'const config : CsszyxConfig = {',
        '  development: { debug: false, }, // was true',
        '}',
        'export default config',
        '',
    ].join('\n');

    it.each([
        ['as written', INIT_TEMPLATE],
        ['formatted by Prettier', PRETTIER_TEMPLATE],
        ['commented and re-spaced', COMMENTED_TEMPLATE],
    ])('recognises the old init template %s, which only warns', async (_label, text) => {
        const root = project({ 'csszyx.config.js': text });

        const loaded = await loadDiagnosticPolicy(root, () =>
            Promise.reject(new SyntaxError("Unexpected token '{'")),
        );

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({ severity: 'warning', fileIgnored: true });
        expect(isLegacyInitTemplate(text)).toBe(true);
    });

    it.each([
        ['one that sets diagnostics', INIT_TEMPLATE.replace('development', 'diagnostics')],
        ['one with more code', `${INIT_TEMPLATE}console.log(config);\n`],
        ['another import', INIT_TEMPLATE.replace("'csszyx'", "'csszyx/other'")],
        ['an unclosed string', "import type { CsszyxConfig } from 'csszyx"],
        ['a plain module', JS_CONFIG],
    ])('does not take %s for the old init template', (_label, text) => {
        expect(isLegacyInitTemplate(text)).toBe(false);
    });

    it('does not read a URL in a string as a comment', () => {
        const text = INIT_TEMPLATE.replace('debug: true', "docs: 'https://x.dev/diagnostics'");
        expect(isLegacyInitTemplate(text)).toBe(false);
        // Escaped quotes and template strings stay strings too.
        const escaped = INIT_TEMPLATE.replace('debug: true', "a: 'it\\'s', b: `//x`");
        expect(isLegacyInitTemplate(escaped)).toBe(true);
    });

    it.each([
        [
            'a second object around a `};`',
            INIT_TEMPLATE.replace('};\n', '};\nconst other = {\n  a: 1,\n};\n'),
        ],
        [
            'no typed declaration',
            "import type { CsszyxConfig } from 'csszyx';\nexport default {};\n",
        ],
    ])('does not take a file with %s for the old init template', (_label, text) => {
        expect(isLegacyInitTemplate(text)).toBe(false);
    });

    it('reads a comment that runs to the end of the file, closed or not', () => {
        expect(isLegacyInitTemplate(`${INIT_TEMPLATE}// end`)).toBe(true);
        expect(isLegacyInitTemplate(`${INIT_TEMPLATE}/* end`)).toBe(true);
    });

    it('does not read an over-long file as the template', () => {
        expect(isLegacyInitTemplate(INIT_TEMPLATE + ' '.repeat(70_000))).toBe(false);
    });

    it('names the line and column of the copy as the user file', async () => {
        const root = project({ 'csszyx.config.ts': JS_CONFIG });
        const error = new ReferenceError('defineConfig is not defined');
        const importModule = (url: string): Promise<unknown> => {
            error.stack = `ReferenceError: defineConfig is not defined\n    at ${url}:3:16\n    at ModuleJob.run (node:internal)`;
            return Promise.reject(error);
        };

        const loaded = await loadDiagnosticPolicy(root, importModule);

        expect(loaded.problems[0]?.message).toBe(
            'could not be loaded: defineConfig is not defined (at csszyx.config.ts:3:16)',
        );
    });

    it('names the line of a native import, without the query that busts the cache', async () => {
        const root = project({ 'csszyx.config.mjs': JS_CONFIG });
        const importModule = (url: string): Promise<unknown> =>
            Promise.reject(
                Object.assign(new Error('boom'), { stack: `Error: boom\n    at ${url}:7` }),
            );

        const loaded = await loadDiagnosticPolicy(root, importModule);

        expect(loaded.problems[0]?.message).toBe(
            'could not be loaded: boom (at csszyx.config.mjs:7)',
        );
    });

    it('writes the user file name where the reason names the copy', async () => {
        const root = project({ 'csszyx.config.ts': JS_CONFIG });
        const importModule = (url: string): Promise<unknown> =>
            Promise.reject(
                Object.assign(new Error(`Cannot find package 'x' imported from ${url.slice(7)}`), {
                    stack: undefined,
                }),
            );

        const loaded = await loadDiagnosticPolicy(root, importModule);

        expect(loaded.problems[0]?.message).toBe(
            "could not be loaded: Cannot find package 'x' imported from csszyx.config.ts",
        );
    });

    it.each([
        ['csszyx.config.js', undefined, 'csszyx.config.mts'],
        ['csszyx.config.js', 'module', 'csszyx.config.ts'],
        ['csszyx.config.mjs', undefined, 'csszyx.config.mts'],
    ])('says a %s that fails on TypeScript syntax should be renamed', async (name, type, to) => {
        const root = project({
            ...(type === undefined ? {} : { 'package.json': JSON.stringify({ type }) }),
            [name]: "const level: string = 'warn';\nexport default { diagnostics: { rules: { 'dead-class': level } } };\n",
        });

        const loaded = await loadDiagnosticPolicy(root, () =>
            Promise.reject(new SyntaxError("Unexpected token ':'")),
        );

        expect(loaded.problems[0]).toMatchObject({ severity: 'error', fileIgnored: true });
        expect(loaded.problems[0]?.message).toBe(
            `could not be loaded: Unexpected token ':'. \`${name}\` holds TypeScript syntax; rename it to \`${to}\`.`,
        );
    });

    it('suggests no rename for a file that is gone by the time it is read', async () => {
        const root = project({ 'csszyx.config.mjs': "const a: string = 'x';\n" });

        const loaded = await loadDiagnosticPolicy(root, () => {
            fs.rmSync(path.join(root, 'csszyx.config.mjs'));
            return Promise.reject(new SyntaxError("Unexpected token ':'"));
        });

        expect(loaded.problems[0]?.message).toBe("could not be loaded: Unexpected token ':'");
    });

    it('does not suggest a rename for a syntax error in plain JavaScript or a .ts file', async () => {
        const js = project({ 'csszyx.config.mjs': 'export default { diagnostics: {;\n' });
        const ts = project({ 'csszyx.config.mts': "const a: string = 'x';\nexport default {;\n" });
        const reject = () => Promise.reject(new SyntaxError("Unexpected token ';'"));

        const loads = [
            await loadDiagnosticPolicy(js, reject),
            await loadDiagnosticPolicy(ts, reject),
        ];

        expect(loads.map(loaded => loaded.problems[0]?.message)).toEqual([
            "could not be loaded: Unexpected token ';'",
            "could not be loaded: Unexpected token ';'",
        ]);
    });

    it('reports a config with no default export as an error, and keeps the defaults', async () => {
        const root = project({
            'csszyx.config.mjs': 'export const config = { diagnostics: { preset: "atomic" } };\n',
        });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems).toEqual([
            {
                severity: 'error',
                path: 'csszyx.config.mjs',
                message: 'has no default export; write `export default defineConfig({ … })`.',
                fileIgnored: true,
            },
        ]);
        expect(loaded.policy.levelOf({ rule: 'merge-covered-key' })).toBe('info');
    });

    it('keeps a file that fails to load an error unless it is the old init template', async () => {
        // No `diagnostics` in the text, but nothing marks it as the template
        // either: it is someone's config, and its levels were meant.
        const root = project({ 'csszyx.config.mjs': 'export default defineConfig({});\n' });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({
            severity: 'error',
            path: 'csszyx.config.mjs',
            fileIgnored: true,
        });
        expect(loaded.problems[0]?.message).toContain('defineConfig is not defined');
    });

    it('keeps a config it cannot even read as an error', async () => {
        const root = project({ 'csszyx.config.mjs/placeholder': '' });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems[0]).toMatchObject({ severity: 'error', path: 'csszyx.config.mjs' });
    });

    it('reports a non-Error throw by its text', async () => {
        const root = project({ 'csszyx.config.mjs': 'throw "nope";\n' });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems[0]?.message).toContain('nope');
    });

    it('passes the problems of the config it read', async () => {
        const root = project({
            'csszyx.config.mjs':
                'export default { diagnostics: { rules: { "dead-clas": "off" } } };',
        });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems.map(problem => problem.message)).toEqual([
            '`dead-clas` is not a rule id — did you mean `dead-class`?',
        ]);
    });

    it('reads a changed config again in the same process', async () => {
        const root = project({ 'csszyx.config.mjs': JS_CONFIG });
        await loadDiagnosticPolicy(root);
        fs.writeFileSync(
            path.join(root, 'csszyx.config.mjs'),
            'export default { diagnostics: { rules: { "dead-class": "off" } } };',
        );
        // A different mtime, whatever the file system's resolution.
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(path.join(root, 'csszyx.config.mjs'), later, later);

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('off');
    });
});

describe('csszyxConfigFileNameFor', () => {
    it('names a file Node reads as an ES module whatever the package type', () => {
        const esm = project({ 'package.json': '{"type":"module"}' });
        const untyped = project({ 'package.json': '{"name":"app"}' });
        const cjs = project({ 'package.json': '{"type":"commonjs"}' });
        const none = project({});

        expect(csszyxConfigFileNameFor(esm, { typescript: true })).toBe('csszyx.config.ts');
        expect(csszyxConfigFileNameFor(esm, { typescript: false })).toBe('csszyx.config.js');
        expect(csszyxConfigFileNameFor(untyped, { typescript: true })).toBe('csszyx.config.mts');
        expect(csszyxConfigFileNameFor(cjs, { typescript: false })).toBe('csszyx.config.mjs');
        expect(csszyxConfigFileNameFor(none, { typescript: true })).toBe('csszyx.config.mts');
    });

    it('treats an unreadable package.json as not an ES-module package', () => {
        const root = project({ 'package.json': '{not json' });

        expect(csszyxConfigFileNameFor(root, { typescript: false })).toBe('csszyx.config.mjs');
    });
});

describe('findCsszyxConfigFile', () => {
    it('takes the first name in order and reports the others it left unread', () => {
        const root = project({ 'csszyx.config.js': JS_CONFIG, 'csszyx.config.ts': TS_CONFIG });

        const found = findCsszyxConfigFile(root);

        expect(CSSZYX_CONFIG_FILE_NAMES[0]).toBe('csszyx.config.ts');
        expect(found).toEqual({
            file: path.join(root, 'csszyx.config.ts'),
            ignored: ['csszyx.config.js'],
        });
    });

    it('warns at load about the files it left unread', async () => {
        const root = project({ 'csszyx.config.mjs': JS_CONFIG, 'csszyx.config.mts': JS_CONFIG });

        const loaded = await loadDiagnosticPolicy(root);

        expect(loaded.problems).toEqual([
            {
                severity: 'warning',
                path: 'csszyx.config.mjs',
                message: 'not read: `csszyx.config.mts` is read first. Keep one config file.',
            },
        ]);
    });
});

describe('the policy state file the Turbopack loader reads', () => {
    it('round-trips the policy, writing only when its content changed', () => {
        const root = project({});
        const policy = createDiagnosticPolicy({ rules: { 'dead-class': 'warn' } });

        expect(writeDiagnosticPolicyState(root, policy)).toBe(true);
        expect(writeDiagnosticPolicyState(root, policy)).toBe(false);
        expect(fs.existsSync(path.join(root, '.csszyx', DIAGNOSTIC_POLICY_STATE_FILE))).toBe(true);

        expect(readDiagnosticPolicyState(root).levelOf({ rule: 'dead-class' })).toBe('warn');
    });

    it('answers the defaults for a missing, unreadable or other-format file', () => {
        const root = project({});
        expect(readDiagnosticPolicyState(root).levelOf({ rule: 'dead-class' })).toBe('error');

        fs.mkdirSync(path.join(root, '.csszyx'));
        const file = path.join(root, '.csszyx', DIAGNOSTIC_POLICY_STATE_FILE);
        fs.writeFileSync(file, '{not json');
        expect(readDiagnosticPolicyState(root).levelOf({ rule: 'dead-class' })).toBe('error');

        fs.writeFileSync(
            file,
            JSON.stringify({ format: 999, config: { rules: { 'dead-class': 'off' } } }),
        );
        expect(readDiagnosticPolicyState(root).levelOf({ rule: 'dead-class' })).toBe('error');
    });
});
