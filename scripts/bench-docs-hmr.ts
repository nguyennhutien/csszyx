#!/usr/bin/env tsx
/**
 * Benchmarks apps/docs dev-server HMR latency across csszyx parser modes.
 *
 * Usage:
 *   pnpm bench:docs-hmr
 *   pnpm bench:docs-hmr -- --edits 20 --warmups 3
 */

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';

type ParserMode = 'oxc' | 'rust';

interface CliOptions {
    /** Number of measured component edits. */
    edits: number;
    /** Number of warmup edits before measuring. */
    warmups: number;
    /** Base port used for the first dev server. */
    port: number;
    /** Output directory for the markdown report. */
    outDir: string;
}

interface HmrStats {
    /** Row label. */
    name: string;
    /** Parser mode under test. */
    parser: ParserMode;
    /** Median save-to-browser-update latency. */
    medianMs: number;
    /** p95 save-to-browser-update latency. */
    p95Ms: number;
    /** Mean save-to-browser-update latency. */
    meanMs: number;
    /** Minimum latency. */
    minMs: number;
    /** Maximum latency. */
    maxMs: number;
    /** Raw samples. */
    samplesMs: number[];
    /** Row status. */
    status: 'measured' | 'failed';
    /** Short note or failure diagnostic. */
    note: string;
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS_ROOT = join(REPO_ROOT, 'apps/docs');
const BENCH_COMPONENT = join(DOCS_ROOT, 'src/components/__CsszyxHmrBench.tsx');
const BENCH_PAGE = join(DOCS_ROOT, 'src/pages/hmr-bench.astro');

const options = parseArgs(process.argv.slice(2));
const stats = await runBenchmarks(options);
mkdirSync(resolve(REPO_ROOT, options.outDir), { recursive: true });
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-docs-hmr-bench.md'),
    renderReport(stats, options),
    'utf8',
);
console.log(`Wrote ${join(options.outDir, 'phase-e-docs-hmr-bench.md')}`);

/**
 * Parses CLI options.
 *
 * @param args CLI args after node/script
 * @returns parsed options
 */
function parseArgs(args: string[]): CliOptions {
    const parsed: CliOptions = {
        edits: 20,
        warmups: 3,
        port: 4329,
        outDir: '.agent/reports',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--edits') {
            parsed.edits = Math.max(1, Number(args[++i] ?? parsed.edits));
        } else if (arg === '--warmups') {
            parsed.warmups = Math.max(0, Number(args[++i] ?? parsed.warmups));
        } else if (arg === '--port') {
            parsed.port = Math.max(1024, Number(args[++i] ?? parsed.port));
        } else if (arg === '--out-dir') {
            parsed.outDir = args[++i] ?? parsed.outDir;
        }
    }

    return parsed;
}

/**
 * Runs HMR benchmarks for all parser modes.
 *
 * @param opts CLI options
 * @returns benchmark rows
 */
async function runBenchmarks(opts: CliOptions): Promise<HmrStats[]> {
    const rows: HmrStats[] = [];
    for (const [index, parser] of (['oxc', 'rust'] as const).entries()) {
        rows.push(await runHmrCase(parser, opts.port + index, opts));
    }
    cleanupBenchFiles();
    return rows;
}

/**
 * Runs one parser HMR benchmark.
 *
 * @param parser parser mode
 * @param port dev-server port
 * @param opts CLI options
 * @returns benchmark row
 */
