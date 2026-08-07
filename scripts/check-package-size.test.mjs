import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
    checkBudgets,
    gzipTotalBytes,
    isRuntimeArtifact,
    listExportEntries,
    resolveEntryClosure,
    SIZE_BUDGETS,
} from './check-package-size.mjs';

/** Create a throwaway directory tree from a { relativePath: content } map.
 * @param {Record<string, string>} files relative path → file content
 * @returns {string} absolute fixture root
 */
function makeFixture(files) {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pkg-size-'));
    for (const [relative, content] of Object.entries(files)) {
        const absolute = path.join(root, relative);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
    }
    return root;
}

test('counts runtime JS and skips declarations, maps, and build metadata', () => {
    assert.equal(isRuntimeArtifact('dist/index.mjs'), true);
    assert.equal(isRuntimeArtifact('dist/index.cjs'), true);
    assert.equal(isRuntimeArtifact('dist/shared/chunk.ABC123.js'), true);
    assert.equal(isRuntimeArtifact('dist/index.d.mts'), false);
    assert.equal(isRuntimeArtifact('dist/index.d.cts'), false);
    assert.equal(isRuntimeArtifact('dist/index.d.ts'), false);
    assert.equal(isRuntimeArtifact('dist/index.js.map'), false);
    assert.equal(isRuntimeArtifact('dist/tsconfig.tsbuildinfo'), false);
    assert.equal(isRuntimeArtifact('dist/styles.css'), false);
});

