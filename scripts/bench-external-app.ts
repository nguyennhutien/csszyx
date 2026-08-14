#!/usr/bin/env tsx

/**
 * Benchmarks a real csszyx application through the native and WebAssembly
 * artifacts without changing its source or configuration.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export type ExternalBenchParser = 'rust' | 'wasm';
export type ExternalBenchToggle = 'off' | 'on';
type SupportStatus = 'observed' | 'not-observed' | 'not-measured';

export interface ExternalBenchOptions {
    cwd: string;
    build: string;
    outputs: string[];
    modes: ExternalBenchParser[];
    mangleVars: ExternalBenchToggle[];
    iterations: number;
    warmups: number;
    report: string;
    trace: boolean;
}

export interface ExternalOutputStats {
    files: number;
    bytes: number;
    gzipBytes: number;
    brotliBytes: number;
}

export interface ExternalBenchRow {
    parser: ExternalBenchParser;
    mangleVars: ExternalBenchToggle;
    status: 'measured' | 'failed';
    parserSupport: SupportStatus;
    mangleVarsSupport: SupportStatus;
    samplesMs: number[];
    medianMs: number;
    meanMs: number;
    minMs: number;
    maxMs: number;
    output: ExternalOutputStats;
    outputHashes: string[];
    outputStable: boolean;
    traceLines: string[];
    note: string;
}

export interface ExternalBenchReport {
    generated: string;
    node: string;
    platform: string;
    cpuParallelism: number;
    gitHead: string | null;
    options: ExternalBenchOptions;
    rows: ExternalBenchRow[];
}

const PARSERS = ['rust', 'wasm'] as const;
const TOGGLES = ['off', 'on'] as const;
const VALUE_OPTIONS = new Set([
    '--build',
    '--cwd',
    '--iterations',
    '--mangle-vars',
    '--modes',
    '--out',
    '--report',
    '--warmups',
]);
const EMPTY_STATS: ExternalOutputStats = { files: 0, bytes: 0, gzipBytes: 0, brotliBytes: 0 };

/**
 * Parse and validate the external benchmark CLI contract.
 *
 * @param args - CLI arguments after the script name.
 * @returns Validated benchmark options.
 */
