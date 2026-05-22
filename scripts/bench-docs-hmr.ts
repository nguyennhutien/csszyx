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
import { type Browser, chromium, type Page } from 'playwright';

/**
 * Bench mode. `oxc` and `rust` exercise csszyx with the respective parser.
 * `no-csszyx` skips the csszyx plugin entirely (Tailwind-only baseline) so the
 * pipeline-profile report can attribute time to the rest of the Vite/Astro
 * chain instead of guessing at csszyx's share.
 */
type BenchMode = 'oxc' | 'rust' | 'no-csszyx';

const BENCH_MODES = ['oxc', 'rust', 'no-csszyx'] as const;

interface CliOptions {
    /** Number of measured component edits. */
    edits: number;
    /** Number of warmup edits before measuring. */
    warmups: number;
    /** Number of benchmark rounds; mode order alternates each round. */
    rounds: number;
    /** Base port used for the first dev server. */
    port: number;
    /** Output directory for the markdown report. */
    outDir: string;
}

interface HmrStats {
    /** Row label. */
    name: string;
    /** Bench mode under test. */
    parser: BenchMode;
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
    /** Number of measured edits that missed the HMR wait deadline. */
    timeouts: number;
    /** Number of benchmark rounds included in this row. */
    rounds: number;
    /** Number of benchmark rounds that failed completely. */
    failedRounds: number;
    /** Transform hook timing samples emitted by csszyx bench trace. */
    transformHookMs: number[];
    /** handleHotUpdate timing samples emitted by csszyx bench trace. */
    hotUpdateMs: number[];
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
        rounds: 1,
        port: 4329,
        outDir: '.agent/reports',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--edits') {
            parsed.edits = Math.max(1, Number(args[++i] ?? parsed.edits));
        } else if (arg === '--warmups') {
            parsed.warmups = Math.max(0, Number(args[++i] ?? parsed.warmups));
        } else if (arg === '--rounds') {
            parsed.rounds = Math.max(1, Number(args[++i] ?? parsed.rounds));
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
    const grouped = new Map<BenchMode, HmrStats[]>(
        BENCH_MODES.map(mode => [mode, [] as HmrStats[]]),
    );
    const modeCount = BENCH_MODES.length;
    for (let round = 0; round < opts.rounds; round++) {
        const order: BenchMode[] = rotateModes(round);
        for (const [index, mode] of order.entries()) {
            grouped
                .get(mode)
                ?.push(await runHmrCase(mode, opts.port + round * modeCount + index, opts));
        }
    }
    cleanupBenchFiles();
    return BENCH_MODES.map(mode => aggregateRows(mode, grouped.get(mode) ?? []));
}

/**
 * Rotates the bench-mode order so each round starts with a different mode.
 * Keeps the pairing fair across rounds without introducing a noise sweep.
 *
 * @param round zero-based round index
 * @returns rotated mode order
 */
function rotateModes(round: number): BenchMode[] {
    const order = [...BENCH_MODES];
    const shift = round % order.length;
    return [...order.slice(shift), ...order.slice(0, shift)];
}

/**
 * Runs one HMR benchmark for a bench mode.
 *
 * @param parser bench mode
 * @param port dev-server port
 * @param opts CLI options
 * @returns benchmark row
 */
