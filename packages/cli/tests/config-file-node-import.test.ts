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

/**
 * Load a project's config in a child Node and answer what it read.
 *
 * @param root - The project root.
 * @returns The dead-class level, the problems, and the child's stderr.
 */
function loadInNode(root: string): { level: string; problems: unknown[]; stderr: string } {
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

describe('csszyx.config under plain Node', () => {
    it.each([
        ['module', 'csszyx.config.ts', TS_CONFIG],
        ['commonjs', 'csszyx.config.ts', TS_CONFIG],
        [undefined, 'csszyx.config.ts', TS_CONFIG],
        ['commonjs', 'csszyx.config.mts', TS_CONFIG],
        ['commonjs', 'csszyx.config.js', JS_CONFIG],
        ['commonjs', 'csszyx.config.mjs', JS_CONFIG],
    ])('reads a %s-typed %s', (type, name, text) => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-node-config-')));
        dirs.push(root);
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(type === undefined ? { name: 'app' } : { name: 'app', type }),
        );
        writeFileSync(join(root, name), text);

        const loaded = loadInNode(root);

        expect(loaded.problems).toEqual([]);
        expect(loaded.level).toBe('warn');
    });
});