export function parseExternalBenchArgs(args: string[]): ExternalBenchOptions {
    const values = new Map<string, string>();
    let trace = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--') continue;
        if (argument === '--trace') {
            trace = true;
            continue;
        }
        if (!argument?.startsWith('--')) {
            throw new Error(`Unexpected argument "${argument ?? ''}".`);
        }
        if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown option "${argument}".`);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`${argument} requires a value.`);
        }
        values.set(argument, value);
        index++;
    }

    const cwd = required(values, '--cwd');
    const build = required(values, '--build');
    const outputs = parseCsv(required(values, '--out'));
    if (outputs.length === 0) throw new Error('--out must name at least one output directory.');

    return {
        cwd,
        build,
        outputs,
        modes: parseAllowlistedCsv(values.get('--modes') ?? 'rust,wasm', PARSERS, '--modes'),
        mangleVars: parseAllowlistedCsv(
            values.get('--mangle-vars') ?? 'off',
            TOGGLES,
            '--mangle-vars',
        ),
        iterations: parseCount(values.get('--iterations') ?? '3', '--iterations', 1),
        warmups: parseCount(values.get('--warmups') ?? '1', '--warmups', 0),
        report: values.get('--report') ?? '.agent/reports/external-app-bench.md',
        trace,
    };
}

/**
 * Resolve output paths and reject every destructive path shape.
 *
 * @param cwd - External application root.
 * @param outputs - Explicit output directories relative to the app root.
 * @param trackedFiles - Git-tracked paths relative to the app root.
 * @returns Deduplicated absolute output directories safe to remove.
 */
export function resolveSafeOutputDirectories(
    cwd: string,
    outputs: readonly string[],
    trackedFiles: readonly string[],
): string[] {
    const root = path.resolve(cwd);
    const rootPrefix = `${root}${path.sep}`;
    const resolved = [...new Set(outputs.map(output => path.resolve(root, output)))];
    for (const output of resolved) {
        if (output === root) throw new Error('Refusing to clean the external project root.');
        if (!output.startsWith(rootPrefix)) {
            throw new Error(`Refusing to clean output outside the external project: ${output}`);
        }
        assertPhysicalPathInside(root, output);
        if (existsSync(output) && !lstatSync(output).isDirectory()) {
            throw new Error(`Declared output must be a directory: ${output}`);
        }
        const outputPrefix = `${output}${path.sep}`;
        const tracked = trackedFiles.find(file => {
            const trackedPath = path.resolve(root, file);
            return trackedPath === output || trackedPath.startsWith(outputPrefix);
        });
        if (tracked) {
            throw new Error(`Refusing to clean output containing tracked file "${tracked}".`);
        }
    }

    return resolved.filter(
        output =>
            !resolved.some(
                parent => parent !== output && output.startsWith(`${parent}${path.sep}`),
            ),
    );
}

/**
 * Collect aggregate raw and compressed bytes from explicit outputs.
 *
 * @param outputs - Absolute output directories to measure.
 * @returns Aggregate artifact statistics.
 */
export function collectOutputStats(outputs: readonly string[]): ExternalOutputStats {
    const result = { ...EMPTY_STATS };
    for (const output of outputs) {
        if (!existsSync(output)) continue;
        for (const file of walkFiles(output)) {
            const contents = readFileSync(file);
            result.files++;
            result.bytes += contents.byteLength;
            result.gzipBytes += gzipSync(contents).byteLength;
            result.brotliBytes += brotliCompressSync(contents, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
            }).byteLength;
        }
    }
    return result;
}

/**
 * Run the complete parser/mangle matrix.
 *
 * @param input - Validated benchmark options.
 * @returns Host metadata and measured rows.
 */
export async function runExternalBenchmark(
    input: ExternalBenchOptions,
): Promise<ExternalBenchReport> {
    const options = { ...input, cwd: path.resolve(input.cwd) };
    const trackedFiles = readTrackedFiles(options.cwd);
    const outputDirectories = resolveSafeOutputDirectories(
        options.cwd,
        options.outputs,
        trackedFiles,
    );
    const rows: ExternalBenchRow[] = [];
    for (const parser of options.modes) {
        for (const mangleVars of options.mangleVars) {
            rows.push(runCase(options, outputDirectories, parser, mangleVars));
        }
    }
    return {
        generated: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpuParallelism: availableParallelism(),
        gitHead: readGitHead(options.cwd),
        options,
        rows,
    };
}

/**
 * Render the stable human-readable report.
 *
 * @param report - Machine-readable benchmark result.
 * @returns Markdown report.
 */
export function renderExternalBenchMarkdown(report: ExternalBenchReport): string {
    const lines = [
        '# CSSzyx external app benchmark',
        '',
        `Generated: ${report.generated}`,
        '',
        `- App: \`${escapeInline(report.options.cwd)}\``,
        `- Build: \`${escapeInline(report.options.build)}\``,
        `- Outputs: ${report.options.outputs.map(value => `\`${escapeInline(value)}\``).join(', ')}`,
        `- Host: ${report.platform}, ${report.cpuParallelism} logical CPUs, ${report.node}`,
        `- App commit: ${report.gitHead ? `\`${report.gitHead}\`` : 'not available'}`,
        '',
        '| Parser | mangleVars | Status | Parser env | Mangle env | Output stable | Median ms | Mean ms | Raw bytes | Gzip bytes | Brotli bytes |',
        '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
        ...report.rows.map(
            row =>
                `| ${parserLabel(row.parser)} | ${row.mangleVars} | ${row.status} | ${row.parserSupport} | ${row.mangleVarsSupport} | ${row.outputStable ? 'yes' : 'no'} | ${formatNumber(row.medianMs)} | ${formatNumber(row.meanMs)} | ${row.output.bytes} | ${row.output.gzipBytes} | ${row.output.brotliBytes} |`,
        ),
        '',
        '## Compressed-size verdict',
        '',
        ...compressedVerdicts(report.rows),
        '',
        '## Artifact parity',
        '',
        ...artifactParityVerdicts(report.rows),
        '',
        '## Notes',
        '',
        ...report.rows.map(
            row => `- ${parserLabel(row.parser)} / mangleVars ${row.mangleVars}: ${row.note}`,
        ),
        ...renderTraceLines(report.rows),
        '',
        'A `not-observed` env signal is not a benchmark failure. It means the app did not print a csszyx banner proving that it consumed the requested bench-only environment variable; verify the app wiring before using that row for a product decision.',
        '',
    ];
    return lines.join('\n');
}

async function main(): Promise<void> {
    const options = parseExternalBenchArgs(process.argv.slice(2));
    const report = await runExternalBenchmark(options);
    const markdownPath = path.resolve(options.report);
    const jsonPath = markdownPath.endsWith('.md')
        ? `${markdownPath.slice(0, -3)}.json`
        : `${markdownPath}.json`;
    mkdirSync(path.dirname(markdownPath), { recursive: true });
    mkdirSync(path.dirname(jsonPath), { recursive: true });
    writeFileSync(markdownPath, renderExternalBenchMarkdown(report));
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${markdownPath}`);
    console.log(`Wrote ${jsonPath}`);
    if (report.rows.some(row => row.status === 'failed')) process.exitCode = 1;
}

