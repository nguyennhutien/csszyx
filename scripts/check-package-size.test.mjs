import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { buildSync } from 'esbuild';

import * as sizeGate from './check-package-size.mjs';
import {
    appBundle,
    checkBudgets,
    checkViteBudgets,
    entryBudgetProblems,
    gzipTotalBytes,
    isRuntimeArtifact,
    listExportEntries,
    listExportSubpaths,
    moduleOrderProblems,
    nodeEntryFiles,
    SIZE_BUDGETS,
    viteAppBundle,
} from './check-package-size.mjs';
import { jsLiteral } from './js-literal.mjs';

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

/** A package whose production bundle prints two registry lines, the compact
 * form a site writes inline, through the method each one's entry names.
 * @param {string} body extra statements for the entry module
 * @returns {Record<string, string>} fixture file map
 */
function codesPackage(body = '') {
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/thing/dist/index.mjs':
            'export function report(args) {\n' +
            '    console.warn(`[csszyx] gone-key: ${JSON.stringify(args)} https://csszyx.com/e/gone-key`);\n' +
            '    console.error(`[csszyx] bad-map: ${JSON.stringify(args)} https://csszyx.com/e/bad-map`);\n' +
            `    ${body}\n` +
            '}\n',
    };
}

/** The registry entries the fixture's codes come from: two that print in
 * production from the package, one that does not, one from another package.
 */
const CODE_ENTRIES = [
    {
        id: 'gone-key',
        surfaces: { runtime: { production: true, host: 'browser' } },
        sources: ['packages/thing/src/a.ts:1'],
    },
    {
        id: 'bad-map',
        surfaces: { runtime: { production: ['json'], host: 'browser', console: 'error' } },
        sources: ['packages/thing/src/b.ts:2'],
    },
    {
        id: 'nudge',
        surfaces: { runtime: { production: false, host: 'browser' } },
        sources: ['packages/thing/src/a.ts:9'],
    },
    {
        id: 'elsewhere',
        surfaces: { runtime: { production: true, host: 'browser' } },
        sources: ['packages/other/src/c.ts:3'],
    },
    {
        id: 'no-surface',
        surfaces: { error: { host: 'browser' } },
        sources: ['packages/thing/src/d.ts:1'],
    },
];

test('the codes a production bundle may print come from the registry, with their method', () => {
    // `d.ts` is a source of the bundle, `a.ts:9` a development line in it.
    const files = new Set([
        'packages/thing/src/a.ts',
        'packages/thing/src/b.ts',
        'packages/thing/src/d.ts',
    ]);
    // A throw is a sink too (ADR 0031 §6): `d.ts` throws `no-surface`.
    assert.deepEqual(sizeGate.productionCodesOf(CODE_ENTRIES, files), [
        'error: [csszyx] bad-map: ',
        'throw: [csszyx] no-surface: ',
        'warn: [csszyx] gone-key: ',
    ]);
    // The compiler's list is the registry's: every line its browser entries
    // print in production, and nothing written by hand.
    const compiler = SIZE_BUDGETS.find(
        budget => budget.name === '@csszyx/compiler browser app bundle',
    );
    assert.equal(compiler.productionMessages, undefined);
    assert.ok(compiler.productionCodes.length > 0);
    assert.ok(compiler.productionCodes.includes('warn: [csszyx] removed-key: '));
    // A throw from a Node-only module of the package is no console line here.
    assert.ok(!compiler.productionCodes.some(head => head.includes('recovery-manifest')));
});