test('export entries come from the import condition and skip non-runtime targets', () => {
    const root = makeFixture({
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: {
                '.': {
                    import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
                    require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
                },
                './react': { import: { default: './dist/react.mjs' } },
                './flat': './dist/flat.mjs',
                './package.json': './package.json',
            },
        }),
    });
    try {
        assert.deepEqual(listExportEntries(path.join(root, 'packages/thing')), [
            path.join(root, 'packages/thing/dist/flat.mjs'),
            path.join(root, 'packages/thing/dist/index.mjs'),
            path.join(root, 'packages/thing/dist/react.mjs'),
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('entry closure follows relative imports and ignores package imports', () => {
    const root = makeFixture({
        'dist/entry.mjs': "import '@csszyx/compiler';\nexport { b } from './shared/chunk.mjs';\n",
        'dist/shared/chunk.mjs': "import './leaf.mjs';\nexport const b = 2;\n",
        'dist/shared/leaf.mjs': 'export const c = 3;\n',
        'dist/unrelated.mjs': 'export const d = 4;\n',
    });
    try {
        assert.deepEqual(resolveEntryClosure(path.join(root, 'dist/entry.mjs')), [
            path.join(root, 'dist/entry.mjs'),
            path.join(root, 'dist/shared/chunk.mjs'),
            path.join(root, 'dist/shared/leaf.mjs'),
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('entry closure fails loudly on a broken relative import', () => {
    const root = makeFixture({
        'dist/entry.mjs': "export { b } from './missing-chunk.mjs';\n",
    });
    try {
        assert.throws(
            () => resolveEntryClosure(path.join(root, 'dist/entry.mjs')),
            /missing-chunk\.mjs/,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('gzip total matches an independent gzip of each file', () => {
    const contentA = 'export const a = 1;\n'.repeat(50);
    const contentB = 'export const b = 2;\n'.repeat(80);
    const root = makeFixture({ 'a.mjs': contentA, 'b.mjs': contentB });
    try {
        const expected =
            gzipSync(Buffer.from(contentA), { level: 9 }).length +
            gzipSync(Buffer.from(contentB), { level: 9 }).length;
        assert.equal(
            gzipTotalBytes([path.join(root, 'a.mjs'), path.join(root, 'b.mjs')]),
            expected,
        );
        assert.equal(gzipTotalBytes([]), 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A minimal publishable package fixture: two export entries sharing a chunk,
 * plus a fat unimported `.js` beside them standing in for the per-module
 * files `tsc -b` emits into the same dist. The budget must count the entry
 * closures and ignore the dropping.
 * @param {string} filler content for the unimported file
 * @returns {Record<string, string>} fixture file map
 */
function packageFixture(filler) {
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: {
                '.': { import: { default: './dist/index.mjs' } },
                './react': { import: { default: './dist/react.mjs' } },
            },
        }),
        'packages/thing/dist/index.mjs': "export { s } from './shared/chunk.mjs';\n",
        'packages/thing/dist/react.mjs': "export { s } from './shared/chunk.mjs';\n",
        'packages/thing/dist/shared/chunk.mjs': 'export const s = 1;\n'.repeat(40),
        'packages/thing/dist/index.js': filler,
    };
}

test('package-exports budgets measure entry closures, not tsc droppings', () => {
    const root = makeFixture(packageFixture('export const dropping = 0;\n'.repeat(10_000)));
    try {
        const { results, failures } = checkBudgets(
            [
                {
                    name: 'thing exports',
                    kind: 'package-exports',
                    target: 'packages/thing',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(failures.length, 0);
        assert.equal(results.length, 1);
        assert.equal(results[0].ok, true);
        // index.mjs + react.mjs + the shared chunk once — never index.js.
        assert.equal(results[0].files.length, 3);
        assert.ok(results[0].gzipBytes > 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('budgets fail over the limit with the raise-and-explain message', () => {
    const root = makeFixture(packageFixture(''));
    try {
        const { results, failures } = checkBudgets(
            [
                {
                    name: 'thing exports',
                    kind: 'package-exports',
                    target: 'packages/thing',
                    maxGzipBytes: 8,
                },
            ],
            root,
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0], /thing exports/);
        assert.match(failures[0], /raise the/);
        assert.equal(results[0].ok, false);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a missing package or empty exports fails instead of passing silently', () => {
    const root = makeFixture({
        'packages/typesonly/package.json': JSON.stringify({
            name: 'typesonly',
            exports: { '.': { import: { types: './dist/index.d.mts' } } },
        }),
    });
    try {
        const missing = checkBudgets(
            [
                {
                    name: 'absent package',
                    kind: 'package-exports',
                    target: 'packages/absent',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(missing.failures.length, 1);
        assert.match(missing.failures[0], /absent/);

        const empty = checkBudgets(
            [
                {
                    name: 'typesonly package',
                    kind: 'package-exports',
                    target: 'packages/typesonly',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(empty.failures.length, 1);
        assert.match(empty.failures[0], /typesonly/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('entry-closure budgets measure a single entry graph', () => {
    const root = makeFixture({
        'packages/thing/dist/entry.mjs': "export { b } from './chunk.mjs';\n",
        'packages/thing/dist/chunk.mjs': 'export const b = 2;\n',
        'packages/thing/dist/heavy.mjs': 'export const h = 0;\n'.repeat(10_000),
    });
    try {
        const closureOnly = checkBudgets(
            [
                {
                    name: 'thing browser entry',
                    kind: 'entry-closure',
                    target: 'packages/thing/dist/entry.mjs',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(closureOnly.failures.length, 0);
        assert.equal(closureOnly.results[0].files.length, 2);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('committed budgets cover the three user-shipped surfaces', () => {
    const names = SIZE_BUDGETS.map(budget => budget.name);
    assert.equal(new Set(names).size, SIZE_BUDGETS.length, 'budget names must be unique');
    assert.equal(SIZE_BUDGETS.length, 3);
    for (const budget of SIZE_BUDGETS) {
        assert.ok(['package-exports', 'entry-closure'].includes(budget.kind));
        assert.ok(Number.isInteger(budget.maxGzipBytes) && budget.maxGzipBytes > 0);
        assert.ok(!path.isAbsolute(budget.target), 'targets are repo-relative');
    }
});