function runCase(
    options: ExternalBenchOptions,
    outputDirectories: readonly string[],
    parser: ExternalBenchParser,
    mangleVars: ExternalBenchToggle,
): ExternalBenchRow {
    const samplesMs: number[] = [];
    const outputSamples: ExternalOutputStats[] = [];
    const outputHashes: string[] = [];
    let combinedOutput = '';
    for (let run = 0; run < options.warmups + options.iterations; run++) {
        cleanOutputs(outputDirectories);
        const started = performance.now();
        const result = spawnSync(options.build, {
            cwd: options.cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                CSSZYX_BENCH_MANGLE_VARS: mangleVars === 'on' ? '1' : '0',
                CSSZYX_BENCH_TRACE: options.trace ? '1' : '0',
                CSSZYX_PARSER: parser,
                NODE_ENV: 'production',
            },
            maxBuffer: 64 * 1024 * 1024,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const elapsed = performance.now() - started;
        const buildOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        combinedOutput += buildOutput;
        if (result.status !== 0) {
            return failedRow(parser, mangleVars, samplesMs, buildOutput);
        }
        if (run >= options.warmups) {
            samplesMs.push(elapsed);
            outputSamples.push(collectOutputStats(outputDirectories));
            outputHashes.push(hashOutputs(outputDirectories));
        }
    }

    const parserSupport = observedParser(combinedOutput, parser) ? 'observed' : 'not-observed';
    const mangleVarsSupport =
        mangleVars === 'off'
            ? 'not-measured'
            : observedMangleVars(combinedOutput)
              ? 'observed'
              : 'not-observed';
    const noteParts = ['Build succeeded.'];
    if (parserSupport === 'not-observed')
        noteParts.push('Requested parser banner was not observed.');
    if (mangleVarsSupport === 'not-observed') {
        noteParts.push('Bench-only mangleVars wiring was not observed.');
    }
    const traceLines = collectTraceLines(combinedOutput);
    if (outputSamples.some(sample => sample.files === 0)) {
        return {
            parser,
            mangleVars,
            status: 'failed',
            parserSupport,
            mangleVarsSupport,
            samplesMs,
            medianMs: median(samplesMs),
            meanMs: mean(samplesMs),
            minMs: Math.min(...samplesMs),
            maxMs: Math.max(...samplesMs),
            output: { ...EMPTY_STATS },
            outputHashes,
            outputStable: new Set(outputHashes).size <= 1,
            traceLines,
            note: 'Build succeeded, but the declared output directories contained no files.',
        };
    }
    return {
        parser,
        mangleVars,
        status: 'measured',
        parserSupport,
        mangleVarsSupport,
        samplesMs,
        medianMs: median(samplesMs),
        meanMs: mean(samplesMs),
        minMs: Math.min(...samplesMs),
        maxMs: Math.max(...samplesMs),
        output: medianOutput(outputSamples),
        outputHashes,
        outputStable: new Set(outputHashes).size <= 1,
        traceLines,
        note: noteParts.join(' '),
    };
}

function failedRow(
    parser: ExternalBenchParser,
    mangleVars: ExternalBenchToggle,
    samplesMs: number[],
    output: string,
): ExternalBenchRow {
    return {
        parser,
        mangleVars,
        status: 'failed',
        parserSupport: 'not-observed',
        mangleVarsSupport: mangleVars === 'off' ? 'not-measured' : 'not-observed',
        samplesMs,
        medianMs: samplesMs.length > 0 ? median(samplesMs) : 0,
        meanMs: samplesMs.length > 0 ? mean(samplesMs) : 0,
        minMs: samplesMs.length > 0 ? Math.min(...samplesMs) : 0,
        maxMs: samplesMs.length > 0 ? Math.max(...samplesMs) : 0,
        output: { ...EMPTY_STATS },
        outputHashes: [],
        outputStable: false,
        traceLines: collectTraceLines(output),
        note: summarizeFailure(output),
    };
}

function cleanOutputs(outputs: readonly string[]): void {
    for (const output of outputs) rmSync(output, { force: true, recursive: true });
}

function readTrackedFiles(cwd: string): string[] {
    const result = spawnSync('git', ['-C', cwd, 'ls-files', '-z'], { encoding: 'utf8' });
    if (result.status !== 0) return [];
    return (result.stdout ?? '').split('\0').filter(Boolean);
}

function readGitHead(cwd: string): string | null {
    const result = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    return result.status === 0 ? (result.stdout ?? '').trim() || null : null;
}

function assertPhysicalPathInside(root: string, output: string): void {
    const physicalRoot = realpathSync(root);
    let existing = output;
    while (!existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        existing = parent;
    }
    const physicalExisting = realpathSync(existing);
    if (
        physicalExisting !== physicalRoot &&
        !physicalExisting.startsWith(`${physicalRoot}${path.sep}`)
    ) {
        throw new Error(
            `Refusing to clean output whose physical path escapes the project: ${output}`,
        );
    }
    if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
        throw new Error(`Refusing to clean a symbolic-link output: ${output}`);
    }
}

