import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
    appBundle,
    checkBudgets,
    entryBudgetProblems,
    gzipTotalBytes,
    isRuntimeArtifact,
    listExportEntries,
    listExportSubpaths,
    nodeEntryFiles,
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

test('an excluded subpath is left out, and an exclusion naming no export fails', () => {
    const root = makeFixture(appPackage('thing', false));
    try {
        const all = checkBudgets(appBudget('thing'), root).results[0];
        const one = checkBudgets(appBudget('thing', { excludeSubpaths: ['./heavy'] }), root)
            .results[0];
        assert.equal(one.files.length, 1);
        assert.ok(one.gzipBytes < all.gzipBytes, `${one.gzipBytes} < ${all.gzipBytes}`);
        const unknown = checkBudgets(appBudget('thing', { excludeSubpaths: ['./nope'] }), root);
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

test('committed budgets cover the user-shipped surfaces and the engine entries', () => {
    const names = SIZE_BUDGETS.map(budget => budget.name);
    assert.equal(new Set(names).size, SIZE_BUDGETS.length, 'budget names must be unique');
    assert.equal(SIZE_BUDGETS.length, 7);
    for (const budget of SIZE_BUDGETS) {
        assert.ok(['app-bundle', 'file', 'node-entry'].includes(budget.kind));
        assert.ok(Number.isInteger(budget.maxGzipBytes) && budget.maxGzipBytes > 0);
        assert.ok(!path.isAbsolute(budget.target), 'targets are repo-relative');
    }
    assert.ok(
        SIZE_BUDGETS.some(budget => budget.kind === 'file' && budget.target.includes('pkg-parser')),
        'the parser wasm artifact must stay under a byte ceiling',
    );
    // The VS Code extension bundles the compiler's source into one file, so
    // a heavy import in the compiler grows what every editor install loads.
    assert.deepEqual(
        SIZE_BUDGETS.filter(budget => budget.target.startsWith('packages/vscode/')).map(budget => [
            budget.kind,
            budget.target,
        ]),
        [['file', 'packages/vscode/dist/extension.js']],
    );
    // The compiler leaves out only its build-time code, `.`, `./engine`,
    // `./internal` and `./migrate`; everything else it exports ships to the
    // browser, `./browser` first.
    const compiler = SIZE_BUDGETS.find(budget => budget.target === 'packages/compiler');
    assert.deepEqual(compiler?.excludeSubpaths, ['.', './engine', './internal', './migrate']);
    assert.equal(compiler?.subpaths, undefined, 'an inclusion list would miss new exports');
    assert.ok(Object.hasOwn(compiler.entryBudgets, './browser'));
    // The two entries the build tools import are priced by what Node loads.
    assert.deepEqual(
        SIZE_BUDGETS.filter(budget => budget.kind === 'node-entry').map(budget => [
            budget.target,
            budget.subpath,
        ]),
        [
            ['packages/compiler', './engine'],
            ['packages/compiler', './internal'],
        ],
    );
    // Every app bundle prices each entry on its own, no entry ceiling is
    // looser than the union it is part of, and the priced entries are
    // exactly the package's real runtime exports minus the exclusions.
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const budget of SIZE_BUDGETS.filter(b => b.kind === 'app-bundle')) {
        const ceilings = Object.values(budget.entryBudgets ?? {});
        assert.ok(ceilings.length > 0, `${budget.name} has no entry budgets`);
        for (const ceiling of ceilings) {
            assert.ok(Number.isInteger(ceiling) && ceiling > 0);
            assert.ok(ceiling <= budget.maxGzipBytes, `${budget.name}: ${ceiling}`);
        }
        // Read from `package.json` itself, not through the helper under test:
        // every subpath whose import target is JS, minus the exclusions.
        const manifest = JSON.parse(
            readFileSync(path.join(repoRoot, budget.target, 'package.json'), 'utf8'),
        );
        const expected = Object.entries(manifest.exports)
            .filter(([subpath, value]) => {
                if ((budget.excludeSubpaths ?? []).includes(subpath)) return false;
                let target = value;
                while (target && typeof target === 'object') {
                    target = target.import ?? target.default;
                }
                return typeof target === 'string' && /\.[cm]?js$/.test(target);
            })
            .map(([subpath]) => subpath)
            .sort();
        assert.deepEqual(Object.keys(budget.entryBudgets).sort(), expected, budget.name);
    }
});

/** A package with a heavy main entry and a light `./lite` entry. With `leak`
 * the light entry also imports the heavy table, as a careless re-export would.
 * @param {boolean} leak whether `./lite` pulls in the heavy module
 * @returns {Record<string, string>} fixture file map
 */
function splitPackage(leak) {
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: {
                '.': { import: { default: './dist/index.mjs' } },
                './lite': { import: { default: './dist/lite.mjs' } },
            },
        }),
        'packages/thing/dist/heavy.mjs': `export const table = ${JSON.stringify(
            Array.from({ length: 2000 }, (_, i) => `entry-${(i * 7919) % 10007}`),
        )};\n`,
        'packages/thing/dist/index.mjs':
            "import { table } from './heavy.mjs';\nexport const pick = i => table[i];\n",
        'packages/thing/dist/lite.mjs': leak
            ? "import { table } from './heavy.mjs';\nexport const tiny = x => x + table.length;\n"
            : 'export const tiny = x => x + 1;\n',
    };
}