async function runHmrCase(parser: ParserMode, port: number, opts: CliOptions): Promise<HmrStats> {
    let server: ChildProcessWithoutNullStreams | null = null;
    let browser: Browser | null = null;
    const logs: string[] = [];

    try {
        writeBenchFiles(0);
        server = startDevServer(parser, port, logs);
        await waitForServer(port);

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${port}/hmr-bench`, {
            waitUntil: 'networkidle',
        });
        await page.waitForSelector('[data-testid="csszyx-hmr"]');

        const samples: number[] = [];
        const totalEdits = opts.warmups + opts.edits;
        for (let i = 1; i <= totalEdits; i++) {
            const label = `hmr-${parser}-${i}`;
            const started = performance.now();
            writeBenchFiles(i, label);
            await page.waitForFunction(
                expected =>
                    document
                        .querySelector('[data-testid="csszyx-hmr"]')
                        ?.textContent?.includes(String(expected)) === true,
                label,
                { timeout: 10_000 },
            );
            const elapsed = performance.now() - started;
            if (i > opts.warmups) {
                samples.push(elapsed);
            }
        }

        return measuredRow(parser, samples);
    } catch (error) {
        return failedRow(parser, error, logs);
    } finally {
        await browser?.close().catch(() => undefined);
        await stopDevServer(server);
        cleanupBenchFiles();
    }
}

/**
 * Starts the docs Astro dev server.
 *
 * @param parser parser mode
 * @param port dev-server port
 * @param logs captured logs
 * @returns child process
 */
function startDevServer(
    parser: ParserMode,
    port: number,
    logs: string[],
): ChildProcessWithoutNullStreams {
    spawnSync('pnpm', ['run', 'predev'], {
        cwd: DOCS_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const child = spawn(
        'pnpm',
        ['exec', 'astro', 'dev', '--host', '127.0.0.1', '--port', String(port)],
        {
            cwd: DOCS_ROOT,
            env: {
                ...process.env,
                CSSZYX_PARSER: parser,
                NODE_ENV: 'development',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    child.stdout.on('data', chunk => logs.push(String(chunk)));
    child.stderr.on('data', chunk => logs.push(String(chunk)));
    return child;
}

/**
 * Waits until the dev server responds.
 *
 * @param port dev-server port
 */
async function waitForServer(port: number): Promise<void> {
    const deadline = performance.now() + 60_000;
    let lastError: unknown;
    while (performance.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/hmr-bench`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            lastError = error;
        }
        await delay(250);
    }
    throw new Error(`dev server did not start on port ${port}: ${String(lastError)}`);
}

/**
 * Writes the temporary benchmark page/component.
 *
 * @param version version number used to change source
 * @param label text rendered by the component
 */
function writeBenchFiles(version: number, label = `hmr-setup-${version}`): void {
    mkdirSync(dirname(BENCH_COMPONENT), { recursive: true });
    mkdirSync(dirname(BENCH_PAGE), { recursive: true });
    writeFileSync(
        BENCH_COMPONENT,
        `export default function CsszyxHmrBench() {
    return (
        <div
            data-testid="csszyx-hmr"
            sz={{ p: ${version + 1}, bg: '${version % 2 === 0 ? 'red' : 'emerald'}-500' }}
        >
            ${JSON.stringify(label)}
        </div>
    );
}
`,
        'utf8',
    );
    writeFileSync(
        BENCH_PAGE,
        `---
import CsszyxHmrBench from '../components/__CsszyxHmrBench';
---

<html>
    <body>
        <CsszyxHmrBench client:load />
    </body>
</html>
`,
        'utf8',
    );
}

/**
 * Removes temporary benchmark files.
 */
function cleanupBenchFiles(): void {
    rmSync(BENCH_COMPONENT, { force: true });
    rmSync(BENCH_PAGE, { force: true });
}

/**
 * Stops a dev server child process.
 *
 * @param child child process
 */
async function stopDevServer(child: ChildProcessWithoutNullStreams | null): Promise<void> {
    if (!child || child.killed) {
        return;
    }
    await new Promise<void>(resolveStop => {
        const timeout = setTimeout(() => {
            if (!child.killed) {
                child.kill('SIGKILL');
            }
            resolveStop();
        }, 2_000);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolveStop();
        });
        child.kill('SIGTERM');
        if (!child.killed) {
            child.kill('SIGKILL');
        }
    });
}

/**
 * Resolves after a delay.
 *
 * @param ms milliseconds
 */
async function delay(ms: number): Promise<void> {
    await new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

/**
 * Creates a measured stats row.
 *
 * @param parser parser mode
 * @param samples raw samples
 * @returns stats row
 */
function measuredRow(parser: ParserMode, samples: number[]): HmrStats {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
        name: `docs-hmr/${parser}`,
        parser,
        medianMs: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
        meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        samplesMs: samples,
        status: 'measured',
        note: 'Save-to-browser text update through Astro dev server and Chromium.',
    };
}

/**
 * Creates a failed stats row.
 *
 * @param parser parser mode
 * @param error thrown error
 * @param logs captured dev-server logs
 * @returns failed row
 */