function walkFiles(root: string): string[] {
    if (statSync(root).isFile()) return [root];
    const files: string[] = [];
    for (const entry of readdirSync(root).sort()) {
        const candidate = path.join(root, entry);
        const stats = lstatSync(candidate);
        if (stats.isSymbolicLink()) continue;
        if (stats.isDirectory()) files.push(...walkFiles(candidate));
        else if (stats.isFile()) files.push(candidate);
    }
    return files;
}

function hashOutputs(outputs: readonly string[]): string {
    const hash = createHash('sha256');
    outputs.forEach((output, outputIndex) => {
        if (!existsSync(output)) return;
        for (const file of walkFiles(output)) {
            hash.update(`${outputIndex}:${path.relative(output, file)}\0`);
            hash.update(readFileSync(file));
            hash.update('\0');
        }
    });
    return hash.digest('hex');
}

function observedParser(output: string, parser: ExternalBenchParser): boolean {
    return /active parser:\s*(rust|wasm)\b/i.exec(output)?.[1]?.toLowerCase() === parser;
}

function observedMangleVars(output: string): boolean {
    return /mangleVars[^\n]*(?:on|true|1)/i.test(output);
}

function collectTraceLines(output: string): string[] {
    return [
        ...new Set(
            output
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.startsWith('[csszyx:bench]')),
        ),
    ].slice(0, 100);
}

function renderTraceLines(rows: readonly ExternalBenchRow[]): string[] {
    const traced = rows.filter(row => row.traceLines.length > 0);
    if (traced.length === 0) return [];
    return [
        '',
        '## CSSzyx trace samples',
        '',
        ...traced.flatMap(row => [
            `### ${parserLabel(row.parser)} / mangleVars ${row.mangleVars}`,
            '',
            '```text',
            ...row.traceLines,
            '```',
            '',
        ]),
    ];
}

