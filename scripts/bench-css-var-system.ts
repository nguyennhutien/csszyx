#!/usr/bin/env tsx
/**
 * Benchmarks #11 CSS variable mangling/hoisting performance.
 *
 * Usage:
 *   pnpm bench:css-vars
 *   pnpm bench:css-vars -- --sizes 100,1000 --iterations 7 --warmups 3
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { transformOxc } from '../packages/compiler/src/transform-oxc.js';
import { transformRust, transformRustBatch } from '../packages/compiler/src/transform-rust.js';
import { loadNativeBinding } from '../packages/core/native/index.js';

type ParserMode = 'oxc' | 'rust' | 'rust-batch';
type MangleMode = 'disabled' | 'enabled';

interface CliOptions {
    /** Synthetic project sizes to benchmark. */
    sizes: number[];
    /** Measured iterations per case. */
    iterations: number;
    /** Warmup iterations per case. */
    warmups: number;
    /** Output directory for markdown and JSON reports. */
    outDir: string;
}

interface Fixture {
    /** Source filename. */
    filename: string;
    /** Source module. */
    source: string;
    /** Fixture shape. */
    shape: FixtureShape;
}

type FixtureShape = 'hoist-fanout' | 'scoped-only' | 'mixed' | 'no-sz';

interface BenchRow {
    /** Case label. */
    name: string;
    /** Parser/runtime path measured. */
    parser: ParserMode;
    /** Whether production.mangleVars was enabled. */
    mangleVars: MangleMode;
    /** Number of files transformed per sample. */
    files: number;
    /** Median sample milliseconds. */
    medianMs: number;
    /** Mean sample milliseconds. */
    meanMs: number;
    /** Minimum sample milliseconds. */
    minMs: number;
    /** Maximum sample milliseconds. */
    maxMs: number;
    /** Median files per second. */
    filesPerSecond: number;
    /** Median milliseconds per file. */
    msPerFile: number;
    /** Raw measured samples. */
    samplesMs: number[];
    /** Transform output metrics from one representative run. */
    output: OutputMetrics;
    /** Row status. */
    status: 'measured' | 'native-unavailable' | 'failed';
    /** Human-readable note. */
    note: string;
}

interface OutputMetrics {
    /** Sum of input UTF-8 bytes. */
    inputBytes: number;
    /** Sum of output UTF-8 bytes. */
    outputBytes: number;
    /** Output minus input bytes. */
    byteDelta: number;
    /** CSS variable metadata entry count. */
    cssVariableEntries: number;
    /** Diagnostics count. */
    diagnostics: number;
    /** Transformed file count. */
    transformedFiles: number;
}

