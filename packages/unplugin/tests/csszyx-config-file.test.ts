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

import { afterEach, describe, expect, it } from 'vitest';

import {
    CSSZYX_CONFIG_FILE_NAMES,
    DIAGNOSTIC_POLICY_STATE_FILE,
    findCsszyxConfigFile,
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
});

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

    it('does not retry an .mjs config, which Node never reads as CommonJS', async () => {
        const root = project({ 'csszyx.config.mjs': JS_CONFIG });

        const loaded = await loadDiagnosticPolicy(root, commonJsNode);

        expect(loaded.problems[0]?.message).toContain('Cannot use import statement');
    });

    it('does not retry a failure that is not a syntax error', async () => {
        const root = project({ 'csszyx.config.ts': JS_CONFIG });

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

    it('warns, without failing anything, about a file that cannot load and sets no diagnostics', async () => {
        // What `csszyx init` wrote into a JavaScript project before the file was
        // read: TypeScript syntax that no JavaScript loader accepts.
        const root = project({ 'csszyx.config.js': INIT_TEMPLATE });

        const loaded = await loadDiagnosticPolicy(root, () =>
            Promise.reject(new SyntaxError("Unexpected token '{'")),
        );

        expect(loaded.problems).toHaveLength(1);
        expect(loaded.problems[0]).toMatchObject({ severity: 'warning', path: 'csszyx.config.js' });
        expect(loaded.problems[0]?.message).toContain('could not be loaded');
        expect(loaded.problems[0]?.message).toContain('sets no `diagnostics`');
        expect(loaded.problems[0]?.message).toContain('`csszyx init`');
        expect(loaded.problems[0]?.message).toContain('`defineConfig`');
        expect(loaded.problems[0]?.message).toContain("Unexpected token '{'");
        expect(loaded.policy.levelOf({ rule: 'dead-class' })).toBe('error');
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
