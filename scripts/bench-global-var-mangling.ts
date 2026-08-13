#!/usr/bin/env tsx
/**
 * Benchmarks Phase H global custom-property aliasing with pure scanner,
 * compiler, and CSS rewrite APIs.
 *
 * Usage:
 *   pnpm bench:global-vars
 *   pnpm bench:global-vars -- --sizes 100,1000 --iterations 7 --warmups 3
 *   pnpm bench:global-vars -- --production-build --production-build-sizes 2,20
 */

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { type PluginOption, build as viteBuild } from 'vite';

import { transformWasm } from '../packages/compiler/src/transform-wasm.js';
import {
    planGlobalVarAliases,
    rewriteGlobalVarCssAliases,
    scanGlobalVarCss,
} from '../packages/unplugin/src/global-var-scanner.js';
import { vitePlugin } from '../packages/unplugin/src/unplugin.js';

interface CliOptions {
    /** Synthetic token counts to benchmark. */
    sizes: number[];
    /** Measured iterations per case. */
    iterations: number;
    /** Warmup iterations per case. */
    warmups: number;
    /** Output directory for markdown and JSON reports. */
    outDir: string;
    /** Include a temporary Vite production build fixture. */
    productionBuild: boolean;
    /** Token counts for temporary Vite production build fixtures. */
    productionBuildSizes: number[];
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

interface ProductionBuildOutput {
    /** Disabled build output text. */
    disabledOutput: string;
    /** Alias build output text. */
    aliasOutput: string;
    /** Number of alias declarations observed in emitted CSS. */
    aliasDeclarations: number;
    /** Number of alias var() references observed in emitted CSS. */
    rewrittenReferences: number;
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPORT_NAME = 'phase-h-global-var-bench';
const requireFromHere = createRequire(import.meta.url);

const options = parseCliOptions(process.argv.slice(2));
const rows = await runBench(options);
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
        productionBuild: false,
        productionBuildSizes: [20],
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
        } else if (arg === '--production-build') {
            options.productionBuild = true;
        } else if (arg === '--production-build-sizes' && next) {
            options.productionBuildSizes = next
                .split(',')
                .map(value => Number.parseInt(value, 10))
                .filter(value => Number.isFinite(value) && value > 0);
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
async function runBench(options: CliOptions): Promise<BenchRow[]> {
    const rows = await Promise.all(
        options.sizes.map(size => {
            const fixture = createFixture(size);
            return measureCase({
                name: `global-vars/${size}/pure-pipeline`,
                tokens: size,
                iterations: options.iterations,
                warmups: options.warmups,
                run: () => runPipeline(fixture),
                note: 'Pure Phase H pipeline: CSS scan/plan/rewrite plus oxc TSX rewrite with the same alias table.',
            });
        }),
    );
    if (options.productionBuild) {
        for (const size of options.productionBuildSizes) {
            rows.push(
                await measureCase({
                    name: `global-vars/${size}/vite-production-build/explicit-tokens`,
                    tokens: size,
                    iterations: Math.max(1, Math.min(options.iterations, 3)),
                    warmups: Math.min(options.warmups, 1),
                    run: () => runViteProductionBuildPipeline(size),
                    note: 'Programmatic Vite production build pair: disabled build plus explicit-token alias build through the real unplugin hooks.',
                }),
            );
        }
    }
    return rows;
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
    run: () => OutputMetrics | Promise<OutputMetrics>;
    note: string;
}): BenchRow | Promise<BenchRow> {
    return measureCaseAsync(input);
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
async function measureCaseAsync(input: {
    name: string;
    tokens: number;
    iterations: number;
    warmups: number;
    run: () => OutputMetrics | Promise<OutputMetrics>;
    note: string;
}): Promise<BenchRow> {
    let output = await input.run();
    for (let index = 0; index < input.warmups; index++) {
        output = await input.run();
    }
    const samplesMs: number[] = [];
    for (let index = 0; index < input.iterations; index++) {
        const start = performance.now();
        output = await input.run();
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
    const disabledSource = transformWasm(fixture.source, '/bench/App.tsx');
    const aliasSource = transformWasm(fixture.source, '/bench/App.tsx', {
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
 * Runs a temporary Vite production build fixture with global aliases disabled
 * and enabled, then compares emitted artifact sizes.
 *
 * @param size Token count for the temporary fixture.
 * @returns output metrics.
 */
async function runViteProductionBuildPipeline(size: number): Promise<OutputMetrics> {
    const output = await runViteProductionBuildPair(size);
    return {
        inputBytes: 0,
        disabledBytes: byteLength(output.disabledOutput),
        aliasBytes: byteLength(output.aliasOutput),
        disabledGzipBytes: gzipSize(output.disabledOutput),
        aliasGzipBytes: gzipSize(output.aliasOutput),
        disabledBrotliBytes: brotliSize(output.disabledOutput),
        aliasBrotliBytes: brotliSize(output.aliasOutput),
        byteDelta: byteLength(output.aliasOutput) - byteLength(output.disabledOutput),
        gzipDelta: gzipSize(output.aliasOutput) - gzipSize(output.disabledOutput),
        brotliDelta: brotliSize(output.aliasOutput) - brotliSize(output.disabledOutput),
        aliasDeclarations: output.aliasDeclarations,
        rewrittenReferences: output.rewrittenReferences,
    };
}

/**
 * Builds one temporary Vite app twice: disabled and explicit-token alias mode.
 *
 * @param size Token count for the temporary fixture.
 * @returns build output text and alias counters.
 */
async function runViteProductionBuildPair(size: number): Promise<ProductionBuildOutput> {
    const fixture = createFixture(size);
    const root = createViteProductionFixture(fixture);
    try {
        const disabledDir = join(root, 'dist-disabled');
        const aliasDir = join(root, 'dist-alias');
        await runViteBuild(root, disabledDir, false, fixture.tokens);
        await runViteBuild(root, aliasDir, true, fixture.tokens);
        const disabledOutput = readOutputBlob(disabledDir);
        const aliasOutput = readOutputBlob(aliasDir);
        if (!aliasOutput.includes('---gz') || !aliasOutput.includes('var(---gz)')) {
            throw new Error(
                'Vite production global-var alias fixture did not emit expected aliases.',
            );
        }
        return {
            disabledOutput,
            aliasOutput,
            aliasDeclarations: countMatches(aliasOutput, /---g[\w-]+:var\(--brand-/g),
            rewrittenReferences: countMatches(aliasOutput, /var\(---g[\w-]+\)/g),
        };
    } finally {
        rmSync(root, { force: true, recursive: true });
    }
}

/**
 * Creates a temporary Vite React fixture with explicit global token usage.
 *
 * @param fixture Synthetic source/CSS fixture.
 * @returns fixture root.
 */
function createViteProductionFixture(fixture: Fixture): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-global-var-vite-'));
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(
        join(root, 'index.html'),
        '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
        'utf8',
    );
    writeFileSync(
        join(src, 'main.tsx'),
        [
            "import React from 'react';",
            "import { createRoot } from 'react-dom/client';",
            "import './theme.css';",
            fixture.source,
            "createRoot(document.getElementById('root')!).render(<App />);",
        ].join('\n'),
        'utf8',
    );
    writeFileSync(join(src, 'theme.css'), fixture.css, 'utf8');
    return root;
}

/**
 * Runs Vite's async build API for one fixture mode.
 *
 * @param root fixture root.
 * @param outDir output directory.
 * @param enabled whether explicit global aliases are enabled.
 * @param tokens explicit global-var tokens.
 */
async function runViteBuild(
    root: string,
    outDir: string,
    enabled: boolean,
    tokens: string[],
): Promise<void> {
    await viteBuild({
        root,
        logLevel: 'silent',
        resolve: {
            alias: [
                {
                    find: 'react/jsx-runtime',
                    replacement: requireFromHere.resolve('react/jsx-runtime'),
                },
                {
                    find: 'react-dom/client',
                    replacement: requireFromHere.resolve('react-dom/client'),
                },
                { find: 'react', replacement: requireFromHere.resolve('react') },
            ],
        },
        plugins: [
            ...(vitePlugin({
                build: { cache: false, parser: 'oxc' },
                production: {
                    mangleGlobalVars: enabled
                        ? {
                              enabled: true,
                              tokens,
                          }
                        : undefined,
                },
            }) as PluginOption[]),
        ],
        build: {
            emptyOutDir: true,
            outDir,
            minify: true,
        },
    });
}

/**
 * Reads all emitted files into one deterministic text blob.
 *
 * @param root output root.
 * @returns output blob.
 */
function readOutputBlob(root: string): string {
    return listFiles(root)
        .map(file => readFileSync(file, 'utf8'))
        .join('\n');
}

/**
 * Lists output files in stable order.
 *
 * @param root output root.
 * @returns file paths.
 */
function listFiles(root: string): string[] {
    if (!existsSync(root)) {
        return [];
    }
    const files: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(fullPath));
        } else if (entry.isFile() && statSync(fullPath).size > 0) {
            files.push(fullPath);
        }
    }
    return files.sort();
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
    const markdownReportPath = join(options.outDir, `${REPORT_NAME}.md`);
    const jsonReportPath = join(options.outDir, `${REPORT_NAME}.json`);
    console.log(`Wrote ${markdownReportPath}`);
    console.log(`Wrote ${jsonReportPath}`);
}

/**
 * Render markdown report.
 *
 * @param payload report payload.
 * @returns markdown.
 */
function renderMarkdown(payload: ReportPayload): string {
    const hasProductionRows = payload.rows.some(row => row.name.includes('vite-production-build'));
    const productionNote = hasProductionRows
        ? '- Vite production rows are temporary fixture builds enabled by `--production-build`; they validate real unplugin build hooks, but the synthetic fixture is not a product-size savings claim.\n'
        : '- Run with `--production-build` to add a temporary Vite production fixture that validates real unplugin build hooks.\n';
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

- Pure pipeline rows scan CSS, plan aliases, rewrite CSS, transform TSX without
  aliases, and transform TSX with aliases using the same plan.
${productionNote}- Wall-time rows include the full measured callback for that case. The Vite
  production row measures a disabled build plus an explicit-token alias build.
- Negative byte deltas mean alias mode is smaller than disabled mode. Positive
  deltas mean alias declarations cost more than the source/CSS reference
  savings for that fixture.

## Remaining

- Re-run on a token-heavy real app before using the production fixture's size
  deltas for product decisions.
- \`autoPrefix\` remains blocked until csszyx can derive the alias table before
  source transforms or proves a safe post-transform JS rewrite strategy.
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

/**
 * Count regex matches in a string.
 *
 * @param value input string.
 * @param pattern global regex.
 * @returns match count.
 */
function countMatches(value: string, pattern: RegExp): number {
    return [...value.matchAll(pattern)].length;
}
