#!/usr/bin/env tsx

/**
 * Benchmarks apps/docs production build wall time across csszyx parser modes.
 *
 * Usage:
 *   pnpm bench:docs-build
 *   pnpm bench:docs-build -- --iterations 3 --warmups 1
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

/**
 * Bench mode. `oxc` and `rust` exercise csszyx with the respective parser.
 * `no-csszyx` skips the csszyx plugin (Tailwind-only baseline) so the report
 * can show the build-pipeline floor without csszyx in the chain.
 */
type BenchMode = 'oxc' | 'rust' | 'no-csszyx';
type BuildShape = 'cold' | 'warm';

const BENCH_MODES = ['oxc', 'rust', 'no-csszyx'] as const;

interface CliOptions {
    /** Number of measured iterations per parser/build shape. */
    iterations: number;
    /** Number of warmup builds per parser/build shape. */
    warmups: number;
    /** Output directory for the markdown report. */
    outDir: string;
}

interface BuildStats {
    /** Row label. */
    name: string;
    /** Bench mode under test. */
    parser: BenchMode;
    /** Cold clears build/cache output; warm preserves parser cache after warmup. */
    shape: BuildShape;
    /** Median wall time in milliseconds. */
    medianMs: number;
    /** Mean wall time in milliseconds. */
    meanMs: number;
    /** Minimum wall time in milliseconds. */
    minMs: number;
    /** Maximum wall time in milliseconds. */
    maxMs: number;
    /** Raw measured samples. */
    samplesMs: number[];
    /** Row status. */
    status: 'measured' | 'failed';
    /** Short note or failure diagnostic. */
    note: string;
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS_ROOT = join(REPO_ROOT, 'apps/docs');
const BUILD_OUTPUTS = [
    join(DOCS_ROOT, 'dist'),
    join(DOCS_ROOT, '.astro'),
    join(DOCS_ROOT, '.csszyx/cache/transform'),
];

const options = parseArgs(process.argv.slice(2));
const stats = runBenchmarks(options);
mkdirSync(resolve(REPO_ROOT, options.outDir), { recursive: true });
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-docs-build-bench.md'),
    renderReport(stats, options),
    'utf8',
);
console.log(`Wrote ${join(options.outDir, 'phase-e-docs-build-bench.md')}`);

/**
 * Parses CLI options.
 *
 * @param args CLI args after node/script
 * @returns parsed options
 */
function parseArgs(args: string[]): CliOptions {
    const parsed: CliOptions = {
        iterations: 3,
        warmups: 1,
        outDir: '.agent/reports',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--iterations') {
            parsed.iterations = Math.max(1, Number(args[++i] ?? parsed.iterations));
        } else if (arg === '--warmups') {
            parsed.warmups = Math.max(0, Number(args[++i] ?? parsed.warmups));
        } else if (arg === '--out-dir') {
            parsed.outDir = args[++i] ?? parsed.outDir;
        }
    }

    return parsed;
}

/**
 * Runs cold and warm docs build benchmarks.
 *
 * @param opts CLI options
 * @returns benchmark rows
 */
function runBenchmarks(opts: CliOptions): BuildStats[] {
    const rows: BuildStats[] = [];
    for (const parser of BENCH_MODES) {
        rows.push(runBuildCase(parser, 'cold', opts));
        rows.push(runBuildCase(parser, 'warm', opts));
    }
    return rows;
}

/**
 * Runs one bench-mode/build-shape case.
 *
 * @param parser bench mode
 * @param shape build shape
 * @param opts CLI options
 * @returns benchmark row
 */