test('a production bundle may print only the codes the registry marks as printing', () => {
    const codes = sizeGate.productionCodesOf(
        CODE_ENTRIES,
        new Set(['packages/thing/src/a.ts', 'packages/thing/src/b.ts']),
    );
    const run = files => {
        const root = makeFixture(files);
        try {
            return checkBudgets(appBudget('thing', { productionCodes: codes }), root).failures;
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    assert.deepEqual(run(codesPackage()), []);

    const unlisted = run(codesPackage("console.warn('[csszyx] nudge: ' + JSON.stringify(args));"));
    assert.equal(unlisted.length, 1);
    assert.match(unlisted[0], /prints "warn: \[csszyx\] nudge: ", which the registry/);

    // The registry names the method: a line printed through another one is
    // not the line the docs and the console filters expect.
    const method = run({
        ...codesPackage(),
        'packages/thing/dist/index.mjs':
            'export function report(a) { console.warn(`[csszyx] gone-key: ${a}`); ' +
            'console.warn(`[csszyx] bad-map: ${a}`); }\n',
    });
    assert.equal(method.length, 2);
    assert.match(method[0], /prints "warn: \[csszyx\] bad-map: "/);
    assert.match(method[1], /no longer prints "error: \[csszyx\] bad-map: "/);

    // The positive control: a scan that finds no sink at all is a broken scan
    // (or a broken bundle), never a pass.
    const silent = run({
        ...codesPackage(),
        'packages/thing/dist/index.mjs': 'export const x = 1;\n',
    });
    assert.ok(
        silent.some(failure => /found no sink/.test(failure)),
        silent.join('\n'),
    );
    assert.ok(
        silent.some(failure => /no longer prints "warn: \[csszyx\] gone-key: "/.test(failure)),
    );
});

test('the runtime and dynamic lists are the registry codes their sources print', () => {
    const budget = name => SIZE_BUDGETS.find(entry => entry.name === name);
    const runtime = budget('@csszyx/runtime app bundle');
    assert.equal(runtime.productionMessages, undefined);
    // Integrity checks and recovery report csszyx's own output as wrong.
    for (const head of [
        'error: [csszyx] hydration-aborted: ',
        'error: [csszyx] mangle-map-unreadable: ',
        'error: [csszyx] recovery-manifest-unreadable: ',
        'warn: [csszyx] csr-recovery-dev-only: ',
        'warn: [csszyx] merge-table-format-skew: ',
        'warn: [csszyx] web-crypto-unavailable: ',
    ]) {
        assert.ok(runtime.productionCodes.includes(head), head);
    }
    // The compiler's own production lines print from the compiler's bundle.
    assert.ok(!runtime.productionCodes.some(head => head.includes('removed-key')));
    // The two `initRuntime({ debug: true })` logs are no diagnostic (ADR 0031
    // item 5), so the registry has no id for them: they are the only lines
    // allowed beside its codes, and they are listed by hand.
    assert.deepEqual(runtime.nonRegistryMessages, [
        'log: [csszyx] Runtime initialized',
        'warn: [csszyx] Runtime already initialized',
    ]);
    // The errors the runtime throws in production, by code.
    for (const head of [
        'throw: [csszyx] lowering-not-loaded: ',
        'throw: [csszyx] runtime-prefix-conflict: ',
        'throw: [csszyx] sz-object-depth: ',
        'throw: [csszyx] web-crypto-unavailable: ',
    ]) {
        assert.ok(runtime.productionCodes.includes(head), head);
    }
    // A throw the registry keeps to development is no production sink.
    assert.ok(!runtime.productionCodes.some(head => head.includes('lite-sz-object')));
    assert.ok(!runtime.productionCodes.some(head => head.includes('split-box-sz-string')));
    // `@csszyx/dynamic` prints nothing in production: its one production
    // failure is a rejected fetch, which it catches. It throws two errors.
    const dynamic = budget('@csszyx/dynamic app bundle');
    assert.equal(dynamic.productionMessages, undefined);
    assert.deepEqual(dynamic.productionCodes, [
        'throw: [csszyx] dynamic-manifest-unreachable: ',
        'throw: [csszyx] sz-object-depth: ',
    ]);
});

test('a bundle the registry lets print nothing passes only while it prints nothing', () => {
    const run = (files, extra = {}) => {
        const root = makeFixture(files);
        try {
            return checkBudgets(appBudget('thing', { productionCodes: [], ...extra }), root)
                .failures;
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };
    const quiet = {
        ...codesPackage(),
        'packages/thing/dist/index.mjs': 'export const x = 1;\n',
    };
    assert.deepEqual(run(quiet), []);
    const loud = run(codesPackage());
    assert.equal(loud.length, 2, loud.join('\n'));
    // A line outside the registry passes only when the budget names it.
    const debug = {
        ...codesPackage(),
        'packages/thing/dist/index.mjs':
            "export function init(c) { if (c) console.log('[thing] up', c); }\n",
    };
    assert.equal(run(debug).length, 1);
    assert.deepEqual(run(debug, { nonRegistryMessages: ['log: [thing] up'] }), []);
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
    // An app bundle's module order is checked only where its entries are measured.
    for (const budget of SIZE_BUDGETS.filter(b => b.kind === 'app-bundle' && b.moduleOrder)) {
        for (const subpath of Object.keys(budget.moduleOrder)) {
            assert.ok(
                Object.hasOwn(budget.entryBudgets ?? {}, subpath),
                `${budget.name} ${subpath}`,
            );
            assert.ok(
                Object.hasOwn(budget.vite?.entryBudgets ?? {}, subpath),
                `${budget.name} ${subpath}`,
            );
        }
    }
    assert.deepEqual(
        SIZE_BUDGETS.find(b => b.target === 'packages/compiler')?.moduleOrder?.['./browser'],
        ['per-key-rows-', 'closed-enum-tables-'],
    );
    assert.equal(new Set(names).size, SIZE_BUDGETS.length, 'budget names must be unique');
    assert.equal(SIZE_BUDGETS.length, 10);
    for (const budget of SIZE_BUDGETS) {
        assert.ok(['app-bundle', 'installed-app', 'file', 'node-entry'].includes(budget.kind));
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
    // A script tag loads the CDN bundles whole, the development one too, and
    // each keeps the compiler's chunk layout, read back from the build that
    // writes it: a bundle built from the compiler's source has neither chunk.
    const cdn = SIZE_BUDGETS.filter(budget => budget.target.startsWith('packages/csszyx/dist/'));
    assert.deepEqual(
        cdn.map(budget => [budget.kind, budget.target, budget.moduleOrder]),
        [
            [
                'file',
                'packages/csszyx/dist/browser.iife.js',
                ['per-key-rows-', 'closed-enum-tables-'],
            ],
            [
                'file',
                'packages/csszyx/dist/browser.dev.iife.js',
                ['per-key-rows-', 'closed-enum-tables-'],
            ],
        ],
    );
    for (const budget of cdn) assert.equal(budget.build?.tsconfigRaw, '{}', budget.name);
    // The runtime and the dynamic layer as an app that installs csszyx ships
    // them, the compiler bundled in once, with the same chunk layout.
    assert.deepEqual(
        SIZE_BUDGETS.filter(budget => budget.kind === 'installed-app').map(budget => [
            budget.target,
            budget.imports,
            budget.moduleOrder,
        ]),
        [
            [
                'packages/csszyx',
                ['@csszyx/runtime', '@csszyx/dynamic'],
                ['per-key-rows-', 'closed-enum-tables-'],
            ],
        ],
    );
    // The compiler leaves out its build-time code, `.`, `./engine`,
    // `./internal` and `./migrate`, and the development reporter `./report`,
    // which the template leak gate prices through its consumers; everything
    // else it exports ships to the browser, `./browser` first.
    const compiler = SIZE_BUDGETS.find(budget => budget.target === 'packages/compiler');
    assert.deepEqual(compiler?.excludeSubpaths, [
        '.',
        './engine',
        './internal',
        './migrate',
        './report',
    ]);
    assert.equal(compiler?.subpaths, undefined, 'an inclusion list would miss new exports');
    assert.ok(Object.hasOwn(compiler.entryBudgets, './browser'));
    // The two entries the build tools import are priced by what Node loads.
    assert.deepEqual(
        SIZE_BUDGETS.filter(budget => budget.kind === 'node-entry').map(budget => [
            budget.target,
            budget.subpath,
            budget.excludedModules,
        ]),
        [
            ['packages/compiler', './engine', ['src/state-variants.generated.ts']],
            ['packages/compiler', './internal', ['src/state-variants.generated.ts']],
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
        // Vite prices the same bundles: the union and every entry the
        // esbuild lane prices, each under a ceiling of its own.
        assert.ok(Number.isInteger(budget.vite?.maxGzipBytes), `${budget.name} has no Vite budget`);
        assert.deepEqual(
            Object.keys(budget.vite.entryBudgets ?? {}).sort(),
            Object.keys(budget.entryBudgets).sort(),
            `${budget.name} (Vite)`,
        );
        for (const ceiling of Object.values(budget.vite.entryBudgets)) {
            assert.ok(Number.isInteger(ceiling) && ceiling > 0);
            assert.ok(ceiling <= budget.vite.maxGzipBytes, `${budget.name} (Vite): ${ceiling}`);
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

/** Vite ceilings over the fixture package's two entries.
 * @param {number} [ceiling] every ceiling
 * @returns {{ maxGzipBytes: number, entryBudgets: Record<string, number> }} the `vite` field
 */
function viteCeilings(ceiling = 100_000) {
    return { maxGzipBytes: ceiling, entryBudgets: { '.': ceiling, './heavy': ceiling } };
}

test('the Vite lane measures each app bundle the way a Vite app ships it', async () => {
    // Same package name in two roots, so the two builds differ only by the warning.
    const withDevRoot = makeFixture(appPackage('thing', true));
    const noDevRoot = makeFixture(appPackage('thing', false));
    try {
        const budget = appBudget('thing', { vite: viteCeilings() });
        const withDev = await checkViteBudgets(budget, withDevRoot);
        const noDev = await checkViteBudgets(budget, noDevRoot);
        assert.deepEqual([withDev.failures, noDev.failures], [[], []]);
        assert.deepEqual(
            withDev.results.map(r => r.name),
            ['thing app (Vite)', 'thing app (Vite) `.`', 'thing app (Vite) `./heavy`'],
        );
        // `@csszyx/other` does not exist, so it stayed external; the warning
        // folded out; and the namespace import kept every export.
        const code = (
            await viteAppBundle(withDev.results[0].files, path.join(withDevRoot, 'packages/thing'))
        ).join('\n');
        assert.ok(!code.includes('dev-note'), 'the development warning shipped');
        assert.ok(code.includes('entry-399'), 'the exported table was shaken out');
        assert.match(code, /@csszyx\/other/);
        const gap = Math.abs(withDev.results[0].gzipBytes - noDev.results[0].gzipBytes);
        assert.ok(gap <= 8, `gzip differs by ${gap}`);
        assert.ok(withDev.results.every(r => r.ok && r.gzipBytes > 0));
    } finally {
        rmSync(withDevRoot, { recursive: true, force: true });
        rmSync(noDevRoot, { recursive: true, force: true });
    }
});

test('the Vite lane leaves peer dependencies external and skips budgets without it', async () => {
    const root = makeFixture({
        ...appPackage('thing', false),
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            peerDependencies: { 'peer-lib': '>=1' },
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/thing/dist/index.mjs':
            "export { peer } from 'peer-lib';\nexport { deep } from 'peer-lib/deep';\n",
    });
    try {
        // `peer-lib` is not installed; bundling it in would fail the build.
        const vite = { maxGzipBytes: 100_000, entryBudgets: { '.': 100_000 } };
        const { failures, results } = await checkViteBudgets(appBudget('thing', { vite }), root);
        assert.deepEqual(failures, []);
        assert.equal(results.length, 2);
        // A budget with no `vite` field, or another kind, is the esbuild lane's alone.
        assert.deepEqual(await checkViteBudgets(appBudget('thing'), root), {
            results: [],
            failures: [],
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a Vite ceiling fails over its limit, and a Vite entry needs a budget', async () => {
    const root = makeFixture(appPackage('thing', false));
    try {
        const over = await checkViteBudgets(appBudget('thing', { vite: viteCeilings(8) }), root);
        assert.equal(over.failures.length, 3);
        assert.match(
            over.failures[0],
            /thing app \(Vite\): \d+ gzip bytes exceeds the 8-byte budget/,
        );
        assert.match(over.failures[0], /raise the/);
        const unpriced = await checkViteBudgets(
            appBudget('thing', { vite: { maxGzipBytes: 100_000, entryBudgets: { '.': 100_000 } } }),
            root,
        );
        assert.equal(unpriced.failures.length, 1);
        assert.match(
            unpriced.failures[0],
            /thing app \(Vite\): export `\.\/heavy` has no entry budget/,
        );
        const none = await checkViteBudgets(
            appBudget('thing', { vite: { maxGzipBytes: 100_000 } }),
            root,
        );
        assert.equal(none.failures.length, 2);
        assert.equal(none.results.length, 1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('an app bundle Vite cannot build fails instead of passing silently', async () => {
    const root = makeFixture({
        ...appPackage('thing', false),
        'packages/thing/dist/index.mjs': "export { gone } from './missing.mjs';\n",
    });
    try {
        const { failures } = await checkViteBudgets(
            appBudget('thing', { vite: viteCeilings() }),
            root,
        );
        assert.equal(failures.length, 1);
        assert.match(failures[0], /thing app \(Vite\): .*missing\.mjs/s);
        const absent = await checkViteBudgets(appBudget('absent', { vite: viteCeilings() }), root);
        assert.equal(absent.failures.length, 1);
        assert.match(absent.failures[0], /absent app \(Vite\)/);
        const typesOnly = makeFixture({
            'packages/typesonly/package.json': JSON.stringify({
                name: 'typesonly',
                exports: { '.': { import: { types: './dist/index.d.mts' } } },
            }),
        });
        try {
            const empty = await checkViteBudgets(
                appBudget('typesonly', { vite: viteCeilings() }),
                typesOnly,
            );
            assert.equal(empty.failures.length, 1);
            assert.match(empty.failures[0], /typesonly app \(Vite\): no runtime export entries/);
        } finally {
            rmSync(typesOnly, { recursive: true, force: true });
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('a module order names the files that must come first, by name prefix', () => {
    const ids = ['/p/dist/rows-AB12.mjs', '/p/dist/tables-CD34.mjs', '/p/dist/core.mjs'];
    assert.deepEqual(moduleOrderProblems(ids, ['rows-', 'tables-']), []);
    assert.deepEqual(moduleOrderProblems(ids, ['tables-', 'rows-']), [
        'bundles `rows-` before `tables-`',
    ]);
    assert.deepEqual(moduleOrderProblems(ids, ['rows-', 'gone-']), [
        'bundles no module whose file name starts with `gone-`',
    ]);
});

/** A package whose one entry imports `a.mjs`, then `b.mjs`.
 * @returns {Record<string, string>} fixture files
 */
function orderedPackage() {
    return {
        'packages/ordered/package.json': JSON.stringify({
            name: 'ordered',
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/ordered/dist/index.mjs':
            "import { a } from './a.mjs';\nimport { b } from './b.mjs';\nexport const both = a + b;\n",
        'packages/ordered/dist/a.mjs': "export const a = 'first-module';\n",
        'packages/ordered/dist/b.mjs': "export const b = 'second-module';\n",
    };
}

test('an entry whose bundle lays modules out against its order fails in both lanes', async () => {
    const root = makeFixture(orderedPackage());
    try {
        const budget = (order, extra = {}) =>
            appBudget('ordered', {
                entryBudgets: { '.': 100_000 },
                vite: { maxGzipBytes: 100_000, entryBudgets: { '.': 100_000 } },
                moduleOrder: order,
                ...extra,
            });
        const kept = budget({ '.': ['a.', 'b.'] });
        assert.deepEqual(checkBudgets(kept, root).failures, []);
        assert.deepEqual((await checkViteBudgets(kept, root)).failures, []);

        const swapped = budget({ '.': ['b.', 'a.'] });
        for (const failures of [
            checkBudgets(swapped, root).failures,
            (await checkViteBudgets(swapped, root)).failures,
        ]) {
            assert.equal(failures.length, 1);
            assert.match(failures[0], /`\.` bundles `a\.` before `b\.`/);
        }

        const unknown = budget({ './gone': ['a.'] });
        for (const failures of [
            checkBudgets(unknown, root).failures,
            (await checkViteBudgets(unknown, root)).failures,
        ]) {
            assert.equal(failures.length, 1);
            assert.match(failures[0], /`\.\/gone` has a module order but no export/);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A file budget over `packages/ordered/dist/cdn.js`, which `options` builds
 * from the fixture's entry, with the module order it must keep.
 * @param {string} root fixture root
 * @param {string[]} order file-name prefixes, in the order required
 * @returns {typeof SIZE_BUDGETS} a one-entry budget list
 */
function cdnBudget(root, order) {
    return [
        {
            name: 'ordered cdn',
            kind: 'file',
            target: 'packages/ordered/dist/cdn.js',
            maxGzipBytes: 100_000,
            build: {
                entryPoints: [path.join(root, 'packages/ordered/dist/index.mjs')],
                bundle: true,
                minify: true,
                format: 'iife',
            },
            moduleOrder: order,
        },
    ];
}

test('a file built by esbuild keeps its module order, read from the build that wrote it', () => {
    const root = makeFixture(orderedPackage());
    const file = path.join(root, 'packages/ordered/dist/cdn.js');
    try {
        const [{ build }] = cdnBudget(root, []);
        writeFileSync(file, buildSync({ ...build, write: false }).outputFiles[0].text);
        assert.deepEqual(checkBudgets(cdnBudget(root, ['a.', 'b.']), root).failures, []);

        const swapped = checkBudgets(cdnBudget(root, ['b.', 'a.']), root).failures;
        assert.equal(swapped.length, 1);
        assert.match(swapped[0], /ordered cdn: bundles `a\.` before `b\.`/);

        // The order is read from a build in memory, so it says something
        // about the file only while the two are the same bytes.
        writeFileSync(file, '(()=>{})();\n');
        const stale = checkBudgets(cdnBudget(root, ['a.', 'b.']), root).failures;
        assert.equal(stale.length, 1);
        assert.match(stale[0], /ordered cdn: the file is not what its build options write/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** An app that installs `@csszyx/lib`, whose entry imports `a.mjs` then
 * `b.mjs` and a peer dependency the app brings itself, and a plugin that
 * names the library as its own peer, under a tsconfig whose
 * `paths` point the package at a source that does not build.
 * @returns {Record<string, string>} fixture files
 */
function installedPackage() {
    const lib = 'packages/app/node_modules/@csszyx/lib';
    return {
        'tsconfig.json': JSON.stringify({
            compilerOptions: { paths: { '@csszyx/lib': ['./packages/lib-src/index.ts'] } },
        }),
        'packages/lib-src/index.ts': 'export const broken: = ;\n',
        'packages/app/package.json': JSON.stringify({
            name: 'app',
            dependencies: { '@csszyx/lib': 'workspace:*', '@csszyx/plugin': 'workspace:*' },
        }),
        // A build plugin the app also installs names the library as a peer,
        // which must not leave the library out of the app's bundle.
        'packages/app/node_modules/@csszyx/plugin/package.json': JSON.stringify({
            name: '@csszyx/plugin',
            peerDependencies: { '@csszyx/lib': '*' },
        }),
        [`${lib}/package.json`]: JSON.stringify({
            name: '@csszyx/lib',
            peerDependencies: { 'peer-ui': '*' },
            exports: { '.': { import: './dist/index.mjs' } },
        }),
        [`${lib}/dist/index.mjs`]:
            "import { a } from './a.mjs';\nimport { b } from './b.mjs';\nimport ui from 'peer-ui';\n" +
            'export const both = a + b + ui;\n',
        [`${lib}/dist/a.mjs`]: "export const a = 'first-module';\n",
        [`${lib}/dist/b.mjs`]: "export const b = 'second-module';\n",
    };
}

/** An installed-app budget over {@link installedPackage}.
 * @param {Partial<typeof SIZE_BUDGETS[number]>} [extra] extra budget fields
 * @returns {typeof SIZE_BUDGETS} a one-entry budget list
 */
function installedBudget(extra = {}) {
    return [
        {
            name: 'installed app',
            kind: 'installed-app',
            target: 'packages/app',
            imports: ['@csszyx/lib'],
            maxGzipBytes: 100_000,
            moduleOrder: ['a.', 'b.'],
            ...extra,
        },
    ];
}

test('an installed app bundles the csszyx packages from their dist, as npm resolves them', () => {
    const root = makeFixture(installedPackage());
    try {
        const { failures, results } = checkBudgets(installedBudget(), root);
        assert.deepEqual(failures, []);
        assert.ok(results[0].gzipBytes > 0);

        const swapped = checkBudgets(installedBudget({ moduleOrder: ['b.', 'a.'] }), root);
        assert.equal(swapped.failures.length, 1);
        assert.match(swapped.failures[0], /installed app: bundles `a\.` before `b\.`/);

        const over = checkBudgets(installedBudget({ maxGzipBytes: 8 }), root);
        assert.equal(over.failures.length, 1);
        assert.match(over.failures[0], /installed app: \d+ gzip bytes exceeds the 8-byte budget/);

        const missing = checkBudgets(installedBudget({ imports: ['@csszyx/gone'] }), root);
        assert.equal(missing.failures.length, 1);
        assert.match(missing.failures[0], /installed app: [\s\S]*@csszyx\/gone/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** How a Rolldown build marks where each module starts: a `//#region` pair up
 * to 1.2.14, one `// <id>` line from 1.2.15 (rolldown#11235). */
const MODULE_MARKERS = {
    region: (name, body) => `//#region ${name}\n${body}\n//#endregion\n`,
    start: (name, body) => `// ${name}\n${body}\n`,
};

/** A package whose `./engine` loads two files, each with the source modules
 * a Rolldown build marks, and keeps `src/table.ts` in a file it never loads.
 * @param {boolean} leak whether the loaded chunk holds `src/table.ts`
 * @param {keyof typeof MODULE_MARKERS} [marker] how the build marks a module
 * @returns {Record<string, string>} fixture files
 */
function regionPackage(leak, marker = 'region') {
    const region = MODULE_MARKERS[marker];
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: { './engine': './dist/engine.mjs' },
        }),
        'packages/thing/src/table.ts': 'export const table = 1;\n',
        'packages/thing/dist/engine.mjs':
            "import { keys } from './keys.mjs';\n" +
            region('src/engine.ts', 'export const run = () => keys;'),
        'packages/thing/dist/keys.mjs':
            region('src/keys.ts', 'export const keys = 1;') +
            (leak ? region('src/table.ts', 'export const table = 1;') : ''),
        'packages/thing/dist/lowering.mjs': region('src/table.ts', 'export const table = 1;'),
    };
}

for (const marker of Object.keys(MODULE_MARKERS)) {
    test(`a node-entry budget fails when a file it loads holds a module kept out of it (${marker} markers)`, () => {
        const kept = makeFixture(regionPackage(false, marker));
        const leaked = makeFixture(regionPackage(true, marker));
        try {
            const budget = extra => engineBudget({ excludedModules: ['src/table.ts'], ...extra });
            assert.deepEqual(checkBudgets(budget(), kept).failures, []);

            const failures = checkBudgets(budget(), leaked).failures;
            assert.equal(failures.length, 1);
            assert.match(failures[0], /thing engine: loads `src\/table\.ts` \(dist\/keys\.mjs\)/);

            // A name no source file has is a stale entry, which would pass forever.
            const stale = checkBudgets(budget({ excludedModules: ['src/gone.ts'] }), kept).failures;
            assert.equal(stale.length, 1);
            assert.match(stale[0], /thing engine: `src\/gone\.ts` names no source file/);
        } finally {
            rmSync(kept, { recursive: true, force: true });
            rmSync(leaked, { recursive: true, force: true });
        }
    });
}

test('a node-entry budget whose files carry no region marker cannot read its layout', () => {
    const root = makeFixture({ ...enginePackage(), 'packages/thing/src/table.ts': '' });
    try {
        const failures = checkBudgets(
            engineBudget({ excludedModules: ['src/table.ts'] }),
            root,
        ).failures;
        assert.equal(failures.length, 1);
        assert.match(failures[0], /thing engine: no file it loads carries a module-start marker/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

/** A diagnostic as the generator's browser list carries it. */
const LEAK_DIAGNOSTIC = {
    id: 'gone-key',
    text: 'The `{key}` marker sentence that a production build drops entirely.',
    help: 'write `{key}`; short.',
};

/** A package that reports `gone-key` from a development branch, through a
 * csszyx sibling it bundles. With `leak` it also uses the template outside
 * any branch, as a site that forgot its check would.
 * @param {boolean} leak whether production code reads the template
 * @returns {Record<string, string>} fixture file map
 */
function reportingPackage(leak) {
    const lib = 'packages/thing/node_modules/@csszyx/lib';
    return {
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: { '.': { import: { default: './dist/index.mjs' } } },
        }),
        'packages/thing/dist/index.mjs':
            "import { GONE_KEY, szReport } from '@csszyx/lib/report';\n" +
            'export function check(key) {\n' +
            "    if (process.env.NODE_ENV !== 'production') szReport({ diagnostic: GONE_KEY, args: { key } });\n" +
            "    else console.warn('[csszyx] gone-key: ' + JSON.stringify({ key }));\n" +
            (leak ? '    return GONE_KEY.text;\n' : '') +
            '}\n',
        [`${lib}/package.json`]: JSON.stringify({
            name: '@csszyx/lib',
            sideEffects: false,
            exports: { './report': './report.mjs' },
        }),
        [`${lib}/report.mjs`]:
            `export const GONE_KEY = ${jsLiteral(LEAK_DIAGNOSTIC)};\n` +
            'export function szReport({ diagnostic, args }) {\n' +
            '    console.warn(diagnostic.text.replace("{key}", args.key));\n' +
            '}\n',
    };
}

/** The leak gate's options for {@link reportingPackage}.
 * @returns {object} the options
 */
function leakOptions() {
    return {
        diagnostics: [LEAK_DIAGNOSTIC],
        control: {
            resolveDir: 'packages/thing',
            id: 'gone-key',
            contents:
                "import { GONE_KEY, szReport } from '@csszyx/lib/report';\n" +
                "if (process.env.NODE_ENV !== 'production') szReport({ diagnostic: GONE_KEY, args: { key: 'x' } });\n",
        },
    };
}

test('a template counts as shipped when a bundle holds it whole as a string literal', () => {
    const texts = sizeGate.templateTexts?.([
        LEAK_DIAGNOSTIC,
        { id: 'formed', text: { a: 'A one.', b: 'A two.' }, note: { b: 'a note.' } },
        { id: 'unworded' },
    ]);
    assert.deepEqual(texts, [
        { id: 'gone-key', text: LEAK_DIAGNOSTIC.text },
        { id: 'gone-key', text: LEAK_DIAGNOSTIC.help },
        { id: 'formed', text: 'A one.' },
        { id: 'formed', text: 'A two.' },
        { id: 'formed', text: 'a note.' },
    ]);
    // Whichever quotes and escapes a minifier picks, the literal reads as the
    // template; prose that only shares its words is not one.
    for (const code of [
        `x=${JSON.stringify(LEAK_DIAGNOSTIC.text)}`,
        "x='The `{key}` marker sentence that a production build drops entirely.'",
        'x=`The \\`{key}\\` marker sentence that a production build drops entirely.`',
        'x={t:"The \\u0060{key}\\u0060 marker sentence that a production build drops entirely."}',
    ]) {
        assert.deepEqual(sizeGate.templateLeaks?.(code, texts), [texts[0]], code);
    }
    assert.deepEqual(
        sizeGate.templateLeaks?.(
            'x="[csszyx] The `dispaly` marker sentence that a production build drops entirely."',
            texts,
        ),
        [],
    );
});

test('production carries no template, and a development build of a site carries it', async () => {
    const clean = makeFixture(reportingPackage(false));
    const leaky = makeFixture(reportingPackage(true));
    try {
        assert.deepEqual(
            (await sizeGate.checkTemplateLeaks(appBudget('thing'), clean, leakOptions())).failures,
            [],
        );
        const leaked = await sizeGate.checkTemplateLeaks(appBudget('thing'), leaky, leakOptions());
        // The object ships whole, so both its templates do, in each bundler.
        assert.deepEqual(
            leaked.failures.map(failure => /^[^:]*/.exec(failure)[0]),
            ['thing app', 'thing app', 'thing app (Vite)', 'thing app (Vite)'],
        );
        assert.match(
            leaked.failures[0],
            /^thing app: the production bundle carries the development text "The `\{key\}` marker sentence that a production build drops entirely\." of `gone-key`/,
        );
        assert.match(leaked.failures[1], /"write `\{key\}`; short\." of `gone-key`/);
        assert.match(leaked.failures[2], /^thing app \(Vite\): the production bundle carries/);
        // The control is what proves the check can see a template at all: a
        // site whose development branch bundles nothing fails it, in each bundler.
        const blind = leakOptions();
        blind.control.contents = "import { GONE_KEY } from '@csszyx/lib/report';\n";
        const blinded = (await sizeGate.checkTemplateLeaks(appBudget('thing'), clean, blind))
            .failures;
        assert.equal(blinded.length, 4, blinded.join('\n'));
        assert.match(
            blinded[0],
            /^template leak control: a development build of a site that reports `gone-key` lacks "The `\{key\}` marker sentence/,
        );
        assert.match(blinded[2], /^template leak control \(Vite\): a development build/);
        const none = { ...leakOptions(), diagnostics: [{ id: 'x' }] };
        assert.match(
            (await sizeGate.checkTemplateLeaks(appBudget('thing'), clean, none)).failures.join(
                '\n',
            ),
            /no template to look for/,
        );
    } finally {
        rmSync(clean, { recursive: true, force: true });
        rmSync(leaky, { recursive: true, force: true });
    }
});

test('the leak gate reads the built bytes of shipped files and of the installed app', async () => {
    const template = jsLiteral(LEAK_DIAGNOSTIC.text);
    const root = makeFixture({
        ...reportingPackage(false),
        'packages/thing/dist/cdn.js': `(()=>{window.t=${template}})();\n`,
        'packages/thing/dist/editor.js': `exports.t=${template};\n`,
        'packages/thing/dist/dev.js': `(()=>{window.t=${template}})();\n`,
    });
    const file = (target, templateFree) => ({
        name: target,
        kind: 'file',
        target: `packages/thing/dist/${target}`,
        maxGzipBytes: 100_000,
        ...(templateFree === undefined ? {} : { templateFree }),
    });
    const installed = {
        name: 'thing installed app',
        kind: 'installed-app',
        target: 'packages/thing',
        imports: ['@csszyx/lib/report'],
        maxGzipBytes: 100_000,
    };
    try {
        const { failures, bundles } = await sizeGate.checkTemplateLeaks(
            [
                file('cdn.js', {}),
                // An editor reports these ids with their words, by design.
                file('editor.js', { allowedIds: ['gone-key'] }),
                // A development artifact carries templates and is not read.
                file('dev.js'),
                installed,
            ],
            root,
            leakOptions(),
        );
        assert.equal(bundles, 3);
        assert.deepEqual(
            failures.map(failure => /^[^:]*/.exec(failure)[0]),
            ['cdn.js', 'thing installed app', 'thing installed app'],
            failures.join('\n'),
        );
        assert.match(
            failures[0],
            /^cdn\.js: the production bundle carries the development text "The `\{key\}` marker sentence/,
        );
        const missing = await sizeGate.checkTemplateLeaks(
            [file('absent.js', {})],
            root,
            leakOptions(),
        );
        assert.match(missing.failures.join('\n'), /^absent\.js: .*run `pnpm build` first\?/m);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the shipped production files are read for templates, the editor ids named', () => {
    const byName = name => SIZE_BUDGETS.find(budget => budget.name === name);
    assert.deepEqual(byName('csszyx CDN bundle').templateFree, {});
    assert.deepEqual(byName('@csszyx/vscode extension bundle').templateFree, {
        allowedIds: ['unknown-key', 'canonical-key', 'removed-key', 'numeric-key'],
    });
    // The development bundle carries its templates by design.
    assert.equal(byName('csszyx CDN development bundle').templateFree, undefined);
});

test('the app bundles and the leak gate resolve packages as an install does, not by tsconfig paths', async () => {
    // A repository tsconfig that points the library and a helper at sources
    // that do not build: a build that read it would fail, an install never does.
    const broken = 'export const broken: = ;\n';
    const root = makeFixture({
        ...reportingPackage(false),
        'tsconfig.json': JSON.stringify({
            compilerOptions: {
                paths: {
                    '@csszyx/lib/report': ['./src/lib-report.ts'],
                    helper: ['./src/helper.ts'],
                },
            },
        }),
        'src/lib-report.ts': broken,
        'src/helper.ts': broken,
        'packages/thing/node_modules/helper/package.json': JSON.stringify({
            name: 'helper',
            exports: { '.': './index.mjs' },
        }),
        'packages/thing/node_modules/helper/index.mjs': 'export const helper = 1;\n',
        'packages/thing/dist/helped.mjs':
            "import { helper } from 'helper';\nexport const x = helper;\n",
        'packages/thing/package.json': JSON.stringify({
            name: 'thing',
            exports: {
                '.': { import: { default: './dist/index.mjs' } },
                './helped': { import: { default: './dist/helped.mjs' } },
            },
        }),
    });
    try {
        const prints = { productionMessages: ['warn: [csszyx] gone-key: '] };
        assert.deepEqual(checkBudgets(appBudget('thing', prints), root).failures, []);
        assert.deepEqual(
            (await sizeGate.checkTemplateLeaks(appBudget('thing'), root, leakOptions())).failures,
            [],
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the leak gate reads every worded console or thrown id, and its control is a real site', () => {
    const texts = sizeGate.templateTexts?.(sizeGate.TEMPLATE_DIAGNOSTICS ?? []) ?? [];
    assert.ok(texts.length > 150, `${texts.length} templates`);
    assert.ok(new Set(texts.map(({ id }) => id)).size > 60);
    assert.equal(sizeGate.TEMPLATE_CONTROL?.id, 'removed-key');
    assert.match(sizeGate.TEMPLATE_CONTROL.contents, /from '@csszyx\/compiler\/report'/);
    assert.match(sizeGate.TEMPLATE_CONTROL.contents, /process\.env\.NODE_ENV !== 'production'/);
});

test('a sink is a console call, a throw, and the message of an error a bundle builds', () => {
    const { sinkMessages } = sizeGate;
    const compact = code =>
        `\`[csszyx] ${code}: \${JSON.stringify(a)} https://csszyx.com/e/${code}\``;
    assert.deepEqual(
        sinkMessages(
            `export function f(a, e) {
                console.warn(${compact('gone-key')});
                console.error('[csszyx] bad-map: ' + JSON.stringify(a) + ' https://csszyx.com/e/bad-map');
                if (a) throw new Error('the value is not what it should be');
                if (e) throw new TypeError(${compact('sz-attribute-syntax')});
                throw \`[csszyx] thrown-template: \${a}\`;
            }`,
        ),
        [
            'error: [csszyx] bad-map: ',
            'throw: [csszyx] sz-attribute-syntax: ',
            'throw: [csszyx] thrown-template: ',
            'throw: the value is not what it should be',
            'warn: [csszyx] gone-key: ',
        ],
    );
    // A csszyx error built from options, directly or through a subclass's
    // `super`, whatever its minified class name: the message is the sink.
    assert.deepEqual(
        sinkMessages(
            `import { CsszyxError as q } from '@csszyx/compiler/errors';
            var D = class extends q { constructor(n) { let a = { n };
                super({ code: 'deep', args: a, message: ${compact('deep')} }); } };
            export const make = a => new q({ code: 'gone', args: a, message: ${compact('gone')} });
            export const deep = () => { throw new D(1); };`,
        ),
        ['throw: [csszyx] deep: ', 'throw: [csszyx] gone: '],
    );
});

test('a sink that carries prose, or a code the message does not name, is read as written', () => {
    const { sinkMessages } = sizeGate;
    // Prose after the code head is a sentence in production, not the compact line.
    assert.deepEqual(
        sinkMessages(
            'export const f = a => { throw new Error(`[csszyx] gone-key: the key ${a} is gone`); };',
        ),
        ['throw: [csszyx] gone-key: the key '],
    );
    // So is a link to another code's page.
    assert.deepEqual(
        sinkMessages(
            'export const f = a => console.warn(`[csszyx] gone-key: ${JSON.stringify(a)} https://csszyx.com/e/other`);',
        ),
        ['warn: [csszyx] gone-key: … https://csszyx.com/e/other'],
    );
    // An error whose `code` is not the code its message names.
    assert.deepEqual(
        sinkMessages(
            `import { CsszyxError as q } from '@csszyx/compiler/errors';
            export const f = a => new q({ code: 'one', args: a,
                message: \`[csszyx] two: \${JSON.stringify(a)} https://csszyx.com/e/two\` });`,
        ),
        ['throw: [csszyx] two: (code one)'],
    );
});

test('a passthrough sink is read by what it is, and a class csszyx registers by its code', () => {
    const { sinkMessages } = sizeGate;
    // A rethrow, an error from a factory and a class that words its own
    // message carry no message at the throw: the message is read where the
    // error is built.
    assert.deepEqual(
        sinkMessages(
            `export function f(g) { try { g(); } catch (e) { throw e; } }
            export const h = g => { throw g(); };
            export const i = C => { throw new C(); };`,
        ),
        [],
    );
    // A non-literal message at a console call or a native error is listed,
    // so a budget has to name it to let it through.
    assert.deepEqual(
        sinkMessages('export const f = e => { console.error(e); throw new Error(e.message); };'),
        ['error: <expr>', 'throw: <expr>'],
    );
    // A class the registry names, imported under any name, throws its code:
    // its message is worded, and checked, in the package that defines it.
    assert.deepEqual(
        sinkMessages(
            `import { SzDepthError as Q } from '@csszyx/compiler/sz-limits';
            export const f = d => { if (d > 32) throw new Q(); };`,
        ),
        ['throw: [csszyx] sz-object-depth: '],
    );
});

test('a production bundle that throws prose fails, and one that throws its codes passes', () => {
    const entries = [
        {
            id: 'gone-key',
            surfaces: { error: { host: 'browser' } },
            sources: ['packages/thing/src/a.ts:1'],
        },
        {
            id: 'dev-only',
            surfaces: { error: { host: 'browser', production: false } },
            sources: ['packages/thing/src/a.ts:2'],
        },
    ];
    const codes = sizeGate.productionCodesOf(entries, new Set(['packages/thing/src/a.ts']));
    assert.deepEqual(codes, ['throw: [csszyx] gone-key: ']);
    const run = (body, extra = {}) => {
        const root = makeFixture({
            'packages/thing/package.json': JSON.stringify({
                name: 'thing',
                exports: { '.': { import: { default: './dist/index.mjs' } } },
            }),
            'packages/thing/dist/index.mjs':
                "import { CsszyxError } from '@csszyx/compiler/errors';\n" +
                'export function check(args) {\n' +
                '    if (!args) throw new CsszyxError({ code: "gone-key", args, message: ' +
                '`[csszyx] gone-key: ${JSON.stringify(args)} https://csszyx.com/e/gone-key` });\n' +
                `    ${body}\n` +
                '}\n',
        });
        try {
            return checkBudgets(appBudget('thing', { productionCodes: codes, ...extra }), root)
                .failures;
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };
    assert.deepEqual(run(''), []);
    const prose = run("if (args.x) throw new Error('csszyx could not read this value');");
    assert.equal(prose.length, 1, prose.join('\n'));
    assert.match(prose[0], /prints "throw: csszyx could not read this value"/);
    // A throw the registry keeps to development must fold out of production.
    const dev = run(
        'if (args.y) throw new CsszyxError({ code: "dev-only", args, message: ' +
            '`[csszyx] dev-only: ${JSON.stringify(args)} https://csszyx.com/e/dev-only` });',
    );
    assert.equal(dev.length, 1, dev.join('\n'));
    assert.match(dev[0], /prints "throw: \[csszyx\] dev-only: "/);
    // A passthrough is let through only by name, with the reason beside it.
    const passthrough = 'try { args.z(); } catch (e) { console.error(e); }';
    assert.equal(run(passthrough).length, 1);
    assert.deepEqual(run(passthrough, { passthroughSinks: ['error: <expr>'] }), []);
});

test('a file budget checks its sinks one way: registered codes, its own required', () => {
    const root = makeFixture({
        'packages/thing/dist/cdn.js':
            '(()=>{function f(a){if(!a)throw new SyntaxError(`[csszyx] one: ${JSON.stringify(a)} https://csszyx.com/e/one`);' +
            'try{a()}catch(e){console.error(e)}}window.f=f})();\n',
    });
    const budget = extra => [
        {
            name: 'thing CDN bundle',
            kind: 'file',
            target: 'packages/thing/dist/cdn.js',
            maxGzipBytes: 100_000,
            productionCodes: ['throw: [csszyx] one: ', 'warn: [csszyx] two: '],
            requiredCodes: ['throw: [csszyx] one: '],
            passthroughSinks: ['error: <expr>'],
            ...extra,
        },
    ];
    try {
        // `two` is allowed, not required: the file holds what its entry reaches.
        assert.deepEqual(checkBudgets(budget(), root).failures, []);
        const missing = checkBudgets(budget({ requiredCodes: ['warn: [csszyx] two: '] }), root);
        assert.equal(missing.failures.length, 1, missing.failures.join('\n'));
        assert.match(missing.failures[0], /no longer prints "warn: \[csszyx\] two: "/);
        const unlisted = checkBudgets(budget({ passthroughSinks: [] }), root);
        assert.equal(unlisted.failures.length, 1, unlisted.failures.join('\n'));
        assert.match(unlisted.failures[0], /prints "error: <expr>"/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('the CDN bundle reads its sinks against the registry, its passthrough named', () => {
    const cdn = SIZE_BUDGETS.find(budget => budget.name === 'csszyx CDN bundle');
    assert.ok(cdn.productionCodes.includes('throw: [csszyx] sz-attribute-syntax: '));
    assert.ok(cdn.productionCodes.includes('warn: [csszyx] removed-key: '));
    assert.ok(cdn.requiredCodes.includes('error: [csszyx] sz-attribute-syntax: '));
    assert.ok(cdn.requiredCodes.includes('throw: [csszyx] sz-attribute-syntax: '));
    // `reportUnreadable` prints an error it did not throw as it was thrown.
    assert.deepEqual(cdn.passthroughSinks, ['error: <expr>']);
    // The development bundle prints sentences by design and is not read.
    const dev = SIZE_BUDGETS.find(budget => budget.name === 'csszyx CDN development bundle');
    assert.equal(dev.productionCodes, undefined);
});
