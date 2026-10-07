import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
    appBundle,
    checkBudgets,
    gzipTotalBytes,
    isRuntimeArtifact,
    listExportEntries,
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

/** Development-only text that does not compress to nothing. */
const DEV_TEXT = Array.from({ length: 120 }, (_, i) => `dev-note-${i * 7919}`).join(' ');

/** A publishable package whose one function carries a development-only
 * warning. With `dev` false the same package without that block — the two must
 * measure the same once bundled for production.
 * @param {string} name package directory name
 * @param {boolean} dev whether the development warning is present
 * @returns {Record<string, string>} fixture file map
 */
function appPackage(name, dev) {
    const warning = dev
        ? `if (process.env.NODE_ENV !== 'production') console.warn('${DEV_TEXT}');`
        : '';
    return {
        [`packages/${name}/package.json`]: JSON.stringify({
            name,
            exports: {
                '.': { import: { default: './dist/index.mjs' } },
                './heavy': { import: { default: './dist/heavy.mjs' } },
            },
        }),
        [`packages/${name}/dist/index.mjs`]:
            "import { other } from '@csszyx/other';\n" +
            `export function size(x) { ${warning} return other(x) + 1; }\n`,
        [`packages/${name}/dist/heavy.mjs`]: `export const table = ${JSON.stringify(
            Array.from({ length: 400 }, (_, i) => `entry-${i}`),
        )};\n`,
    };
}

/** One app-bundle budget over a fixture package.
 * @param {string} name package directory name
 * @param {Partial<typeof SIZE_BUDGETS[number]>} [extra] extra budget fields
 * @returns {typeof SIZE_BUDGETS} a one-entry budget list
 */
function appBudget(name, extra = {}) {
    return [
        {
            name: `${name} app`,
            kind: 'app-bundle',
            target: `packages/${name}`,
            maxGzipBytes: 100_000,
            ...extra,
        },
    ];
}

test('app bundles measure what a production app ships, not the package text', () => {
    // Same package name in two roots, so the two builds differ only by the warning.
    const withDevRoot = makeFixture(appPackage('thing', true));
    const noDevRoot = makeFixture(appPackage('thing', false));
    try {
        const withDev = checkBudgets(appBudget('thing'), withDevRoot);
        const noDev = checkBudgets(appBudget('thing'), noDevRoot);
        assert.deepEqual([withDev.failures, noDev.failures], [[], []]);
        // The warning is gone from what ships, so the two measure alike: the
        // minifier names identifiers per build, which moves gzip by a byte or
        // two, while the warning alone gzips to several hundred.
        const bundle = appBundle(
            withDev.results[0].files,
            path.join(withDevRoot, 'packages/thing'),
        );
        assert.ok(!bundle.includes('dev-note'), 'the development warning shipped');
        const gap = Math.abs(withDev.results[0].gzipBytes - noDev.results[0].gzipBytes);
        assert.ok(gap <= 8, `gzip differs by ${gap}`);
        assert.ok(gzipSync(DEV_TEXT, { level: 9 }).length > 300);
    } finally {
        rmSync(withDevRoot, { recursive: true, force: true });
        rmSync(noDevRoot, { recursive: true, force: true });
    }
});