function failedRow(parser: ParserMode, error: unknown, logs: string[]): HmrStats {
    const message = error instanceof Error ? error.message : String(error);
    const logSummary = summarizeLogs(logs);
    return {
        name: `docs-hmr/${parser}`,
        parser,
        medianMs: Number.NaN,
        p95Ms: Number.NaN,
        meanMs: Number.NaN,
        minMs: Number.NaN,
        maxMs: Number.NaN,
        samplesMs: [],
        status: 'failed',
        note: `${message}${logSummary ? `; ${logSummary}` : ''}`.slice(0, 240),
    };
}

/**
 * Summarizes dev-server logs.
 *
 * @param logs captured logs
 * @returns short summary
 */
function summarizeLogs(logs: string[]): string {
    const lines = logs
        .join('\n')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return (
        lines.find(line => /csszyx|native|parser|error/i.test(line)) ??
        lines.at(-1) ??
        ''
    ).slice(0, 180);
}

/**
 * Calculates a percentile from sorted samples.
 *
 * @param sorted sorted samples
 * @param p percentile in [0, 1]
 * @returns percentile value
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
        return Number.NaN;
    }
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
    return sorted[index] ?? Number.NaN;
}

/**
 * Renders benchmark report markdown.
 *
 * @param rows benchmark rows
 * @param opts CLI options
 * @returns markdown report
 */
function renderReport(rows: HmrStats[], opts: CliOptions): string {
    const oxc = rows.find(row => row.parser === 'oxc');
    const rust = rows.find(row => row.parser === 'rust');

    return `# Phase E Docs HMR Benchmark

Generated: ${new Date().toISOString()}

Environment:
- Node: ${process.version}
- Platform: ${process.platform}-${process.arch}
- CPU parallelism: ${availableParallelism()}
- Edits: ${opts.edits}
- Warmups: ${opts.warmups}

## Summary

- Docs HMR p95: ${formatComparison(oxc, rust, 'p95Ms')}.
- Docs HMR median: ${formatComparison(oxc, rust, 'medianMs')}.

This benchmark starts the real Astro docs dev server, opens Chromium, edits a
temporary React component that uses \`sz\`, and measures from file write to the
browser observing the updated text.

## Results

| Case | Status | Median ms | p95 ms | Mean ms | Min ms | Max ms | Samples ms | Note |
|---|---|---:|---:|---:|---:|---:|---|---|
${rows.map(renderRow).join('\n')}

## Interpretation

- The measured path includes filesystem write, Vite/Astro invalidation,
  csszyx transform, HMR transport, React refresh, and browser DOM update.
- This is broader than the compiler HMR-shaped microbenchmark and is the p95
  gate needed before considering an R8 default flip.
`;
}

/**
 * Formats rust-vs-oxc comparison text.
 *
 * @param oxc oxc row
 * @param rust rust row
 * @param field metric field
 * @returns comparison text
 */
function formatComparison(
    oxc: HmrStats | undefined,
    rust: HmrStats | undefined,
    field: 'medianMs' | 'p95Ms',
): string {
    if (!oxc || !rust || oxc.status !== 'measured' || rust.status !== 'measured') {
        return 'not measured successfully';
    }
    return `rust is ${formatRatio(oxc[field] / rust[field])} vs oxc`;
}

/**
 * Renders one table row.
 *
 * @param row stats row
 * @returns markdown table row
 */
function renderRow(row: HmrStats): string {
    return `| \`${row.name}\` | ${row.status} | ${formatMs(row.medianMs)} | ${formatMs(row.p95Ms)} | ${formatMs(row.meanMs)} | ${formatMs(row.minMs)} | ${formatMs(row.maxMs)} | ${row.samplesMs.map(formatMs).join(', ') || '-'} | ${row.note} |`;
}

/**
 * Formats milliseconds.
 *
 * @param value milliseconds
 * @returns formatted milliseconds
 */
function formatMs(value: number): string {
    if (!Number.isFinite(value)) {
        return '-';
    }
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : value.toFixed(1);
}

/**
 * Formats a speed ratio.
 *
 * @param ratio speed ratio
 * @returns formatted ratio
 */
function formatRatio(ratio: number): string {
    if (!Number.isFinite(ratio)) {
        return 'n/a';
    }
    return `${ratio.toFixed(2)}x`;
}