test('lists each runtime export subpath with its entry file', () => {
    const root = makeFixture(splitPackage(false));
    const dir = path.join(root, 'packages/thing');
    try {
        assert.deepEqual(listExportSubpaths(dir), [
            { subpath: '.', file: path.join(dir, 'dist/index.mjs') },
            { subpath: './lite', file: path.join(dir, 'dist/lite.mjs') },
        ]);
        assert.deepEqual(listExportSubpaths(dir, ['.']), [
            { subpath: './lite', file: path.join(dir, 'dist/lite.mjs') },
        ]);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a heavy import added to a light entry fails its entry budget, not the union', () => {
    const cleanRoot = makeFixture(splitPackage(false));
    const leakRoot = makeFixture(splitPackage(true));
    try {
        const clean = checkBudgets(appBudget('thing'), cleanRoot).results[0].gzipBytes;
        const lite = checkBudgets(appBudget('thing', { excludeSubpaths: ['.'] }), cleanRoot)
            .results[0].gzipBytes;
        const main = checkBudgets(appBudget('thing', { excludeSubpaths: ['./lite'] }), cleanRoot)
            .results[0].gzipBytes;
        // Ceilings set the way the committed ones are: ~300 above a measurement.
        const budget = appBudget('thing', {
            maxGzipBytes: clean + 300,
            entryBudgets: { '.': main + 300, './lite': lite + 300 },
        });
        assert.deepEqual(checkBudgets(budget, cleanRoot).failures, []);

        const leaked = checkBudgets(budget, leakRoot);
        // The union already held the table, so it barely moves and passes.
        const union = leaked.results.find(r => r.name === 'thing app');
        assert.equal(union.ok, true, `union ${union.gzipBytes} vs ${clean}`);
        // The light entry measured alone is what catches it.
        assert.equal(leaked.failures.length, 1);
        assert.match(leaked.failures[0], /thing app `\.\/lite`: \d+ gzip bytes exceeds/);
        const liteResult = leaked.results.find(r => r.name === 'thing app `./lite`');
        assert.equal(liteResult.ok, false);
        assert.ok(liteResult.gzipBytes > lite + 1000, `${liteResult.gzipBytes} vs ${lite}`);
    } finally {
        rmSync(cleanRoot, { recursive: true, force: true });
        rmSync(leakRoot, { recursive: true, force: true });
    }
});

test('an export without an entry budget, or a budget without an export, fails', () => {
    assert.deepEqual(entryBudgetProblems(['.', './lite'], { '.': 1, './lite': 1 }), []);
    assert.deepEqual(entryBudgetProblems(['.', './lite'], { '.': 1, './gone': 1 }), [
        'export `./lite` has no entry budget',
        'entry budget `./gone` names no runtime export',
    ]);
    const root = makeFixture(splitPackage(false));
    try {
        const { failures, results } = checkBudgets(
            appBudget('thing', { entryBudgets: { '.': 100_000 } }),
            root,
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0], /export `\.\/lite` has no entry budget/);
        // The priced entry is still measured.
        assert.ok(results.some(r => r.name === 'thing app `.`'));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a new export that is not excluded must get an entry budget', () => {
    // `./build` is build-time code, excluded the way the compiler excludes
    // `.` and `./migrate`; `./fresh` is an export added later that nobody
    // listed anywhere.
    const files = splitPackage(false);
    const manifest = JSON.parse(files['packages/thing/package.json']);
    manifest.exports['./build'] = { import: { default: './dist/build.mjs' } };
    files['packages/thing/dist/build.mjs'] = 'export const build = () => 1;\n';
    const budget = appBudget('thing', {
        excludeSubpaths: ['./build'],
        entryBudgets: { '.': 100_000, './lite': 100_000 },
    });
    const before = makeFixture({
        ...files,
        'packages/thing/package.json': JSON.stringify(manifest),
    });
    manifest.exports['./fresh'] = { import: { default: './dist/fresh.mjs' } };
    const after = makeFixture({
        ...files,
        'packages/thing/package.json': JSON.stringify(manifest),
        'packages/thing/dist/fresh.mjs': 'export const fresh = () => 2;\n',
    });
    try {
        assert.deepEqual(checkBudgets(budget, before).failures, []);
        const { failures, results } = checkBudgets(budget, after);
        assert.equal(failures.length, 1);
        assert.match(failures[0], /export `\.\/fresh` has no entry budget/);
        // The new export is in the union even before it gets a budget.
        assert.ok(results[0].files.some(file => file.endsWith('fresh.mjs')));
    } finally {
        rmSync(before, { recursive: true, force: true });
        rmSync(after, { recursive: true, force: true });
    }
});

/** A package whose `./engine` reaches two files by static import, one other
 * package, a Node builtin, and a large file it loads only through `import()`.
 * @returns {Record<string, string>} fixture file map
 */
function enginePackage() {
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: {
                './engine': { types: './dist/engine.d.mts', default: './dist/engine.mjs' },
            },
        }),
        'packages/thing/dist/engine.mjs':
            "import { a } from './a.mjs';\nimport { readFileSync } from 'node:fs';\n" +
            "import { b } from 'other-pkg';\n" +
            "export const run = () => import('./lazy.mjs').then(m => m.x + a + b + readFileSync);\n",
        'packages/thing/dist/a.mjs': "export { c as a } from './c.mjs';\n",
        'packages/thing/dist/c.mjs': 'export const c = 1;\n',
        'packages/thing/dist/lazy.mjs': `export const x = ${JSON.stringify(DEV_TEXT)};\n`,
    };
}

