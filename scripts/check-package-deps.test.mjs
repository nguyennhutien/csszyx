// Unit tests for the declared-dependency gate. The gate itself runs against
// the built packages in `scripts/build-tests/package-deps.test.mjs`.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { checkAll, compare, importedPackages, packageOf } from './check-package-deps.mjs';

describe('packageOf', () => {
    it('names the package of a bare specifier, scoped or not, with or without a subpath', () => {
        assert.equal(packageOf('postcss'), 'postcss');
        assert.equal(packageOf('postcss/lib/parser'), 'postcss');
        assert.equal(packageOf('@csszyx/compiler'), '@csszyx/compiler');
        assert.equal(packageOf('@csszyx/compiler/browser'), '@csszyx/compiler');
    });

    it('answers null for paths, schemes, subpath imports and built-ins', () => {
        for (const specifier of [
            './a.js',
            '../b',
            '/abs',
            '#internal',
            'node:fs',
            'virtual:x',
            'fs',
            'path/posix',
        ]) {
            assert.equal(packageOf(specifier), null, specifier);
        }
    });
});

describe('importedPackages', () => {
    it('reads static, dynamic, re-export, require, require.resolve and type references', () => {
        const source = [
            '/// <reference types="@scope/types/jsx" />',
            "import a from 'static-dep';",
            "export { b } from 'reexport-dep/sub';",
            "const c = await import('dynamic-dep');",
            "const d = require('cjs-dep');",
            "const e = require.resolve('resolved-dep/package.json');",
            "type F = import('type-dep').F;",
            "import './local.js';",
            "import 'node:fs';",
        ].join('\n');
        assert.deepEqual([...importedPackages(source)].sort(), [
            '@scope/types',
            'cjs-dep',
            'dynamic-dep',
            'reexport-dep',
            'resolved-dep',
            'static-dep',
            'type-dep',
        ]);
    });

    it('skips specifiers inside comments and string contents', () => {
        const source = [
            "// import x from 'in-comment';",
            '/** @example import { y } from "in-doc"; */',
            "const code = `import z from 'in-template';`;",
            'const text = "import w from \'in-string\'";',
        ].join('\n');
        assert.deepEqual([...importedPackages(source)], []);
    });
});

describe('compare', () => {
    const base = {
        name: 'pkg',
        declared: { used: 'dependencies' },
        imports: new Map([['used', ['a.mjs']]]),
    };

    it('passes a package whose declarations match its imports, its own name included', () => {
        assert.deepEqual(
            compare({ ...base, imports: new Map([...base.imports, ['pkg', ['a.mjs']]]) }),
            [],
        );
    });

    it('reports an undeclared import with the file that makes it', () => {
        assert.deepEqual(
            compare({ ...base, imports: new Map([...base.imports, ['ghost', ['b.mjs']]]) }),
            ['pkg: imports `ghost` (b.mjs) but does not declare it'],
        );
    });

    it('reports a declared dependency nothing imports, in the field that declares it', () => {
        assert.deepEqual(
            compare({ ...base, declared: { ...base.declared, idle: 'peerDependencies' } }),
            ['pkg: declares `idle` in peerDependencies but no shipped file imports it'],
        );
    });

    it('accepts a required peer of a dependency and its own platform binding', () => {
        const declared = {
            ...base.declared,
            peer: 'dependencies',
            'pkg-linux-x64': 'optionalDependencies',
        };
        assert.deepEqual(compare({ ...base, declared, peersOfDeps: new Set(['peer']) }), []);
    });

    it('does not take a binding-shaped name outside optionalDependencies', () => {
        const declared = { ...base.declared, 'pkg-linux-x64': 'dependencies' };
        assert.equal(compare({ ...base, declared }).length, 1);
    });

    it('honours the allowlists and reports their stale entries', () => {
        assert.deepEqual(
            compare({
                ...base,
                declared: { ...base.declared, kept: 'peerDependencies' },
                imports: new Map([...base.imports, ['types-only', ['c.d.mts']]]),
                unimported: { kept: 'reason' },
                undeclared: { 'types-only': 'reason' },
            }),
            [],
        );
        assert.deepEqual(
            compare({
                ...base,
                unimported: { used: 'r', missing: 'r' },
                undeclared: { used: 'r', gone: 'r' },
            }),
            [
                'pkg: EXPECTED_UNIMPORTED entry `used` is stale',
                'pkg: EXPECTED_UNIMPORTED entry `missing` is stale',
                'pkg: EXPECTED_UNDECLARED entry `used` is stale',
                'pkg: EXPECTED_UNDECLARED entry `gone` is stale',
            ],
        );
    });
});

describe('checkAll', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'package-deps-'));
    after(() => rmSync(root, { recursive: true, force: true }));

    /**
     * Write a file under the fixture root.
     *
     * @param {string} file - Path relative to the root.
     * @param {string | object} content - Text, or an object written as JSON.
     */
    const write = (file, content) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(
            path.join(root, file),
            typeof content === 'string' ? content : JSON.stringify(content),
        );
    };

    write('packages/clean/package.json', {
        name: '@fixture/clean',
        files: ['dist'],
        dependencies: { 'with-peer': '1', 'the-peer': '1', idle: '1' },
    });
    write('packages/clean/dist/index.mjs', "import 'with-peer';\nimport 'phantom';");
    write('packages/clean/dist/index.mjs.map', "import 'map-only';");
    write('packages/clean/node_modules/with-peer/package.json', {
        peerDependencies: { 'the-peer': '1', optional: '1' },
        peerDependenciesMeta: { optional: { optional: true } },
    });
    write('packages/source/package.json', {
        name: '@fixture/source',
        peerDependencies: { react: '1' },
    });
    write('packages/source/src/index.ts', "import 'react';");
    write('packages/source/tests/a.test.ts', "import 'vitest';");
    write('packages/source/vitest.config.ts', "import 'vitest/config';");
    write('packages/unbuilt/package.json', {
        name: '@fixture/unbuilt',
        files: ['dist', 'README.md'],
    });
    write('packages/binary/package.json', { name: '@fixture/binary', files: ['binary.node'] });
    write('packages/private/package.json', { name: '@fixture/private', private: true });
    write('packages/not-a-package/README.md', 'no manifest');

    it('reads shipped files only and reports each problem', () => {
        const { problems, checked } = checkAll(root);
        assert.equal(checked, 3);
        assert.deepEqual(problems.slice(0, 3), [
            '@fixture/clean: imports `phantom` (dist/index.mjs) but does not declare it',
            '@fixture/clean: declares `idle` in dependencies but no shipped file imports it',
            '@fixture/unbuilt: ships no module files; build it first',
        ]);
    });

    it('reports an allowlist entry naming a package that is not here', () => {
        const { problems } = checkAll(root, {
            unimported: { '@csszyx/gone': { a: 'reason' } },
            undeclared: { '@csszyx/also-gone': { b: 'reason' } },
        });
        assert.deepEqual(problems.slice(3), [
            'an allowlist names `@csszyx/gone`, which is not a published package here',
            'an allowlist names `@csszyx/also-gone`, which is not a published package here',
        ]);
    });
});