function medianOutput(samples: readonly ExternalOutputStats[]): ExternalOutputStats {
    return {
        files: median(samples.map(sample => sample.files)),
        bytes: median(samples.map(sample => sample.bytes)),
        gzipBytes: median(samples.map(sample => sample.gzipBytes)),
        brotliBytes: median(samples.map(sample => sample.brotliBytes)),
    };
}

function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compressedVerdicts(rows: readonly ExternalBenchRow[]): string[] {
    const verdicts: string[] = [];
    for (const parser of PARSERS) {
        const off = rows.find(row => row.parser === parser && row.mangleVars === 'off');
        const on = rows.find(row => row.parser === parser && row.mangleVars === 'on');
        if (!off || !on || off.status !== 'measured' || on.status !== 'measured') {
            if (off || on)
                verdicts.push(
                    `- ${parserLabel(parser)}: mangleVars compressed delta not measured.`,
                );
            continue;
        }
        const gzipDelta = on.output.gzipBytes - off.output.gzipBytes;
        const brotliDelta = on.output.brotliBytes - off.output.brotliBytes;
        verdicts.push(
            `- ${parserLabel(parser)}: mangleVars ${signed(gzipDelta)} gzip bytes and ${signed(brotliDelta)} Brotli bytes versus off.`,
        );
    }
    return verdicts.length > 0 ? verdicts : ['- mangleVars compressed delta not measured.'];
}

function artifactParityVerdicts(rows: readonly ExternalBenchRow[]): string[] {
    const verdicts: string[] = [];
    for (const mangleVars of TOGGLES) {
        const native = rows.find(row => row.parser === 'rust' && row.mangleVars === mangleVars);
        const wasm = rows.find(row => row.parser === 'wasm' && row.mangleVars === mangleVars);
        if (!native || !wasm || native.status !== 'measured' || wasm.status !== 'measured')
            continue;
        if (!native.outputStable || !wasm.outputStable) {
            verdicts.push(
                `- mangleVars ${mangleVars}: at least one artifact produced non-deterministic output across iterations; cross-artifact parity is inconclusive.`,
            );
        } else if (native.outputHashes[0] === wasm.outputHashes[0]) {
            verdicts.push(
                `- mangleVars ${mangleVars}: native and WASM outputs are byte-identical.`,
            );
        } else {
            verdicts.push(`- mangleVars ${mangleVars}: native and WASM output digests differ.`);
        }
    }
    return verdicts.length > 0 ? verdicts : ['- Native/WASM artifact parity not measured.'];
}

function parseAllowlistedCsv<const T extends string>(
    value: string,
    allowed: readonly T[],
    option: string,
): T[] {
    const parsed = parseCsv(value);
    for (const item of parsed) {
        if (!allowed.includes(item as T)) throw new Error(`Unknown ${option} value "${item}".`);
    }
    if (parsed.length === 0) throw new Error(`${option} must not be empty.`);
    return [...new Set(parsed)] as T[];
}

function parseCsv(value: string): string[] {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseCount(value: string, option: string, minimum: number): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || String(parsed) !== value) {
        throw new Error(`${option} must be an integer >= ${minimum}.`);
    }
    return parsed;
}

function required(values: ReadonlyMap<string, string>, option: string): string {
    const value = values.get(option);
    if (!value) throw new Error(`${option} is required.`);
    return value;
}

function summarizeFailure(output: string): string {
    const lines = output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return (
        lines.find(line => /error|failed|csszyx/i.test(line)) ??
        lines.at(-1) ??
        'Build failed.'
    ).slice(0, 300);
}

function parserLabel(parser: ExternalBenchParser): string {
    return parser === 'rust' ? 'rust (native)' : 'wasm';
}

function signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function escapeInline(value: string): string {
    return value.replaceAll('`', '\\`');
}

const isEntrypoint = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;
if (isEntrypoint) {
    await main();
}