test('app bundles leave the other csszyx packages to their own budgets', () => {
    const root = makeFixture(appPackage('thing', false));
    try {
        // `@csszyx/other` does not exist; bundling it in would fail the build.
        const { failures, results } = checkBudgets(appBudget('thing'), root);
        assert.deepEqual(failures, []);
        assert.equal(results[0].files.length, 2);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('app bundles leave peer dependencies to the app that already has them', () => {
    const root = makeFixture({
        ...appPackage('thing', false),
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            peerDependencies: { 'peer-lib': '>=1' },
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/thing/dist/index.mjs': "export { peer } from 'peer-lib';\n",
    });
    try {
        // `peer-lib` is not installed; bundling it in would fail the build.
        assert.deepEqual(checkBudgets(appBudget('thing'), root).failures, []);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A package whose production bundle prints one integrity error and one
 * usage nudge that forgot to fold.
 * @returns {Record<string, string>} fixture file map
 */
function messagesPackage() {
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/thing/dist/index.mjs':
            "export function check(ok, m) { if (!ok) console.error('[thing] checksum mismatch'); " +
            "if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return; " +
            'console.warn(`[thing] prefer ${m}`); }\n',
    };
}

test('a production bundle may print only the messages its budget lists', () => {
    const root = makeFixture(messagesPackage());
    try {
        const listed = ['error: [thing] checksum mismatch', 'warn: [thing] prefer '];
        assert.deepEqual(
            checkBudgets(appBudget('thing', { productionMessages: listed }), root).failures,
            [],
        );

        const unlisted = checkBudgets(
            appBudget('thing', { productionMessages: ['error: [thing] checksum mismatch'] }),
            root,
        ).failures;
        assert.equal(unlisted.length, 1);
        assert.match(unlisted[0], /prints "warn: \[thing\] prefer "/);

        const stale = checkBudgets(
            appBudget('thing', { productionMessages: [...listed, 'warn: [thing] gone'] }),
            root,
        ).failures;
        assert.equal(stale.length, 1);
        assert.match(stale[0], /no longer prints "warn: \[thing\] gone"/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a subpath list measures only those entries', () => {
    const root = makeFixture(appPackage('thing', false));
    try {
        const all = checkBudgets(appBudget('thing'), root).results[0];
        const one = checkBudgets(appBudget('thing', { subpaths: ['.'] }), root).results[0];
        assert.equal(one.files.length, 1);
        assert.ok(one.gzipBytes < all.gzipBytes, `${one.gzipBytes} < ${all.gzipBytes}`);
        const unknown = checkBudgets(appBudget('thing', { subpaths: ['./nope'] }), root);
        assert.equal(unknown.failures.length, 1);
        assert.match(unknown.failures[0], /\.\/nope/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('an app bundle that cannot be built fails instead of passing silently', () => {
    const root = makeFixture({
        ...appPackage('thing', false),
        'packages/thing/dist/index.mjs': "export { gone } from './missing.mjs';\n",
    });
    try {
        const { failures } = checkBudgets(appBudget('thing'), root);
        assert.equal(failures.length, 1);
        assert.match(failures[0], /missing\.mjs/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('budgets fail over the limit with the raise-and-explain message', () => {
    const root = makeFixture(appPackage('thing', false));
    try {
        const { results, failures } = checkBudgets(appBudget('thing', { maxGzipBytes: 8 }), root);
        assert.equal(failures.length, 1);
        assert.match(failures[0], /thing app/);
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
        const missing = checkBudgets(appBudget('absent'), root);
        assert.equal(missing.failures.length, 1);
        assert.match(missing.failures[0], /absent/);
        const empty = checkBudgets(appBudget('typesonly'), root);
        assert.equal(empty.failures.length, 1);
        assert.match(empty.failures[0], /typesonly/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('file budgets measure exactly one file, without walking imports', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'csszyx-size-'));
    try {
        // The payload CONTAINS what looks like a relative import; a closure
        // walk would chase the missing './x' and fail. A binary artifact like
        // a .wasm must be measured as one opaque file.
        mkdirSync(path.join(root, 'packages/thing'), { recursive: true });
        writeFileSync(
            path.join(root, 'packages/thing/artifact.wasm'),
            '\0asm import "./x" garbage',
        );
        const { failures, results } = checkBudgets(
            [
                {
                    name: 'thing wasm artifact',
                    kind: 'file',
                    target: 'packages/thing/artifact.wasm',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(failures.length, 0);
        assert.equal(results[0].files.length, 1);
        assert.ok(results[0].gzipBytes > 0);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a file budget whose artifact is missing fails instead of passing silently', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'csszyx-size-'));
    try {
        const { failures } = checkBudgets(
            [
                {
                    name: 'thing wasm artifact',
                    kind: 'file',
                    target: 'packages/thing/artifact.wasm',
                    maxGzipBytes: 1024,
                },
            ],
            root,
        );
        assert.equal(failures.length, 1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('committed budgets cover the four user-shipped surfaces', () => {
    const names = SIZE_BUDGETS.map(budget => budget.name);
    assert.equal(new Set(names).size, SIZE_BUDGETS.length, 'budget names must be unique');
    assert.equal(SIZE_BUDGETS.length, 4);
    for (const budget of SIZE_BUDGETS) {
        assert.ok(['app-bundle', 'file'].includes(budget.kind));
        assert.ok(Number.isInteger(budget.maxGzipBytes) && budget.maxGzipBytes > 0);
        assert.ok(!path.isAbsolute(budget.target), 'targets are repo-relative');
    }
    assert.ok(
        SIZE_BUDGETS.some(budget => budget.kind === 'file' && budget.target.includes('pkg-parser')),
        'the parser wasm artifact must stay under a byte ceiling',
    );
    // The compiler ships to the browser only through its `./browser` entry;
    // the rest of it is build-time code that never leaves the dev machine.
    const compiler = SIZE_BUDGETS.find(budget => budget.target === 'packages/compiler');
    assert.deepEqual(compiler?.subpaths, ['./browser']);
});