function runBuildCase(parser: BenchMode, shape: BuildShape, opts: CliOptions): BuildStats {
    const samples: number[] = [];
    const totalRuns = opts.warmups + opts.iterations;

    if (shape === 'warm') {
        cleanBuildOutputs();
    }

    for (let i = 0; i < totalRuns; i++) {
        if (shape === 'cold') {
            cleanBuildOutputs();
        } else {
            rmSync(join(DOCS_ROOT, 'dist'), { force: true, recursive: true });
            rmSync(join(DOCS_ROOT, '.astro'), { force: true, recursive: true });
        }

        const started = performance.now();
        const result = spawnSync('pnpm', ['--filter', '@csszyx/docs', 'build'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            env: {
                ...process.env,
                ...(parser === 'no-csszyx'
                    ? { CSSZYX_BENCH_NO_CSSZYX: '1' }
                    : { CSSZYX_PARSER: parser }),
                NODE_ENV: 'production',
            },
            maxBuffer: 32 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const elapsed = performance.now() - started;

        if (result.status !== 0) {
            return failedRow(parser, shape, samples, result.stderr || result.stdout);
        }
        if (i >= opts.warmups) {
            samples.push(elapsed);
        }
    }

    return measuredRow(parser, shape, samples);
}

/**
 * Clears build and parser-cache outputs for a cold build sample.
 */
function cleanBuildOutputs(): void {
    for (const output of BUILD_OUTPUTS) {
        rmSync(output, { force: true, recursive: true });
    }
}

/**
 * Builds a measured stats row.
 *
 * @param parser parser mode
 * @param shape build shape
 * @param samples raw wall time samples
 * @returns stats row
 */
function measuredRow(parser: BenchMode, shape: BuildShape, samples: number[]): BuildStats {
    const sorted = [...samples].sort((a, b) => a - b);
    const medianMs =
        sorted.length % 2 === 0
            ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
            : (sorted[Math.floor(sorted.length / 2)] ?? 0);
    const meanMs = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    return {
        name: `docs-build/${shape}/${parser}`,
        parser,
        shape,
        medianMs,
        meanMs,
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        samplesMs: samples,
        status: 'measured',
        note:
            shape === 'cold'
                ? 'Clears dist, Astro cache, and csszyx transform cache before every measured build.'
                : 'Preserves csszyx transform cache after warmup; clears generated build output only.',
    };
}

/**
 * Builds a failed stats row.
 *
 * @param parser parser mode
 * @param shape build shape
 * @param samples completed samples before failure
 * @param output process output
 * @returns failed stats row
 */
function failedRow(
    parser: BenchMode,
    shape: BuildShape,
    samples: number[],
    output: string,
): BuildStats {
    return {
        name: `docs-build/${shape}/${parser}`,
        parser,
        shape,
        medianMs: Number.NaN,
        meanMs: Number.NaN,
        minMs: Number.NaN,
        maxMs: Number.NaN,
        samplesMs: samples,
        status: 'failed',
        note: summarizeFailure(output),
    };
}

/**
 * Keeps failure output short enough for the report table.
 *
 * @param output process output
 * @returns short failure summary
 */
function summarizeFailure(output: string): string {
    const lines = output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const relevant = lines.find(line =>
        /csszyx|native|parser|Use build\.parser|error:/i.test(line),
    );
    return (relevant ?? lines.at(-1) ?? 'build failed').slice(0, 240);
}

/**
 * Renders benchmark report markdown.
 *
 * @param rows benchmark rows
 * @param opts CLI options
 * @returns markdown report
 */
function renderReport(rows: BuildStats[], opts: CliOptions): string {
    const coldOxc = findRow(rows, 'oxc', 'cold');
    const coldRust = findRow(rows, 'rust', 'cold');
    const coldBaseline = findRow(rows, 'no-csszyx', 'cold');
    const warmOxc = findRow(rows, 'oxc', 'warm');
    const warmRust = findRow(rows, 'rust', 'warm');
    const warmBaseline = findRow(rows, 'no-csszyx', 'warm');

    return `# Phase E Docs Build Benchmark

Generated: ${new Date().toISOString()}

Environment:
- Node: ${process.version}
- Platform: ${process.platform}-${process.arch}
- CPU parallelism: ${availableParallelism()}
- Iterations: ${opts.iterations}
- Warmups: ${opts.warmups}

## Summary

- Cold docs build: ${formatComparison(coldOxc, coldRust)}.
- Warm docs build: ${formatComparison(warmOxc, warmRust)}.
- Cold Tailwind-only baseline (no csszyx): ${formatBaselineComparison(coldBaseline, coldOxc, coldRust)}.
- Warm Tailwind-only baseline (no csszyx): ${formatBaselineComparison(warmBaseline, warmOxc, warmRust)}.

This is an end-to-end production build wall-time benchmark for \`apps/docs\`.
It includes Astro, Vite, Tailwind, csszyx, file IO, build output generation,
and plugin finalization. The \`no-csszyx\` rows skip the csszyx plugin entirely
so the remaining Astro/Vite/Tailwind/React pipeline cost is visible as a floor.

## Results

| Case | Status | Median ms | Mean ms | Min ms | Max ms | Samples ms | Note |
|---|---|---:|---:|---:|---:|---|---|
${rows.map(renderRow).join('\n')}

## Interpretation

- Cold rows clear \`apps/docs/dist\`, \`apps/docs/.astro\`, and the csszyx
  transform cache before every measured build.
- Warm rows preserve the csszyx transform cache after warmup while clearing
  generated build output, so they approximate repeated production rebuilds more
  than dev-server HMR.
- The \`no-csszyx\` rows do not load the csszyx plugin; sz props in source stay
  inert and Tailwind keeps scanning regular classNames in the source tree. The
  rows isolate the build-pipeline floor and let csszyx-vs-baseline ratios show
  whether csszyx is a meaningful share of wall time.
- This report does not measure warm HMR p95. Keep R8 default flip gated until a
  dev-server HMR harness measures save-to-update latency.
`;
}

/**
 * Finds one row.
 *
 * @param rows benchmark rows
 * @param parser parser mode
 * @param shape build shape
 * @returns row or undefined
 */
function findRow(rows: BuildStats[], parser: BenchMode, shape: BuildShape): BuildStats | undefined {
    return rows.find(row => row.parser === parser && row.shape === shape);
}

/**
 * Formats rust-vs-oxc comparison text.
 *
 * @param oxc oxc row
 * @param rust rust row
 * @returns summary text
 */
function formatComparison(oxc: BuildStats | undefined, rust: BuildStats | undefined): string {
    if (!oxc || !rust || oxc.status !== 'measured' || rust.status !== 'measured') {
        return 'not measured successfully';
    }
    return `rust is ${formatRatio(oxc.medianMs / rust.medianMs)} vs oxc by median wall time`;
}

/**
 * Formats the no-csszyx baseline comparison line for a build shape. Ratios are
 * csszyx/baseline so a value > 1 means csszyx adds wall time over the Tailwind
 * floor; < 1 would mean csszyx removes wall time (not expected and worth a
 * second look).
 *
 * @param baseline no-csszyx row
 * @param oxc csszyx oxc row
 * @param rust csszyx rust row
 * @returns comparison line
 */
function formatBaselineComparison(
    baseline: BuildStats | undefined,
    oxc: BuildStats | undefined,
    rust: BuildStats | undefined,
): string {
    if (!baseline || baseline.status !== 'measured') {
        return 'not measured successfully';
    }
    const parts: string[] = [`${formatMs(baseline.medianMs)} (Tailwind only)`];
    if (oxc && oxc.status === 'measured') {
        parts.push(`csszyx oxc is ${formatRatio(oxc.medianMs / baseline.medianMs)} vs baseline`);
    }
    if (rust && rust.status === 'measured') {
        parts.push(`csszyx rust is ${formatRatio(rust.medianMs / baseline.medianMs)} vs baseline`);
    }
    return parts.join('; ');
}

/**
 * Renders one markdown table row.
 *
 * @param row benchmark row
 * @returns markdown table row
 */
function renderRow(row: BuildStats): string {
    return `| \`${row.name}\` | ${row.status} | ${formatMs(row.medianMs)} | ${formatMs(row.meanMs)} | ${formatMs(row.minMs)} | ${formatMs(row.maxMs)} | ${row.samplesMs.map(formatMs).join(', ') || '-'} | ${row.note} |`;
}

/**
 * Formats milliseconds.
 *
 * @param value milliseconds
 * @returns formatted value
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
