#!/usr/bin/env tsx
/**
 * Benchmarks Phase H global custom-property aliasing with pure scanner,
 * compiler, and CSS rewrite APIs.
 *
 * Usage:
 *   pnpm bench:global-vars
 *   pnpm bench:global-vars -- --sizes 100,1000 --iterations 7 --warmups 3
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { transformOxc } from '../packages/compiler/src/transform-oxc.js';
import {
    planGlobalVarAliases,
    rewriteGlobalVarCssAliases,
    scanGlobalVarCss,
} from '../packages/unplugin/src/global-var-scanner.js';

interface CliOptions {
    /** Synthetic token counts to benchmark. */
    sizes: number[];
    /** Measured iterations per case. */
    iterations: number;
    /** Warmup iterations per case. */
    warmups: number;
    /** Output directory for markdown and JSON reports. */
    outDir: string;
}

interface BenchRow {
    /** Case label. */
    name: string;
    /** Number of global tokens in the fixture. */
    tokens: number;
    /** Median sample milliseconds. */
    medianMs: number;
    /** Mean sample milliseconds. */
    meanMs: number;
    /** Minimum sample milliseconds. */
    minMs: number;
    /** Maximum sample milliseconds. */
    maxMs: number;
    /** Raw measured samples. */
    samplesMs: number[];
    /** Output metrics from one representative run. */
    output: OutputMetrics;
    /** Human-readable note. */
    note: string;
}

interface OutputMetrics {
    /** Input source + CSS bytes. */
    inputBytes: number;
    /** Disabled output source + CSS bytes. */
    disabledBytes: number;
    /** Alias-mode output source + CSS bytes. */
    aliasBytes: number;
    /** Disabled gzip bytes. */
    disabledGzipBytes: number;
    /** Alias-mode gzip bytes. */
    aliasGzipBytes: number;
    /** Disabled brotli bytes. */
    disabledBrotliBytes: number;
    /** Alias-mode brotli bytes. */
    aliasBrotliBytes: number;
    /** Raw byte delta, alias minus disabled. */
    byteDelta: number;
    /** Gzip byte delta, alias minus disabled. */
    gzipDelta: number;
    /** Brotli byte delta, alias minus disabled. */
    brotliDelta: number;
    /** CSS alias declarations emitted. */
    aliasDeclarations: number;
    /** CSS var() references rewritten. */
    rewrittenReferences: number;
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
    /** Benchmark rows. */
    rows: BenchRow[];
}

interface Fixture {
    /** CSS fixture source. */
    css: string;
    /** TSX fixture source. */
    source: string;
    /** Explicit token list. */
    tokens: string[];
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPORT_NAME = 'phase-h-global-var-bench';

const options = parseCliOptions(process.argv.slice(2));
const rows = runBench(options);
writeReports(rows, options);

/**
 * Parse CLI args.
 *
 * @param args CLI args after `--`.
 * @returns options.
 */
function parseCliOptions(args: string[]): CliOptions {
    const options: CliOptions = {
        sizes: [100, 1000],
        iterations: 5,
        warmups: 2,
        outDir: '.agent/reports',
    };
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        const next = args[index + 1];
        if (arg === '--sizes' && next) {
            options.sizes = next
                .split(',')
                .map(value => Number.parseInt(value, 10))
                .filter(Number.isFinite);
            index++;
        } else if (arg === '--iterations' && next) {
            options.iterations = Number.parseInt(next, 10);
            index++;
        } else if (arg === '--warmups' && next) {
            options.warmups = Number.parseInt(next, 10);
            index++;
        } else if (arg === '--out-dir' && next) {
            options.outDir = next;
            index++;
        }
    }
    return options;
}

/**
 * Run benchmark cases.
 *
 * @param options CLI options.
 * @returns benchmark rows.
 */
function runBench(options: CliOptions): BenchRow[] {
    return options.sizes.map(size => {
        const fixture = createFixture(size);
        return measureCase({
            name: `global-vars/${size}/pure-pipeline`,
            tokens: size,
            iterations: options.iterations,
            warmups: options.warmups,
            run: () => runPipeline(fixture),
            note: 'Pure Phase H pipeline: CSS scan/plan/rewrite plus oxc TSX rewrite with the same alias table.',
        });
    });
}