/** One node-entry budget over the fixture's `./engine`.
 * @param {Partial<typeof SIZE_BUDGETS[number]>} [extra] extra budget fields
 * @returns {typeof SIZE_BUDGETS} a one-entry budget list
 */
function engineBudget(extra = {}) {
    return [
        {
            name: 'thing engine',
            kind: 'node-entry',
            target: 'packages/thing',
            subpath: './engine',
            maxGzipBytes: 100_000,
            ...extra,
        },
    ];
}

test('node-entry budgets count every file a static import loads, and no lazy one', () => {
    const root = makeFixture(enginePackage());
    const dist = path.join(root, 'packages/thing/dist');
    const loaded = ['a.mjs', 'c.mjs', 'engine.mjs'].map(file => path.join(dist, file));
    try {
        assert.deepEqual(nodeEntryFiles(path.join(dist, 'engine.mjs')), loaded);
        const { failures, results } = checkBudgets(engineBudget(), root);
        assert.deepEqual(failures, []);
        assert.deepEqual(results[0].files, loaded);
        assert.equal(results[0].gzipBytes, gzipTotalBytes(loaded));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a node-entry budget fails over its limit, or on a subpath the package lacks', () => {
    const root = makeFixture(enginePackage());
    try {
        const over = checkBudgets(engineBudget({ maxGzipBytes: 8 }), root);
        assert.equal(over.failures.length, 1);
        assert.match(over.failures[0], /thing engine: \d+ gzip bytes exceeds the 8-byte budget/);
        const missing = checkBudgets(engineBudget({ subpath: './nope' }), root);
        assert.equal(missing.failures.length, 1);
        assert.match(missing.failures[0], /no export subpath `\.\/nope` in thing/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
