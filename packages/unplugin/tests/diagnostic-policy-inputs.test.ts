/**
 * The files a `csszyx.config` load reads, recorded with the policy so the
 * lanes that read `.csszyx/diagnostic-policy.json` see an edit to any of them.
 *
 * The list is read statically, from the config's text and the text of every
 * relative module it imports: Node resolves a relative ES import exactly as
 * written, so the scan only has to find the specifiers. Reading a specifier
 * that is not there costs a needless reload; missing one keeps old levels, so
 * the scan leans to finding too many.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    configImportGraph,
    diagnosticPolicyInputs,
    diagnosticPolicyInputsCurrent,
    diagnosticPolicyInputsUnchanged,
    diagnosticPolicyWatchFiles,
} from '../src/diagnostic-policy-inputs.js';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write files under a fresh temporary root.
 *
 * @param files - Paths relative to it, with their content.
 * @returns The root.
 */
function project(files: Record<string, string>): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'csszyx-policy-inputs-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    }
    return root;
}

/**
 * The import graph of a root's `csszyx.config.mjs`, relative to the root.
 *
 * @param root - The root.
 * @param name - The config's file name.
 * @returns Posix paths, the config first.
 */
function graph(root: string, name = 'csszyx.config.mjs'): string[] {
    return configImportGraph(join(root, name)).map(file =>
        relative(root, file).split(sep).join('/'),
    );
}

describe('the modules a config imports', () => {
    it('follows every relative import, transitively, each once', () => {
        const root = project({
            'csszyx.config.mjs': [
                "import levels from './config/levels.mjs';",
                'import { preset } from "./config/preset.ts";',
                "export * from './config/reexport.js';",
                "import './config/side-effect.mjs';",
                "const lazy = await import('./config/lazy.mjs');",
                "const cjs = require('./config/cjs.cjs');",
                "import shared from '../outside/shared.mjs';",
                'export default { diagnostics: { rules: levels } };',
            ].join('\n'),
            'config/levels.mjs':
                "import './nested.mjs';\nimport '../csszyx.config.mjs';\nexport default {};\n",
            'config/nested.mjs': "import './levels.mjs';\n",
            'config/preset.ts': 'export const preset = "atomic";\n',
            'config/reexport.js': '',
            'config/side-effect.mjs': '',
            'config/lazy.mjs': '',
            'config/cjs.cjs': '',
        });
        expect(graph(root)).toEqual([
            'csszyx.config.mjs',
            'config/levels.mjs',
            'config/preset.ts',
            'config/reexport.js',
            'config/side-effect.mjs',
            'config/lazy.mjs',
            'config/cjs.cjs',
            'config/nested.mjs',
        ]);
    });

    it('leaves a package, a missing file and a URL out', () => {
        const root = project({
            'csszyx.config.ts': [
                "import { defineConfig } from 'csszyx';",
                "import gone from './gone.mjs';",
                "import data from 'file:///etc/hostname';",
                'export default defineConfig({});',
            ].join('\n'),
        });
        expect(graph(root, 'csszyx.config.ts')).toEqual(['csszyx.config.ts']);
    });

    it('resolves a specifier without its extension or to a folder index, and reads no JSON', () => {
        const root = project({
            'csszyx.config.js':
                "import a from './a';\nimport b from './b';\nimport c from './c.json' with { type: 'json' };\nimport d from './d.mjs?v=1';\n",
            'a.ts': "import './never-scanned-from-json';\n",
            'b/index.mjs': '',
            'c.json': '{ "x": "import \'./from-json.mjs\'" }',
            'from-json.mjs': '',
            'd.mjs': '',
        });
        expect(graph(root, 'csszyx.config.js')).toEqual([
            'csszyx.config.js',
            'a.ts',
            'b/index.mjs',
            'c.json',
            'd.mjs',
        ]);
    });

    it('stops reading after a config pulls in more files than any config should', () => {
        const files: Record<string, string> = {
            'csszyx.config.mjs': Array.from(
                { length: 300 },
                (_, n) => `import './m${n}.mjs';`,
            ).join('\n'),
        };
        for (let n = 0; n < 300; n++) files[`m${n}.mjs`] = '';
        expect(graph(project(files))).toHaveLength(256);
    });

    it('reads a file it cannot open as having no imports', () => {
        const root = project({ 'csszyx.config.mjs': "import './dir.mjs';\n", 'dir.mjs/x': '' });
        expect(graph(root)).toEqual(['csszyx.config.mjs']);
        // A folder under the config's own name is found, and read as nothing.
        const folder = project({ 'csszyx.config.mjs/x': "import '../a.mjs';\n", 'a.mjs': '' });
        expect(graph(folder)).toEqual(['csszyx.config.mjs']);
    });
});