async function runHmrCase(parser: BenchMode, port: number, opts: CliOptions): Promise<HmrStats> {
    let server: ChildProcessWithoutNullStreams | null = null;
    let browser: Browser | null = null;
    const logs: string[] = [];

    try {
        writeBenchFiles(0, undefined, parser);
        server = startDevServer(parser, port, logs);
        await waitForServer(port);

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${port}/hmr-bench`, {
            waitUntil: 'networkidle',
        });
        await page.waitForSelector('[data-testid="csszyx-hmr"]');
        await page.waitForTimeout(1_000);

        const samples: number[] = [];
        let timeouts = 0;
        const totalEdits = opts.warmups + opts.edits;
        for (let i = 1; i <= totalEdits; i++) {
            const label = `hmr-${parser}-${i}`;
            const started = performance.now();
            writeBenchFiles(i, label, parser);
            const timedOut = !(await waitForHmrText(page, label));
            const elapsed = performance.now() - started;
            if (i > opts.warmups) {
                samples.push(elapsed);
                if (timedOut) {
                    timeouts++;
                }
            }
        }

        return measuredRow(parser, samples, timeouts, parseTraceTimings(logs));
    } catch (error) {
        return failedRow(parser, error, logs);
    } finally {
        await browser?.close().catch(() => undefined);
        await stopDevServer(server);
        cleanupBenchFiles();
    }
}

/**
 * Waits for the edited label through HMR. On timeout, reload once to keep the
 * row running while preserving the slow sample and timeout count in the report.
 *
 * @param page browser page
 * @param label expected rendered text
 * @returns true when HMR updated before the deadline
 */
async function waitForHmrText(page: Page, label: string): Promise<boolean> {
    try {
        await waitForRenderedLabel(page, label, 10_000);
        return true;
    } catch {
        await recoverHmrPage(page, label);
        return false;
    }
}

/**
 * Waits until the benchmark component renders the expected label.
 *
 * @param page browser page
 * @param label expected rendered text
 * @param timeoutMs wait timeout
 */
async function waitForRenderedLabel(page: Page, label: string, timeoutMs: number): Promise<void> {
    await page.waitForFunction(
        expected =>
            document
                .querySelector('[data-testid="csszyx-hmr"]')
                ?.textContent?.includes(String(expected)) === true,
        label,
        { timeout: timeoutMs },
    );
}

/**
 * Reloads or navigates once after an HMR timeout. This keeps benchmark rows
 * measured while the timeout sample preserves the reliability cost.
 *
 * @param page browser page
 * @param label expected rendered text
 */
async function recoverHmrPage(page: Page, label: string): Promise<void> {
    try {
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-testid="csszyx-hmr"]');
        await waitForRenderedLabel(page, label, 5_000);
        return;
    } catch {
        // Fall through to a cache-busted navigation. If this also misses, keep
        // the timeout sample instead of failing the whole parser row.
    }

    try {
        const url = new URL(page.url());
        url.searchParams.set('hmrBenchRecover', String(Date.now()));
        await page.goto(url.toString(), { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-testid="csszyx-hmr"]');
        await waitForRenderedLabel(page, label, 5_000);
    } catch {
        // The caller records the slow timeout sample and continues.
    }
}

/**
 * Starts the docs Astro dev server.
 *
 * @param parser bench mode
 * @param port dev-server port
 * @param logs captured logs
 * @returns child process
 */
function startDevServer(
    parser: BenchMode,
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
                ...(parser === 'no-csszyx'
                    ? { CSSZYX_BENCH_NO_CSSZYX: '1' }
                    : {
                          CSSZYX_PARSER: parser,
                          CSSZYX_BENCH_TRACE: '1',
                          CSSZYX_BENCH_TRACE_FILE: '__CsszyxHmrBench.tsx',
                      }),
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
 * @param mode bench mode; `no-csszyx` emits Tailwind classes via className so
 *   the component still renders identical visuals without the csszyx plugin in
 *   the pipeline
 */
function writeBenchFiles(
    version: number,
    label = `hmr-setup-${version}`,
    mode: BenchMode = 'oxc',
): void {
    mkdirSync(dirname(BENCH_COMPONENT), { recursive: true });
    mkdirSync(dirname(BENCH_PAGE), { recursive: true });
    const palette = version % 2 === 0 ? 'red' : 'emerald';
    const padding = version + 1;
    const attribute =
        mode === 'no-csszyx'
            ? `className="p-${padding} bg-${palette}-500"`
            : `sz={{ p: ${padding}, bg: '${palette}-500' }}`;
    writeFileSync(
        BENCH_COMPONENT,
        `export default function CsszyxHmrBench() {
    return (
        <div
            data-testid="csszyx-hmr"
            ${attribute}
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
    if (!child) {
        return;
    }
    await new Promise<void>(resolveStop => {
        const killTimeout = setTimeout(() => {
            child.kill('SIGKILL');
        }, 2_000);
        const resolveTimeout = setTimeout(() => {
            resolveStop();
        }, 5_000);
        child.once('exit', () => {
            clearTimeout(killTimeout);
            clearTimeout(resolveTimeout);
            resolveStop();
        });
        child.kill('SIGTERM');
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
 * @param parser bench mode
 * @param samples raw samples
 * @param timeouts measured HMR wait timeouts
 * @param traceTimings csszyx trace timing samples
 * @returns stats row
 */
function measuredRow(
    parser: BenchMode,
    samples: number[],
    timeouts: number,
    traceTimings: TraceTimings,
): HmrStats {
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
        timeouts,
        transformHookMs: traceTimings.transformHookMs,
        hotUpdateMs: traceTimings.hotUpdateMs,
        rounds: 1,
        failedRounds: 0,
        status: 'measured',
        note:
            timeouts === 0
                ? 'Save-to-browser text update through Astro dev server and Chromium.'
                : `Save-to-browser text update; ${timeouts} measured edit(s) required reload recovery after HMR timeout.`,
    };
}

interface TraceTimings {
    /** Transform hook timing samples. */
    transformHookMs: number[];
    /** handleHotUpdate timing samples. */
    hotUpdateMs: number[];
}

/**
 * Parses opt-in csszyx benchmark trace logs.
 *
 * @param logs captured dev-server logs
 * @returns trace timing samples
 */
function parseTraceTimings(logs: string[]): TraceTimings {
    const timings: TraceTimings = { transformHookMs: [], hotUpdateMs: [] };
    const pattern = /\[csszyx:bench\]\s+(transform-hook|handle-hot-update)\s+([\d.]+)ms/g;
    for (const chunk of logs) {
        for (const match of chunk.matchAll(pattern)) {
            const value = Number(match[2]);
            if (!Number.isFinite(value)) {
                continue;
            }
            if (match[1] === 'transform-hook') {
                timings.transformHookMs.push(value);
            } else {
                timings.hotUpdateMs.push(value);
            }
        }
    }
    return timings;
}

/**
 * Creates a failed stats row.
 *
 * @param parser bench mode
 * @param error thrown error
 * @param logs captured dev-server logs
 * @returns failed row
 */
function failedRow(parser: BenchMode, error: unknown, logs: string[]): HmrStats {
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
        timeouts: 0,
        transformHookMs: [],
        hotUpdateMs: [],
        rounds: 1,
        failedRounds: 1,
        status: 'failed',
        note: `${message}${logSummary ? `; ${logSummary}` : ''}`.slice(0, 240),
    };
}

/**
 * Aggregates bench-mode rows across repeated benchmark rounds.
 *
 * @param parser bench mode
 * @param rows per-round rows
 * @returns aggregate row
 */
function aggregateRows(parser: BenchMode, rows: HmrStats[]): HmrStats {
    const measured = rows.filter(row => row.status === 'measured');
    if (measured.length === 0) {
        const firstFailure = rows.find(row => row.status === 'failed');
        return {
            ...(firstFailure ?? failedRow(parser, new Error('no benchmark rows produced'), [])),
            rounds: rows.length,
            failedRounds: rows.length,
        };
    }

    const samples = measured.flatMap(row => row.samplesMs);
    const traceTimings: TraceTimings = {
        transformHookMs: measured.flatMap(row => row.transformHookMs),
        hotUpdateMs: measured.flatMap(row => row.hotUpdateMs),
    };
    const row = measuredRow(
        parser,
        samples,
        measured.reduce((sum, item) => sum + item.timeouts, 0),
        traceTimings,
    );
    row.rounds = rows.length;
    row.failedRounds = rows.length - measured.length;
    const failureNote = rows.find(item => item.status === 'failed')?.note;
    row.note =
        row.failedRounds === 0
            ? `Aggregated across ${row.rounds} round(s); parser order alternated per round.`
            : `Aggregated across ${measured.length}/${row.rounds} successful round(s); ${row.failedRounds} round(s) failed${failureNote ? `: ${failureNote}` : ''}.`;
    return row;
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
    const baseline = rows.find(row => row.parser === 'no-csszyx');
    const traceRows = rows.filter(row => row.parser !== 'no-csszyx');

    return `# Phase E Docs HMR Benchmark

Generated: ${new Date().toISOString()}

Environment:
- Node: ${process.version}
- Platform: ${process.platform}-${process.arch}
- CPU parallelism: ${availableParallelism()}
- Edits: ${opts.edits}
- Warmups: ${opts.warmups}
- Rounds: ${opts.rounds}

## Summary

- Docs HMR p95: ${formatComparison(oxc, rust, 'p95Ms')}.
- Docs HMR median: ${formatComparison(oxc, rust, 'medianMs')}.
- Tailwind-only baseline (no csszyx) p95: ${formatBaselineComparison(baseline, oxc, rust, 'p95Ms')}.
- Tailwind-only baseline (no csszyx) median: ${formatBaselineComparison(baseline, oxc, rust, 'medianMs')}.

This benchmark starts the real Astro docs dev server, opens Chromium, edits a
temporary React component, and measures from file write to the browser
observing the updated text. The \`no-csszyx\` row skips the csszyx plugin
entirely and uses a Tailwind \`className\` form of the same component so the
remaining Vite/Astro/Tailwind/React pipeline cost is visible on its own.

## Results

| Case | Status | Median ms | p95 ms | Mean ms | Min ms | Max ms | Rounds | Failed rounds | Timeouts | Samples ms | Note |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${rows.map(renderRow).join('\n')}

## csszyx Trace

| Case | Transform hook median | Transform hook p95 | handleHotUpdate median | handleHotUpdate p95 | Samples |
|---|---:|---:|---:|---:|---|
${traceRows.map(renderTraceRow).join('\n')}

## Interpretation

- The measured path includes filesystem write, Vite/Astro invalidation,
  csszyx transform, HMR transport, React refresh, and browser DOM update.
- The csszyx trace is opt-in instrumentation from the unplugin and is filtered
  to the temporary HMR bench component; \`no-csszyx\` does not load the plugin
  so there is no trace row for it.
- The Tailwind-only baseline isolates the floor of the Astro/Vite/Tailwind/
  React refresh chain. If oxc and rust rows are near that floor, parser
  micro-optimization cannot move the user-visible HMR p95 further; the
  bottleneck lives outside csszyx.
- This is broader than the compiler HMR-shaped microbenchmark and is the p95
  gate needed before considering an R8 default flip.
`;
}

/**
 * Formats the no-csszyx baseline comparison line. Reports the ratio against
 * both csszyx parser modes when measured, so the report header is enough to
 * judge whether csszyx is or is not a meaningful share of the HMR path.
 *
 * @param baseline no-csszyx row
 * @param oxc csszyx oxc row
 * @param rust csszyx rust row
 * @param field metric field
 * @returns comparison line
 */
function formatBaselineComparison(
    baseline: HmrStats | undefined,
    oxc: HmrStats | undefined,
    rust: HmrStats | undefined,
    field: 'medianMs' | 'p95Ms',
): string {
    if (!baseline || baseline.status !== 'measured') {
        return 'not measured successfully';
    }
    const parts: string[] = [`${formatMs(baseline[field])} (Tailwind only)`];
    if (oxc && oxc.status === 'measured') {
        parts.push(`csszyx oxc is ${formatRatio(oxc[field] / baseline[field])} vs baseline`);
    }
    if (rust && rust.status === 'measured') {
        parts.push(`csszyx rust is ${formatRatio(rust[field] / baseline[field])} vs baseline`);
    }
    return parts.join('; ');
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
    return `| \`${row.name}\` | ${row.status} | ${formatMs(row.medianMs)} | ${formatMs(row.p95Ms)} | ${formatMs(row.meanMs)} | ${formatMs(row.minMs)} | ${formatMs(row.maxMs)} | ${row.rounds} | ${row.failedRounds} | ${row.timeouts} | ${row.samplesMs.map(formatMs).join(', ') || '-'} | ${row.note} |`;
}

/**
 * Renders one trace timing row.
 *
 * @param row stats row
 * @returns markdown table row
 */
function renderTraceRow(row: HmrStats): string {
    const transformSorted = [...row.transformHookMs].sort((a, b) => a - b);
    const hotUpdateSorted = [...row.hotUpdateMs].sort((a, b) => a - b);
    return `| \`${row.name}\` | ${formatMs(percentile(transformSorted, 0.5))} | ${formatMs(percentile(transformSorted, 0.95))} | ${formatMs(percentile(hotUpdateSorted, 0.5))} | ${formatMs(percentile(hotUpdateSorted, 0.95))} | transform=${row.transformHookMs.length}, hotUpdate=${row.hotUpdateMs.length} |`;
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
