/**
 * Each rule of `check-engine-boundary.mjs` on a repository built in a
 * temporary directory, so a rule is seen failing as well as passing.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    checkCompilerSubpaths,
    checkEngineDeclarations,
    checkInstallClosure,
} from './check-engine-boundary.mjs';
import { loadsOf } from './check-package-deps.mjs';

/**
 * A repository holding the given files.
 *
 * @param {Record<string, string | object>} files - Path → contents (objects become JSON).
 * @param {(root: string) => void} body - What to run against it.
 */
function withRepository(files, body) {
    const root = mkdtempSync(path.join(tmpdir(), 'csszyx-engine-boundary-'));
    try {
        for (const [file, contents] of Object.entries(files)) {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            writeFileSync(
                path.join(root, file),
                typeof contents === 'string' ? contents : JSON.stringify(contents),
            );
        }
        body(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const compiler = (exports, dist) => ({
    'packages/compiler/package.json': { name: '@csszyx/compiler', exports },
    ...Object.fromEntries(Object.entries(dist).map(([f, s]) => [`packages/compiler/${f}`, s])),
});

test('loadsOf reads imports, aliased requires, peer requests and csszyx literals', () => {
    const { specifiers, computed } = loadsOf(
        [
            "import a from 'a';",
            "const requireHere = createRequire(import.meta.url); requireHere('b');",
            "requireFromHere('@csszyx/core/parser-wasm');",
            "requirePeer({ request: 'vue/compiler-sfc' });",
        ].join('\n'),
    );
    assert.deepEqual(specifiers.sort(), ['@csszyx/core/parser-wasm', 'a', 'b', 'vue/compiler-sfc']);
    assert.equal(computed, true);
    assert.equal(loadsOf("import x from './x.js';").computed, false);
});

test('the root and a browser subpath may not reach the engine; an engine subpath may', () => {
    withRepository(
        compiler(
            { '.': './dist/index.mjs', './browser': './dist/b.mjs', './engine': './dist/e.mjs' },
            {
                'dist/index.mjs': "export * from './shared.mjs';",
                'dist/shared.mjs': "import '@csszyx/core/native';",
                'dist/b.mjs': "import 'node:fs'; import(name);",
                'dist/e.mjs': "import '@csszyx/core/native';",
            },
        ),
        root => {
            const { problems, engineSubpaths } = checkCompilerSubpaths(root);
            assert.deepEqual([...engineSubpaths].sort(), ['.', './engine']);
            assert.deepEqual(problems, [
                '@csszyx/compiler . reaches the engine: dist/shared.mjs loads `@csszyx/core/native`',
                '@csszyx/compiler ./browser is not browser-pure: dist/b.mjs loads `node:fs`',
                '@csszyx/compiler ./browser loads a module by a computed name in dist/b.mjs',
            ]);
        },
    );
});

test('names a missing build', () => {
    withRepository(compiler({ './browser': './dist/b.mjs' }, {}), root => {
        assert.deepEqual(checkCompilerSubpaths(root).problems, [
            '@csszyx/compiler: ./browser resolves to missing ./dist/b.mjs; build it first',
        ]);
    });
});

test('a package importing an engine subpath declares the engine', () => {
    withRepository(
        {
            'packages/a/package.json': { name: 'a', files: ['dist'] },
            'packages/a/dist/index.mjs':
                "import { transformSource } from '@csszyx/compiler/engine';",
            'packages/b/package.json': {
                name: 'b',
                files: ['dist'],
                dependencies: { '@csszyx/core': '*' },
            },
            'packages/b/dist/index.mjs': "import '@csszyx/compiler/engine';",
            'packages/c/package.json': { name: 'c', files: ['dist'] },
            'packages/c/dist/index.mjs': "import '@csszyx/compiler/browser';",
            'packages/c/dist/tests/x.mjs': "import '@csszyx/compiler/engine';",
        },
        root => {
            assert.deepEqual(checkEngineDeclarations(root, new Set(['./engine'])), [
                'a: dist/index.mjs imports `@csszyx/compiler/engine`, which runs the engine, but a does not declare @csszyx/core',
            ]);
        },
    );
});

test('the browser packages install no engine, through dependencies or required peers', () => {
    withRepository(
        {
            'packages/runtime/package.json': {
                name: '@csszyx/runtime',
                dependencies: { mid: '1' },
            },
            'packages/mid/package.json': { name: 'mid', peerDependencies: { '@csszyx/core': '1' } },
            'packages/dynamic/package.json': {
                name: '@csszyx/dynamic',
                peerDependencies: { '@csszyx/core': '1' },
                peerDependenciesMeta: { '@csszyx/core': { optional: true } },
            },
            'packages/types/package.json': {
                name: '@csszyx/types',
                optionalDependencies: { '@csszyx/core-linux-x64-gnu': '1' },
            },
        },
        root => {
            assert.deepEqual(checkInstallClosure(root), [
                '@csszyx/runtime installs the engine: @csszyx/runtime → mid → @csszyx/core',
                '@csszyx/types installs the engine: @csszyx/types → @csszyx/core-linux-x64-gnu',
            ]);
        },
    );
});