describe('the inputs recorded with a policy', () => {
    it('are the config and its modules, by path, time and size', () => {
        const root = project({
            'csszyx.config.mjs': "import './levels.mjs';\n",
            'levels.mjs': 'export default {};\n',
        });
        const inputs = diagnosticPolicyInputs(root);
        expect(inputs.map(input => input.file)).toEqual(['csszyx.config.mjs', 'levels.mjs']);
        expect(inputs[1]?.size).toBe('export default {};\n'.length);
        expect(diagnosticPolicyInputs(project({}))).toEqual([]);
    });

    it('read as unchanged until one of them is edited, moved or removed', () => {
        const root = project({
            'csszyx.config.mjs': "import './levels.mjs';\n",
            'levels.mjs': 'export default {};\n',
        });
        const inputs = diagnosticPolicyInputs(root);
        expect(diagnosticPolicyInputsUnchanged(root, inputs)).toBe(true);
        // Same size, a later time: an edit that kept the length.
        const later = new Date(Date.now() + 60_000);
        utimesSync(join(root, 'levels.mjs'), later, later);
        expect(diagnosticPolicyInputsUnchanged(root, inputs)).toBe(false);
        writeFileSync(join(root, 'levels.mjs'), 'export default { a: 1 };\n');
        expect(diagnosticPolicyInputsUnchanged(root, diagnosticPolicyInputs(root))).toBe(true);
        rmSync(join(root, 'levels.mjs'));
        expect(diagnosticPolicyInputsUnchanged(root, inputs)).toBe(false);
    });
});

describe('an import that names no file yet', () => {
    it('is recorded as missing, watched, and read as a change once the file appears', () => {
        const root = project({
            'csszyx.config.mjs': "import levels from './later.mjs';\nexport default {};\n",
        });
        const inputs = diagnosticPolicyInputs(root);
        expect(inputs).toEqual([
            expect.objectContaining({ file: 'csszyx.config.mjs' }),
            { file: 'later.mjs', mtimeMs: 0, size: 0, missing: true },
        ]);
        expect(diagnosticPolicyWatchFiles(root, inputs)).toContain(join(root, 'later.mjs'));
        expect(diagnosticPolicyInputsCurrent(root, inputs)).toBe(true);
        writeFileSync(join(root, 'later.mjs'), 'export default {};\n');
        expect(diagnosticPolicyInputsCurrent(root, inputs)).toBe(false);
    });

    it('is recorded under every name it could resolve to when written without an extension', () => {
        const root = project({ 'csszyx.config.mjs': "import levels from './levels';\n" });
        const missing = diagnosticPolicyInputs(root).filter(input => input.missing === true);
        expect(missing.map(input => input.file)).toEqual([
            'levels',
            'levels.ts',
            'levels.mts',
            'levels.cts',
            'levels.js',
            'levels.mjs',
            'levels.cjs',
            'levels.json',
            'levels/index.ts',
            'levels/index.mts',
            'levels/index.cts',
            'levels/index.js',
            'levels/index.mjs',
            'levels/index.cjs',
        ]);
        mkdirSync(join(root, 'levels'));
        writeFileSync(join(root, 'levels/index.ts'), 'export default {};\n');
        expect(diagnosticPolicyInputsCurrent(root, diagnosticPolicyInputs(root))).toBe(true);
        expect(diagnosticPolicyInputs(root).some(input => input.file === 'levels/index.ts')).toBe(
            true,
        );
    });

    it('reads a module the config imports as gone once it is deleted, and back once it returns', () => {
        const root = project({
            'csszyx.config.mjs': "import './levels.mjs';\n",
            'levels.mjs': 'export default {};\n',
        });
        const before = diagnosticPolicyInputs(root);
        rmSync(join(root, 'levels.mjs'));
        expect(diagnosticPolicyInputsCurrent(root, before)).toBe(false);
        const gone = diagnosticPolicyInputs(root);
        expect(gone[1]).toEqual({ file: 'levels.mjs', mtimeMs: 0, size: 0, missing: true });
        expect(diagnosticPolicyInputsCurrent(root, gone)).toBe(true);
        writeFileSync(join(root, 'levels.mjs'), 'export default {};\n');
        expect(diagnosticPolicyInputsCurrent(root, gone)).toBe(false);
    });
});
