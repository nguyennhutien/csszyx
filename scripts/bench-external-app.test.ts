import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    collectOutputStats,
    parseExternalBenchArgs,
    renderExternalBenchMarkdown,
    resolveSafeOutputDirectories,
    runExternalBenchmark,
} from './bench-external-app.js';

test('parses the native and wasm benchmark contract', () => {
    const options = parseExternalBenchArgs([
        '--',
        '--cwd',
        '../app',
        '--build',
        'pnpm build',
        '--out',
        'dist,.next/static',
        '--modes',
        'rust,wasm',
        '--mangle-vars',
        'off,on',
        '--iterations',
        '4',
        '--warmups',
        '2',
        '--report',
        '.agent/reports/app.md',
    ]);

    assert.deepEqual(options.modes, ['rust', 'wasm']);
    assert.deepEqual(options.mangleVars, ['off', 'on']);
    assert.deepEqual(options.outputs, ['dist', '.next/static']);
    assert.equal(options.iterations, 4);
    assert.equal(options.warmups, 2);
    assert.equal(options.report, '.agent/reports/app.md');
});

test('rejects missing required options and unknown modes', () => {
    assert.throws(() => parseExternalBenchArgs([]), /--cwd/);
    assert.throws(
        () =>
            parseExternalBenchArgs([
                '--cwd',
                '.',
                '--build',
                'pnpm build',
                '--out',
                'dist',
                '--unknown',
                'value',
            ]),
        /Unknown option "--unknown"/,
    );
    assert.throws(
        () =>
            parseExternalBenchArgs([
                '--cwd',
                '.',
                '--build',
                'pnpm build',
                '--out',
                'dist',
                '--modes',
                'rust,babel',
            ]),
        /Unknown --modes value "babel"/,
    );
});

test('allows only explicit untracked output directories inside the app', t => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'csszyx-external-safe-'));
    t.after(() => rmSync(app, { recursive: true, force: true }));

    assert.deepEqual(resolveSafeOutputDirectories(app, ['dist'], []), [path.join(app, 'dist')]);
    assert.throws(() => resolveSafeOutputDirectories(app, ['.'], []), /project root/);
    assert.throws(() => resolveSafeOutputDirectories(app, ['../outside'], []), /outside/);
    assert.throws(
        () => resolveSafeOutputDirectories(app, ['dist'], ['dist/committed.js']),
        /tracked file/,
    );
    writeFileSync(path.join(app, 'bundle.js'), 'output');
    assert.throws(() => resolveSafeOutputDirectories(app, ['bundle.js'], []), /directory/);
});

test('collects raw, gzip, and brotli bytes across declared outputs', t => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'csszyx-external-size-'));
    t.after(() => rmSync(app, { recursive: true, force: true }));
    mkdirSync(path.join(app, 'dist'));
    writeFileSync(path.join(app, 'dist/app.js'), 'const repeated = "aaaaaaaaaaaaaaaa";\n');

    const stats = collectOutputStats([path.join(app, 'dist')]);
    assert.equal(stats.files, 1);
    assert.ok(stats.bytes > 0);
    assert.ok(stats.gzipBytes > 0);
    assert.ok(stats.brotliBytes > 0);
});

test('runs both engine artifacts without touching external source files', async t => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'csszyx-external-run-'));
    t.after(() => rmSync(app, { recursive: true, force: true }));
    writeFileSync(path.join(app, 'source.txt'), 'do not modify\n');
    writeFileSync(
        path.join(app, 'build.mjs'),
        `import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/result.txt', process.env.CSSZYX_PARSER + ':' + process.env.CSSZYX_BENCH_MANGLE_VARS);
console.log('[csszyx] active parser: ' + process.env.CSSZYX_PARSER);
if (process.env.CSSZYX_BENCH_TRACE === '1') console.log('[csszyx:bench] prescan 1.234ms fixture');
`,
    );

    const payload = await runExternalBenchmark({
        cwd: app,
        build: 'node build.mjs',
        outputs: ['dist'],
        modes: ['rust', 'wasm'],
        mangleVars: ['off'],
        iterations: 2,
        warmups: 0,
        report: path.join(app, 'report.md'),
        trace: true,
    });

    assert.equal(readFileSync(path.join(app, 'source.txt'), 'utf8'), 'do not modify\n');
    assert.deepEqual(
        payload.rows.map(row => [row.parser, row.status, row.parserSupport, row.samplesMs.length]),
        [
            ['rust', 'measured', 'observed', 2],
            ['wasm', 'measured', 'observed', 2],
        ],
    );
    assert.deepEqual(payload.rows[0]?.traceLines, ['[csszyx:bench] prescan 1.234ms fixture']);
    assert.equal(payload.rows[0]?.outputStable, true);
});

test('fails a row whose declared build output was never created', async t => {
    const app = mkdtempSync(path.join(os.tmpdir(), 'csszyx-external-missing-output-'));
    t.after(() => rmSync(app, { recursive: true, force: true }));
    writeFileSync(path.join(app, 'build.mjs'), "console.log('[csszyx] active parser: rust');\n");

    const payload = await runExternalBenchmark({
        cwd: app,
        build: 'node build.mjs',
        outputs: ['dist'],
        modes: ['rust'],
        mangleVars: ['off'],
        iterations: 1,
        warmups: 0,
        report: path.join(app, 'report.md'),
        trace: false,
    });

    assert.equal(payload.rows[0]?.status, 'failed');
    assert.match(payload.rows[0]?.note ?? '', /no files/i);
});

test('renders compressed size and support status in the human report', () => {
    const markdown = renderExternalBenchMarkdown({
        generated: '2026-08-14T00:00:00.000Z',
        node: 'v24.0.0',
        platform: 'linux-arm64',
        cpuParallelism: 8,
        gitHead: null,
        options: {
            cwd: '/app',
            build: 'pnpm build',
            outputs: ['dist'],
            modes: ['rust'],
            mangleVars: ['off'],
            iterations: 1,
            warmups: 0,
            report: '/report.md',
            trace: false,
        },
        rows: [
            {
                parser: 'rust',
                mangleVars: 'off',
                status: 'measured',
                parserSupport: 'not-observed',
                mangleVarsSupport: 'not-measured',
                samplesMs: [100],
                medianMs: 100,
                meanMs: 100,
                minMs: 100,
                maxMs: 100,
                output: { files: 1, bytes: 1000, gzipBytes: 400, brotliBytes: 350 },
                outputHashes: ['abc'],
                outputStable: true,
                traceLines: [],
                note: 'Build succeeded; parser banner was not observed.',
            },
        ],
    });

    assert.match(markdown, /Gzip bytes/);
    assert.match(markdown, /Brotli bytes/);
    assert.match(markdown, /not-observed/);
});
