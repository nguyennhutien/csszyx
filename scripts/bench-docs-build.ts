#!/usr/bin/env tsx

/**
 * Benchmarks apps/docs production build wall time across csszyx parser modes.
 *
 * Usage:
 *   pnpm bench:docs-build
 *   pnpm bench:docs-build -- --iterations 3 --warmups 1
 *   pnpm bench:docs-build -- --modes oxc,rust --shapes cold
 *   pnpm bench:docs-build -- --modes rust,rust-mangle-vars --shapes cold
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

/**
 * Bench mode. `oxc` and `rust` exercise csszyx with the respective parser.
 * `rust-mangle-vars` uses Rust with production.mangleVars enabled through the
 * docs bench-only env knob. `no-csszyx` skips the csszyx plugin (Tailwind-only
 * baseline). `no-tailwind` skips both csszyx and Tailwind so the report can
 * show the Astro/Vite/React pipeline floor with no styling plugins.
 */
type BenchMode = 'oxc' | 'rust' | 'rust-mangle-vars' | 'no-csszyx' | 'no-tailwind';
type BuildShape = 'cold' | 'warm';

const BENCH_MODES = ['oxc', 'rust', 'rust-mangle-vars', 'no-csszyx', 'no-tailwind'] as const;
const BUILD_SHAPES = ['cold', 'warm'] as const;

interface CliOptions {
    /** Number of measured iterations per parser/build shape. */
    iterations: number;
    /** Number of warmup builds per parser/build shape. */
    warmups: number;
    /** Bench modes to run. */
    modes: BenchMode[];
    /** Build shapes to run. */
    shapes: BuildShape[];
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
    /** Prescan timing samples emitted by csszyx bench trace. */
    prescanMs: number[];
    /** Row status. */
    status: 'measured' | 'failed';
    /** Short note or failure diagnostic. */
    note: string;
}

interface ReportPayload {
    /** ISO generation timestamp. */
    generated: string;
    /** Node version used for the run. */
    node: string;
    /** Platform string. */
    platform: string;
    /** CPU parallelism reported by Node. */
    cpuParallelism: number;
    /** Benchmark options. */
    options: CliOptions;
    /** Benchmark rows. */
    rows: BuildStats[];
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
const payload: ReportPayload = {
    generated: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpuParallelism: availableParallelism(),
    options,
    rows: stats,
};
mkdirSync(resolve(REPO_ROOT, options.outDir), { recursive: true });
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-docs-build-bench.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
);
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-docs-build-bench.md'),
    renderReport(payload),
    'utf8',
);
console.log(`Wrote ${join(options.outDir, 'phase-e-docs-build-bench.md')}`);
console.log(`Wrote ${join(options.outDir, 'phase-e-docs-build-bench.json')}`);

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
        modes: [...BENCH_MODES],
        shapes: [...BUILD_SHAPES],
        outDir: '.agent/reports',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--iterations') {
            parsed.iterations = Math.max(1, Number(args[++i] ?? parsed.iterations));
        } else if (arg === '--warmups') {
            parsed.warmups = Math.max(0, Number(args[++i] ?? parsed.warmups));
        } else if (arg === '--modes') {
            parsed.modes = parseListOption(args[++i] ?? '', BENCH_MODES);
        } else if (arg === '--shapes') {
            parsed.shapes = parseListOption(args[++i] ?? '', BUILD_SHAPES);
        } else if (arg === '--out-dir') {
            parsed.outDir = args[++i] ?? parsed.outDir;
        }
    }

    return parsed;
}

/**
 * Parses a comma-separated allowlisted CLI option.
 *
 * @param value comma-separated option value
 * @param allowed allowed values
 * @returns parsed values, or all allowed values when parsing yields none
 */
function parseListOption<const T extends string>(value: string, allowed: readonly T[]): T[] {
    const allowedSet = new Set<string>(allowed);
    const parsed = value
        .split(',')
        .map(item => item.trim())
        .filter((item): item is T => allowedSet.has(item));
    return parsed.length > 0 ? parsed : [...allowed];
}