interface ReportPayload {
    /** ISO generation timestamp. */
    generated: string;
    /** Node version used for the run. */
    node: string;
    /** Platform string. */
    platform: string;
    /** Benchmark options. */
    options: CliOptions;
    /** Whether the Rust addon was available. */
    rustAvailable: boolean;
    /** Benchmark rows. */
    rows: BenchRow[];
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT_NAME = 'phase-f-css-var-max-speed-bench';

const options = parseArgs(process.argv.slice(2));
const rustAvailable = tryPreloadRustBinding();
const rows = runBenchmarks(options, rustAvailable);
const payload: ReportPayload = {
    generated: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    options,
    rustAvailable,
    rows,
};

mkdirSync(resolve(REPO_ROOT, options.outDir), { recursive: true });
writeFileSync(
    resolve(REPO_ROOT, options.outDir, `${REPORT_NAME}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
);
writeFileSync(
    resolve(REPO_ROOT, options.outDir, `${REPORT_NAME}.md`),
    renderReport(payload),
    'utf8',
);

console.log(`Wrote ${join(options.outDir, `${REPORT_NAME}.md`)}`);
console.log(`Wrote ${join(options.outDir, `${REPORT_NAME}.json`)}`);

/**
 * Parses CLI options.
 *
 * @param args CLI args after script path.
 * @returns parsed options.
 */
function parseArgs(args: string[]): CliOptions {
    const parsed: CliOptions = {
        sizes: [100, 1000],
        iterations: 7,
        warmups: 3,
        outDir: '.agent/reports',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--sizes') {
            parsed.sizes = (args[++i] ?? '')
                .split(',')
                .map(size => Number(size.trim()))
                .filter(size => Number.isFinite(size) && size > 0);
        } else if (arg === '--iterations') {
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
 * Attempts to preload the local native package.
 *
 * @returns true when Rust native transform is reachable.
 */
function tryPreloadRustBinding(): boolean {
    const libc = process.platform === 'linux' && isMusl() ? 'musl' : 'gnu';
    const triple =
        process.platform === 'linux'
            ? `${process.platform}-${process.arch}-${libc}`
            : process.platform === 'win32'
              ? `${process.platform}-${process.arch}-msvc`
              : `${process.platform}-${process.arch}`;
    const packageDir = resolve(REPO_ROOT, 'packages', `core-${triple}`);
    try {
        loadNativeBinding(packageDir);
        transformRust('const App = () => <div sz={{ p: 4 }} />;', '/bench/preload.tsx');
        return true;
    } catch {
        return false;
    }
}

/**
 * Detects musl libc on Linux.
 *
 * @returns true on musl Linux.
 */
function isMusl(): boolean {
    const report = process.report?.getReport?.();
    if (!report || typeof report !== 'object') {
        return false;
    }
    const header = (report as { header?: { glibcVersionRuntime?: string } }).header;
    return !header?.glibcVersionRuntime;
}

/**
 * Runs all benchmark cases.
 *
 * @param opts CLI options.
 * @param canRunRust whether Rust native rows can execute.
 * @returns benchmark rows.
 */
function runBenchmarks(opts: CliOptions, canRunRust: boolean): BenchRow[] {
    const rows: BenchRow[] = [];
    for (const size of opts.sizes) {
        const fixtures = createFixtures(size);
        rows.push(measureCase(fixtures, 'oxc', 'disabled', opts));
        rows.push(measureCase(fixtures, 'oxc', 'enabled', opts));
        if (canRunRust) {
            rows.push(measureCase(fixtures, 'rust', 'disabled', opts));
            rows.push(measureCase(fixtures, 'rust', 'enabled', opts));
            rows.push(measureCase(fixtures, 'rust-batch', 'disabled', opts));
            rows.push(measureCase(fixtures, 'rust-batch', 'enabled', opts));
        } else {
            rows.push(nativeUnavailableRow(fixtures, 'rust', 'disabled'));
            rows.push(nativeUnavailableRow(fixtures, 'rust', 'enabled'));
            rows.push(nativeUnavailableRow(fixtures, 'rust-batch', 'disabled'));
            rows.push(nativeUnavailableRow(fixtures, 'rust-batch', 'enabled'));
        }
    }
    return rows;
}

/**
 * Measures one parser/mangle case.
 *
 * @param fixtures files to transform.
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @param opts CLI options.
 * @returns benchmark row.
 */
function measureCase(
    fixtures: Fixture[],
    parser: ParserMode,
    mangleVars: MangleMode,
    opts: CliOptions,
): BenchRow {
    const samples: number[] = [];
    const totalRuns = opts.warmups + opts.iterations;
    const enabled = mangleVars === 'enabled';
    const run = (): OutputMetrics => transformFixtures(fixtures, parser, enabled);

    try {
        for (let i = 0; i < totalRuns; i++) {
            const started = performance.now();
            run();
            const elapsed = performance.now() - started;
            if (i >= opts.warmups) {
                samples.push(elapsed);
            }
        }
        const output = run();
        return measuredRow(fixtures, parser, mangleVars, samples, output);
    } catch (error) {
        return failedRow(fixtures, parser, mangleVars, error);
    }
}

/**
 * Transforms fixture set and collects output metrics.
 *
 * @param fixtures files to transform.
 * @param parser parser mode.
 * @param mangleVars whether mangleVars is enabled.
 * @returns aggregate output metrics.
 */
function transformFixtures(
    fixtures: Fixture[],
    parser: ParserMode,
    mangleVars: boolean,
): OutputMetrics {
    const inputBytes = fixtures.reduce((sum, file) => sum + byteLength(file.source), 0);
    let outputBytes = 0;
    let cssVariableEntries = 0;
    let diagnostics = 0;
    let transformedFiles = 0;

    const results =
        parser === 'rust-batch'
            ? transformRustBatch(fixtures, { mangleVars })
            : fixtures.map(file =>
                  parser === 'rust'
                      ? transformRust(file.source, file.filename, { mangleVars })
                      : transformOxc(file.source, file.filename, { mangleVars }),
              );

    for (const result of results) {
        outputBytes += byteLength(result.code);
        cssVariableEntries += result.cssVariableMap.size;
        diagnostics += result.diagnostics.length;
        if (result.transformed) {
            transformedFiles++;
        }
    }

    return {
        inputBytes,
        outputBytes,
        byteDelta: outputBytes - inputBytes,
        cssVariableEntries,
        diagnostics,
        transformedFiles,
    };
}

/**
 * Builds a measured benchmark row.
 *
 * @param fixtures measured fixtures.
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @param samples measured samples.
 * @param output output metrics.
 * @returns measured row.
 */
function measuredRow(
    fixtures: Fixture[],
    parser: ParserMode,
    mangleVars: MangleMode,
    samples: number[],
    output: OutputMetrics,
): BenchRow {
    const medianMs = median(samples);
    return {
        name: `css-vars/${fixtures.length}/${parser}/${mangleVars}`,
        parser,
        mangleVars,
        files: fixtures.length,
        medianMs,
        meanMs: mean(samples),
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        filesPerSecond: fixtures.length / (medianMs / 1000),
        msPerFile: medianMs / fixtures.length,
        samplesMs: samples,
        output,
        status: 'measured',
        note: noteFor(parser, mangleVars),
    };
}

/**
 * Builds a native-unavailable placeholder row.
 *
 * @param fixtures measured fixtures.
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @returns placeholder row.
 */
function nativeUnavailableRow(
    fixtures: Fixture[],
    parser: ParserMode,
    mangleVars: MangleMode,
): BenchRow {
    return {
        name: `css-vars/${fixtures.length}/${parser}/${mangleVars}`,
        parser,
        mangleVars,
        files: fixtures.length,
        medianMs: 0,
        meanMs: 0,
        minMs: 0,
        maxMs: 0,
        filesPerSecond: 0,
        msPerFile: 0,
        samplesMs: [],
        output: emptyOutputMetrics(fixtures),
        status: 'native-unavailable',
        note: 'Rust native addon was not available; run `pnpm --filter @csszyx/core native:build -- --native-engine` first.',
    };
}

/**
 * Builds a failed benchmark row.
 *
 * @param fixtures measured fixtures.
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @param error thrown error.
 * @returns failed row.
 */
function failedRow(
    fixtures: Fixture[],
    parser: ParserMode,
    mangleVars: MangleMode,
    error: unknown,
): BenchRow {
    return {
        name: `css-vars/${fixtures.length}/${parser}/${mangleVars}`,
        parser,
        mangleVars,
        files: fixtures.length,
        medianMs: 0,
        meanMs: 0,
        minMs: 0,
        maxMs: 0,
        filesPerSecond: 0,
        msPerFile: 0,
        samplesMs: [],
        output: emptyOutputMetrics(fixtures),
        status: 'failed',
        note: error instanceof Error ? error.message : String(error),
    };
}

/**
 * Builds an empty output metric object for placeholder rows.
 *
 * @param fixtures source fixtures.
 * @returns empty output metrics.
 */
function emptyOutputMetrics(fixtures: Fixture[]): OutputMetrics {
    const inputBytes = fixtures.reduce((sum, file) => sum + byteLength(file.source), 0);
    return {
        inputBytes,
        outputBytes: 0,
        byteDelta: 0,
        cssVariableEntries: 0,
        diagnostics: 0,
        transformedFiles: 0,
    };
}

/**
 * Creates a representative synthetic CSS var corpus.
 *
 * @param count number of files.
 * @returns fixtures.
 */
function createFixtures(count: number): Fixture[] {
    const shapes: FixtureShape[] = ['hoist-fanout', 'scoped-only', 'mixed', 'no-sz'];
    return Array.from({ length: count }, (_, index) => {
        const shape = shapes[index % shapes.length] ?? 'hoist-fanout';
        return {
            filename: `/bench/css-vars/${shape}-${index}.tsx`,
            source: sourceFor(shape, index),
            shape,
        };
    });
}

/**
 * Creates source for one fixture shape.
 *
 * @param shape fixture shape.
 * @param index fixture index.
 * @returns source code.
 */
function sourceFor(shape: FixtureShape, index: number): string {
    switch (shape) {
        case 'hoist-fanout':
            return `export function Card${index}({ gap, tone }) {
  return <section sz={{ p: gap, bg: tone }}>
    <div sz={{ p: gap, color: tone }} />
    <article sz={{ p: gap, color: tone }} />
    <aside sz={{ p: gap }} />
  </section>;
}`;
        case 'scoped-only':
            return `export function Meter${index}({ size, accent }) {
  return <div>
    <span sz={{ w: size, h: size, bg: accent }} />
    <span sz={{ w: size + 1, h: size + 1, bg: accent }} />
  </div>;
}`;
        case 'mixed':
            return `const base${index} = { display: 'grid', gap: 2 } as const;
export function Panel${index}({ pad, color, active }) {
  return <section sz={{ ...base${index}, p: pad }}>
    <button sz={[{ color }, active && { bg: color }]} />
    <button sz={{ color, p: pad }} />
  </section>;
}`;
        case 'no-sz':
            return `export function Plain${index}() {
  return <div className="p-4 rounded-md">Plain ${index}</div>;
}`;
    }
}

/**
 * Explains a benchmark row.
 *
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @returns row note.
 */
function noteFor(parser: ParserMode, mangleVars: MangleMode): string {
    const parserNote =
        parser === 'rust-batch'
            ? 'Rust native batch path amortizes one napi call across the fixture set.'
            : parser === 'rust'
              ? 'Rust native per-file path mirrors current compiler calls.'
              : 'Oxc-JS path is the parity baseline.';
    const mangleNote =
        mangleVars === 'enabled'
            ? 'production.mangleVars enabled: scoped names plus component hoisting.'
            : 'production.mangleVars disabled baseline.';
    return `${parserNote} ${mangleNote}`;
}

/**
 * Renders markdown report.
 *
 * @param payload report payload.
 * @returns markdown.
 */
function renderReport(payload: ReportPayload): string {
    const rows = payload.rows.filter(row => row.status === 'measured');
    const summary = renderSummary(rows);
    return `# Phase F CSS Var Max-Speed Benchmark

Generated: ${payload.generated}

Environment:

- Node: ${payload.node}
- Platform: ${payload.platform}
- Iterations: ${payload.options.iterations}
- Warmups: ${payload.options.warmups}
- Sizes: ${payload.options.sizes.join(', ')}
- Rust native available: ${payload.rustAvailable ? 'yes' : 'no'}

## Summary

${summary}

## Results

| Case | Status | Files | Median ms | ms/file | Files/sec | Output bytes | Byte delta | Var entries | Diagnostics | Note |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
${payload.rows.map(renderRow).join('\n')}

## Interpretation

- Disabled rows are the current production-safe baseline for apps that do not
  opt into \`production.mangleVars\`.
- Enabled rows isolate #11 overhead and byte savings for runtime dynamic
  \`s/c\` CSS variables. They do not include future #29 global \`g\` aliases.
- Rust batch rows show the ceiling if build integrations later batch compiler
  calls. Current unplugin behavior is closer to per-file Rust plus transform
  cache.
- Byte delta is generated source bytes only. Bundler minification, Tailwind CSS
  output, gzip/brotli, and browser style-invalidation cost are outside this
  harness and need separate end-to-end validation before flipping defaults.
`;
}

/**
 * Renders high-signal summary bullets.
 *
 * @param rows measured rows.
 * @returns markdown summary.
 */
function renderSummary(rows: BenchRow[]): string {
    const bullets: string[] = [];
    for (const size of [...new Set(rows.map(row => row.files))].sort((a, b) => a - b)) {
        const oxcDisabled = findRow(rows, size, 'oxc', 'disabled');
        const oxcEnabled = findRow(rows, size, 'oxc', 'enabled');
        const rustDisabled = findRow(rows, size, 'rust', 'disabled');
        const rustEnabled = findRow(rows, size, 'rust', 'enabled');
        const rustBatchEnabled = findRow(rows, size, 'rust-batch', 'enabled');

        if (oxcDisabled && oxcEnabled) {
            bullets.push(
                `- ${size} files: oxc enabled/disabled overhead is ${ratio(
                    oxcEnabled.medianMs,
                    oxcDisabled.medianMs,
                )}x; enabled saves ${formatInt(
                    oxcDisabled.output.outputBytes - oxcEnabled.output.outputBytes,
                )} generated bytes vs disabled.`,
            );
        }
        if (rustDisabled && rustEnabled) {
            bullets.push(
                `- ${size} files: rust enabled/disabled overhead is ${ratio(
                    rustEnabled.medianMs,
                    rustDisabled.medianMs,
                )}x; enabled saves ${formatInt(
                    rustDisabled.output.outputBytes - rustEnabled.output.outputBytes,
                )} generated bytes vs disabled.`,
            );
        }
        if (oxcEnabled && rustEnabled) {
            bullets.push(
                `- ${size} files: rust enabled is ${ratio(
                    oxcEnabled.medianMs,
                    rustEnabled.medianMs,
                )}x faster than oxc enabled.`,
            );
        }
        if (rustEnabled && rustBatchEnabled) {
            bullets.push(
                `- ${size} files: rust batch enabled is ${ratio(
                    rustEnabled.medianMs,
                    rustBatchEnabled.medianMs,
                )}x vs per-file rust enabled.`,
            );
        }
    }
    return bullets.length > 0 ? bullets.join('\n') : '- No measured rows.';
}

/**
 * Finds a measured row.
 *
 * @param rows benchmark rows.
 * @param files file count.
 * @param parser parser mode.
 * @param mangleVars mangle mode.
 * @returns row if found.
 */
function findRow(
    rows: BenchRow[],
    files: number,
    parser: ParserMode,
    mangleVars: MangleMode,
): BenchRow | undefined {
    return rows.find(
        row => row.files === files && row.parser === parser && row.mangleVars === mangleVars,
    );
}

/**
 * Renders one result-table row.
 *
 * @param row benchmark row.
 * @returns markdown table row.
 */
function renderRow(row: BenchRow): string {
    return `| \`${row.name}\` | ${row.status} | ${row.files} | ${formatMs(
        row.medianMs,
    )} | ${formatMs(row.msPerFile)} | ${formatInt(row.filesPerSecond)} | ${formatInt(
        row.output.outputBytes,
    )} | ${formatInt(row.output.byteDelta)} | ${formatInt(
        row.output.cssVariableEntries,
    )} | ${formatInt(row.output.diagnostics)} | ${row.note} |`;
}

/**
 * Calculates median.
 *
 * @param samples numeric samples.
 * @returns median value.
 */
function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    if (sorted.length === 0) {
        return 0;
    }
    return sorted.length % 2 === 0
        ? ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
        : (sorted[Math.floor(sorted.length / 2)] ?? 0);
}

/**
 * Calculates mean.
 *
 * @param samples numeric samples.
 * @returns mean value.
 */
function mean(samples: number[]): number {
    return samples.length === 0
        ? 0
        : samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
}

/**
 * Formats a ratio.
 *
 * @param numerator numerator.
 * @param denominator denominator.
 * @returns ratio string.
 */
function ratio(numerator: number, denominator: number): string {
    return denominator === 0 ? 'n/a' : (numerator / denominator).toFixed(2);
}

/**
 * Formats milliseconds.
 *
 * @param value numeric value.
 * @returns formatted number.
 */
function formatMs(value: number): string {
    return value >= 10 ? value.toFixed(2) : value.toFixed(3);
}

/**
 * Formats integer-ish numbers.
 *
 * @param value numeric value.
 * @returns locale-free rounded integer.
 */
function formatInt(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

/**
 * Calculates UTF-8 byte length.
 *
 * @param value string value.
 * @returns byte length.
 */
function byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}