/**
 * Measure one benchmark case.
 *
 * @param input measurement input.
 * @param input.name case name.
 * @param input.tokens token count.
 * @param input.iterations measured iterations.
 * @param input.warmups warmup iterations.
 * @param input.run measured callback.
 * @param input.note report note.
 * @returns benchmark row.
 */
function measureCase(input: {
    name: string;
    tokens: number;
    iterations: number;
    warmups: number;
    run: () => OutputMetrics;
    note: string;
}): BenchRow {
    let output = input.run();
    for (let index = 0; index < input.warmups; index++) {
        output = input.run();
    }
    const samplesMs: number[] = [];
    for (let index = 0; index < input.iterations; index++) {
        const start = performance.now();
        output = input.run();
        samplesMs.push(performance.now() - start);
    }
    return {
        name: input.name,
        tokens: input.tokens,
        medianMs: median(samplesMs),
        meanMs: mean(samplesMs),
        minMs: Math.min(...samplesMs),
        maxMs: Math.max(...samplesMs),
        samplesMs,
        output,
        note: input.note,
    };
}

/**
 * Run the pure Phase H pipeline once.
 *
 * @param fixture Synthetic fixture.
 * @returns output metrics.
 */
function runPipeline(fixture: Fixture): OutputMetrics {
    const scan = scanGlobalVarCss(fixture.css, { filePath: '/bench/theme.css' });
    const plan = planGlobalVarAliases({ scans: [scan], tokens: fixture.tokens });
    if (plan.diagnostics.length > 0) {
        throw new Error(plan.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
    }
    const cssRewrite = rewriteGlobalVarCssAliases({
        css: fixture.css,
        plan,
        filePath: '/bench/theme.css',
    });
    const disabledSource = transformOxc(fixture.source, '/bench/App.tsx');
    const aliasSource = transformOxc(fixture.source, '/bench/App.tsx', {
        globalVarAliases: plan.aliases,
    });
    const disabledOutput = `${disabledSource.code}\n${fixture.css}`;
    const aliasOutput = `${aliasSource.code}\n${cssRewrite.css}`;
    return {
        inputBytes: byteLength(`${fixture.source}\n${fixture.css}`),
        disabledBytes: byteLength(disabledOutput),
        aliasBytes: byteLength(aliasOutput),
        disabledGzipBytes: gzipSize(disabledOutput),
        aliasGzipBytes: gzipSize(aliasOutput),
        disabledBrotliBytes: brotliSize(disabledOutput),
        aliasBrotliBytes: brotliSize(aliasOutput),
        byteDelta: byteLength(aliasOutput) - byteLength(disabledOutput),
        gzipDelta: gzipSize(aliasOutput) - gzipSize(disabledOutput),
        brotliDelta: brotliSize(aliasOutput) - brotliSize(disabledOutput),
        aliasDeclarations: cssRewrite.aliasDeclarations,
        rewrittenReferences: cssRewrite.rewrittenReferences,
    };
}

/**
 * Create a synthetic app with repeated global token usage.
 *
 * @param size token count.
 * @returns fixture.
 */
function createFixture(size: number): Fixture {
    const cssLines = [':root {'];
    const sourceLines = ['export function App() {', '  return <main>'];
    const tokens: string[] = [];
    for (let index = 0; index < size; index++) {
        const token = `--brand-${index.toString().padStart(4, '0')}`;
        const nextToken = `--brand-${((index + 1) % size).toString().padStart(4, '0')}`;
        tokens.push(token);
        cssLines.push(`  ${token}: ${colorForIndex(index)};`);
        cssLines.push(`  --surface-${index.toString().padStart(4, '0')}: var(${token});`);
        sourceLines.push(
            `    <section sz={{ bg: '${token}', color: '${nextToken}', borderColor: '${token}' }} />`,
        );
    }
    cssLines.push('}', '.dashboard {');
    for (const token of tokens) {
        cssLines.push(`  color: var(${token});`);
    }
    cssLines.push('}');
    sourceLines.push('  </main>;', '}');
    return {
        css: `${cssLines.join('\n')}\n`,
        source: `${sourceLines.join('\n')}\n`,
        tokens,
    };
}

/**
 * Deterministic color for synthetic CSS.
 *
 * @param index token index.
 * @returns hex color.
 */
function colorForIndex(index: number): string {
    const value = (index * 2_654_435_761) >>> 0;
    return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Write markdown and JSON reports.
 *
 * @param rows benchmark rows.
 * @param options CLI options.
 */
function writeReports(rows: BenchRow[], options: CliOptions): void {
    const outDir = resolve(REPO_ROOT, options.outDir);
    mkdirSync(outDir, { recursive: true });
    const payload: ReportPayload = {
        generated: new Date().toISOString(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        options,
        rows,
    };
    writeFileSync(
        join(outDir, `${REPORT_NAME}.json`),
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8',
    );
    writeFileSync(join(outDir, `${REPORT_NAME}.md`), renderMarkdown(payload), 'utf8');
    console.log(`Wrote ${join(options.outDir, `${REPORT_NAME}.md`)}`);
    console.log(`Wrote ${join(options.outDir, `${REPORT_NAME}.json`)}`);
}

/**
 * Render markdown report.
 *
 * @param payload report payload.
 * @returns markdown.
 */
function renderMarkdown(payload: ReportPayload): string {
    const rows = payload.rows
        .map(
            row =>
                `| \`${row.name}\` | ${row.tokens} | ${format(row.medianMs)} | ${format(row.meanMs)} | ${row.output.aliasDeclarations} | ${row.output.rewrittenReferences} | ${formatSigned(row.output.byteDelta)} | ${formatSigned(row.output.gzipDelta)} | ${formatSigned(row.output.brotliDelta)} | ${row.note} |`,
        )
        .join('\n');
    return `# Phase H Global Var Mangling Bench

Generated: ${payload.generated}

Environment: ${payload.platform}, ${payload.node}

| Case | Tokens | Median ms | Mean ms | Alias decls | Rewritten refs | Raw Δ bytes | Gzip Δ bytes | Brotli Δ bytes | Note |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

## Notes

- This is a pure pipeline harness, not a production build-hook benchmark.
- Each sample scans CSS, plans aliases, rewrites CSS, transforms TSX without
  aliases, and transforms TSX with aliases using the same plan.
- Negative byte deltas mean alias mode is smaller than disabled mode. Positive
  deltas mean alias declarations cost more than the source/CSS reference
  savings for that fixture.

## Remaining

- Re-run on a real app after production build-hook wiring exists.
- Add end-to-end build wall-time rows once \`mangleGlobalVars.enabled\` can run
  without the feature gate.
`;
}

/**
 * UTF-8 byte length.
 *
 * @param value input string.
 * @returns byte length.
 */
function byteLength(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}

/**
 * Gzip-compressed size.
 *
 * @param value input string.
 * @returns byte length.
 */
function gzipSize(value: string): number {
    return gzipSync(value, { level: 9 }).byteLength;
}

/**
 * Brotli-compressed size.
 *
 * @param value input string.
 * @returns byte length.
 */
function brotliSize(value: string): number {
    return brotliCompressSync(value, {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: 11,
        },
    }).byteLength;
}

/**
 * Average.
 *
 * @param values samples.
 * @returns mean.
 */
function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Median.
 *
 * @param values samples.
 * @returns median.
 */
function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
        : (sorted[middle] ?? 0);
}

/**
 * Format number.
 *
 * @param value number.
 * @returns formatted value.
 */
function format(value: number): string {
    return value.toFixed(3);
}

/**
 * Format signed integer.
 *
 * @param value number.
 * @returns formatted signed value.
 */
function formatSigned(value: number): string {
    return value > 0 ? `+${value}` : String(value);
}