/**
 * Runs cold and warm docs build benchmarks.
 *
 * @param opts CLI options
 * @returns benchmark rows
 */
function runBenchmarks(opts: CliOptions): BuildStats[] {
    const rows: BuildStats[] = [];
    for (const parser of opts.modes) {
        for (const shape of opts.shapes) {
            rows.push(runBuildCase(parser, shape, opts));
        }
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
    const prescanSamples: number[] = [];
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
                ...modeEnv(parser),
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
            prescanSamples.push(...parsePrescanTimings(result.stdout, result.stderr));
        }
    }

    return measuredRow(parser, shape, samples, prescanSamples);
}

/**
 * Maps a bench mode to the env vars apps/docs's Astro config expects. The
 * no-csszyx and no-tailwind modes drop the relevant plugins via their
 * CSSZYX_BENCH_* knobs; csszyx parser mode applies only when the plugin is
 * actually in the chain.
 *
 * @param mode bench mode
 * @returns env vars for the build child process
 */
function modeEnv(mode: BenchMode): NodeJS.ProcessEnv {
    switch (mode) {
        case 'no-csszyx':
            return { CSSZYX_BENCH_NO_CSSZYX: '1' };
        case 'no-tailwind':
            return { CSSZYX_BENCH_NO_TAILWIND: '1' };
        case 'rust-mangle-vars':
            return {
                CSSZYX_BENCH_MANGLE_VARS: '1',
                CSSZYX_BENCH_TRACE: '1',
                CSSZYX_PARSER: 'rust',
            };
        default:
            return { CSSZYX_BENCH_TRACE: '1', CSSZYX_PARSER: mode };
    }
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
 * @param prescanSamples csszyx prescan trace samples
 * @returns stats row
 */
function measuredRow(
    parser: BenchMode,
    shape: BuildShape,
    samples: number[],
    prescanSamples: number[],
): BuildStats {
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
        prescanMs: prescanSamples,
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
        prescanMs: [],
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
 * Parses csszyx prescan timing logs from a docs build process.
 *
 * @param stdout process stdout
 * @param stderr process stderr
 * @returns prescan timing samples
 */
function parsePrescanTimings(stdout: string, stderr: string): number[] {
    const samples: number[] = [];
    const pattern = /\[csszyx:bench\]\s+prescan\s+([\d.]+)ms/g;
    for (const chunk of [stdout, stderr]) {
        for (const match of chunk.matchAll(pattern)) {
            const value = Number(match[1]);
            if (Number.isFinite(value)) {
                samples.push(value);
            }
        }
    }
    return samples;
}

/**
 * Renders benchmark report markdown.
 *
 * @param payload report payload
 * @returns markdown report
 */
function renderReport(payload: ReportPayload): string {
    const { rows } = payload;
    const coldOxc = findRow(rows, 'oxc', 'cold');
    const coldRust = findRow(rows, 'rust', 'cold');
    const coldRustMangleVars = findRow(rows, 'rust-mangle-vars', 'cold');
    const coldBaseline = findRow(rows, 'no-csszyx', 'cold');
    const coldFloor = findRow(rows, 'no-tailwind', 'cold');
    const warmOxc = findRow(rows, 'oxc', 'warm');
    const warmRust = findRow(rows, 'rust', 'warm');
    const warmRustMangleVars = findRow(rows, 'rust-mangle-vars', 'warm');
    const warmBaseline = findRow(rows, 'no-csszyx', 'warm');
    const warmFloor = findRow(rows, 'no-tailwind', 'warm');
    const shareBreakdown = [
        formatShareBreakdown('Cold', coldFloor, coldBaseline, coldOxc, coldRust),
        formatShareBreakdown('Warm', warmFloor, warmBaseline, warmOxc, warmRust),
    ].filter(Boolean);

    return `# Phase E Docs Build Benchmark

Generated: ${payload.generated}

Environment:

- Node: ${payload.node}
- Platform: ${payload.platform}
- CPU parallelism: ${payload.cpuParallelism}
- Iterations: ${payload.options.iterations}
- Warmups: ${payload.options.warmups}
- Modes: ${payload.options.modes.join(', ')}
- Shapes: ${payload.options.shapes.join(', ')}

## Summary

- Cold docs build: ${formatComparison(coldOxc, coldRust)}.
- Warm docs build: ${formatComparison(warmOxc, warmRust)}.
- Cold csszyx prescan: ${formatPrescanComparison(coldOxc, coldRust)}.
- Warm csszyx prescan: ${formatPrescanComparison(warmOxc, warmRust)}.
- Cold mangleVars overhead: ${formatMangleVarsComparison(coldRust, coldRustMangleVars)}.
- Warm mangleVars overhead: ${formatMangleVarsComparison(warmRust, warmRustMangleVars)}.
- Cold Tailwind-only baseline (no csszyx): ${formatBaselineComparison(coldBaseline, coldOxc, coldRust)}.
- Warm Tailwind-only baseline (no csszyx): ${formatBaselineComparison(warmBaseline, warmOxc, warmRust)}.
- Cold pipeline floor (no csszyx, no Tailwind): ${formatFloor(coldFloor, coldBaseline)}.
- Warm pipeline floor (no csszyx, no Tailwind): ${formatFloor(warmFloor, warmBaseline)}.
${shareBreakdown.length > 0 ? `${shareBreakdown.join('\n')}\n\n` : '\n'}This is an end-to-end production build wall-time benchmark for \`apps/docs\`.
It includes Astro, Vite, Tailwind, csszyx, file IO, build output generation,
and plugin finalization. The \`no-csszyx\` rows skip the csszyx plugin entirely
so the remaining Astro/Vite/Tailwind/React pipeline cost is visible as a floor;
the \`no-tailwind\` rows additionally skip Tailwind so the report can split
build wall time across csszyx, Tailwind, and the pipeline floor.

## Results

| Case | Status | Median ms | Prescan median ms | Mean ms | Min ms | Max ms | Samples ms | Note |
|---|---|---:|---:|---:|---:|---:|---|---|
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
- The \`rust-mangle-vars\` rows use the same Rust parser path as \`rust\`, but
  enable \`production.mangleVars\` through the docs bench-only
  \`CSSZYX_BENCH_MANGLE_VARS=1\` knob.
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
    if (!oxc || !rust) {
        return 'not selected';
    }
    if (oxc.status !== 'measured' || rust.status !== 'measured') {
        return 'not measured successfully';
    }
    return `rust is ${formatRatio(oxc.medianMs / rust.medianMs)} vs oxc by median wall time`;
}

/**
 * Formats csszyx prescan timing comparison text.
 *
 * @param oxc oxc row
 * @param rust rust row
 * @returns summary text
 */
function formatPrescanComparison(
    oxc: BuildStats | undefined,
    rust: BuildStats | undefined,
): string {
    if (!oxc || !rust) {
        return 'not selected';
    }
    if (oxc.status !== 'measured' || rust.status !== 'measured') {
        return 'not measured successfully';
    }
    const oxcPrescan = median(oxc.prescanMs);
    const rustPrescan = median(rust.prescanMs);
    if (!Number.isFinite(oxcPrescan) || !Number.isFinite(rustPrescan) || rustPrescan === 0) {
        return 'not traced';
    }
    return `rust ${formatMs(rustPrescan)} vs oxc ${formatMs(oxcPrescan)} (${formatRatio(
        oxcPrescan / rustPrescan,
    )})`;
}

/**
 * Formats the Rust mangleVars on/off build-time comparison.
 *
 * @param rust mangleVars disabled Rust row
 * @param rustMangleVars mangleVars enabled Rust row
 * @returns summary text
 */
function formatMangleVarsComparison(
    rust: BuildStats | undefined,
    rustMangleVars: BuildStats | undefined,
): string {
    if (!rust || !rustMangleVars) {
        return 'not selected';
    }
    if (rust.status !== 'measured' || rustMangleVars.status !== 'measured') {
        return 'not measured successfully';
    }
    const delta = rustMangleVars.medianMs - rust.medianMs;
    return `enabled is ${formatRatio(rustMangleVars.medianMs / rust.medianMs)} vs disabled (${formatSignedMs(delta)})`;
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
    if (!baseline) {
        return 'not selected';
    }
    if (baseline.status !== 'measured') {
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
 * Formats the no-tailwind pipeline-floor summary line. Reports the floor
 * itself and the additive Tailwind cost over that floor.
 *
 * @param floor no-tailwind row
 * @param baseline no-csszyx row
 * @returns summary line
 */
function formatFloor(floor: BuildStats | undefined, baseline: BuildStats | undefined): string {
    if (!floor) {
        return 'not selected';
    }
    if (floor.status !== 'measured') {
        return 'not measured successfully';
    }
    const parts: string[] = [`${formatMs(floor.medianMs)} (Astro/Vite/React only)`];
    if (baseline && baseline.status === 'measured') {
        const tailwindAdd = baseline.medianMs - floor.medianMs;
        parts.push(`Tailwind adds ${formatMs(tailwindAdd)} over floor`);
    }
    return parts.join('; ');
}

/**
 * Formats the additive share breakdown for one build shape so the report
 * header quotes the four-way split directly. Each share is the additive
 * wall-time delta against the pipeline floor.
 *
 * @param shape build shape label
 * @param floor no-tailwind row for the shape
 * @param baseline no-csszyx row for the shape
 * @param oxc csszyx oxc row for the shape
 * @param rust csszyx rust row for the shape
 * @returns share breakdown line
 */
function formatShareBreakdown(
    shape: 'Cold' | 'Warm',
    floor: BuildStats | undefined,
    baseline: BuildStats | undefined,
    oxc: BuildStats | undefined,
    rust: BuildStats | undefined,
): string {
    if (
        !floor ||
        floor.status !== 'measured' ||
        !baseline ||
        baseline.status !== 'measured' ||
        !oxc ||
        oxc.status !== 'measured' ||
        !rust ||
        rust.status !== 'measured'
    ) {
        return '';
    }
    const tailwindAdd = baseline.medianMs - floor.medianMs;
    const csszyxOxcAdd = oxc.medianMs - baseline.medianMs;
    const csszyxRustAdd = rust.medianMs - baseline.medianMs;
    return `- ${shape} share split: pipeline floor ${formatMs(floor.medianMs)}; Tailwind adds ${formatMs(tailwindAdd)}; csszyx oxc adds ${formatMs(csszyxOxcAdd)}; csszyx rust adds ${formatMs(csszyxRustAdd)}.`;
}

/**
 * Renders one markdown table row.
 *
 * @param row benchmark row
 * @returns markdown table row
 */
function renderRow(row: BuildStats): string {
    return `| \`${row.name}\` | ${row.status} | ${formatMs(row.medianMs)} | ${formatMs(
        median(row.prescanMs),
    )} | ${formatMs(row.meanMs)} | ${formatMs(row.minMs)} | ${formatMs(
        row.maxMs,
    )} | ${row.samplesMs.map(formatMs).join(', ') || '-'} | ${row.note} |`;
}

/**
 * Calculates median.
 *
 * @param samples numeric samples
 * @returns median, or NaN when empty
 */
function median(samples: number[]): number {
    if (samples.length === 0) {
        return Number.NaN;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
        : (sorted[Math.floor(sorted.length / 2)] ?? Number.NaN);
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
 * Formats a signed millisecond delta.
 *
 * @param value milliseconds
 * @returns formatted value
 */
function formatSignedMs(value: number): string {
    if (!Number.isFinite(value)) {
        return 'n/a';
    }
    const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    const formatted =
        absolute >= 1000 ? `${(absolute / 1000).toFixed(2)}s` : `${absolute.toFixed(1)}ms`;
    return `${prefix}${formatted}`;
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
