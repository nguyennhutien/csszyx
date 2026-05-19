#!/usr/bin/env tsx
/**
 * Benchmarks the Phase E transform cache and Babel-vs-oxc parser paths.
 *
 * Usage:
 *   pnpm bench:transform-cache
 *   pnpm bench:transform-cache -- --sizes 100,1000 --iterations 5
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { transformSourceCode } from '../packages/compiler/src/transform.js';
import { transformOxc } from '../packages/compiler/src/transform-oxc.js';
import { transformRust, transformRustBatch } from '../packages/compiler/src/transform-rust.js';
import { loadNativeBinding } from '../packages/core/native/index.js';
import {
    createTransformCacheKey,
    readTransformCache,
    resolveTransformCacheDir,
    type TransformCacheKeyInput,
    writeTransformCache,
} from '../packages/unplugin/src/transform-cache.js';

interface CliOptions {
    /** Synthetic project sizes to benchmark. */
    sizes: number[];
    /** Number of measured iterations per benchmark case. */
    iterations: number;
    /** Number of warmup iterations before measuring. */
    warmups: number;
    /** Number of one-file edits in the HMR-shaped benchmark. */
    hmrEdits: number;
    /** Output directory for markdown reports. */
    outDir: string;
}

interface BenchStats {
    /** Case label. */
    name: string;
    /** Number of files transformed or checked per iteration. */
    files: number;
    /** Median milliseconds per full iteration. */
    medianMs: number;
    /** Mean milliseconds per full iteration. */
    meanMs: number;
    /** Minimum milliseconds per full iteration. */
    minMs: number;
    /** Maximum milliseconds per full iteration. */
    maxMs: number;
    /** Median files processed per second. */
    filesPerSecond: number;
    /** Notes for report readers. */
    note: string;
    /** Whether the row measured successfully or documents a scaffold state. */
    status: 'measured' | 'not-implemented';
}

interface ParserFixture {
    /** Fixture label. */
    name: string;
    /** Fixture source code. */
    source: string;
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT_DIR = '.agent/reports';
const PLUGIN_VERSION = '0.8.0';
const COMPILER_VERSION = '0.8.0';

const options = readOptions();
const startedAt = new Date();
const nodeVersion = process.version;
const platform = `${process.platform}-${process.arch}`;

const NATIVE_RUST_AVAILABLE = tryPreloadRustBinding();

/**
 * Attempt to preload the Rust native addon from the workspace platform
 * package. Returns true when `transformBatch()` is reachable through
 * `transformRust()`. Returns false silently when the addon has not been
 * built — the bench still runs, Rust rows fall back to the
 * not-implemented placeholder, and the report makes the gap visible
 * instead of crashing the suite.
 *
 * @returns true when the native binding loaded and answered a sentinel call.
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
    } catch {
        return false;
    }
    // Final smoke: `transformRust` must reach the binding through the public
    // entry without throwing `OxcRustNotImplementedError`.
    try {
        transformRust('const X = () => <div sz={{ p: 4 }} />;', '/bench/preload.tsx');
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect musl libc on Linux so the platform-package directory name
 * matches the loader's expectation.
 *
 * @returns true on musl-based Linux, false on glibc or non-Linux hosts.
 */
function isMusl(): boolean {
    const report = process.report?.getReport?.();
    if (!report || typeof report !== 'object') {
        return false;
    }
    const header = (report as { header?: { glibcVersionRuntime?: string } }).header;
    return !header?.glibcVersionRuntime;
}

const cacheReport = runCacheBenchmarks(options);
const parserReport = runParserBenchmarks(options);

mkdirSync(resolve(REPO_ROOT, options.outDir), { recursive: true });
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-transform-cache-bench.md'),
    renderCacheReport(cacheReport),
    'utf8',
);
writeFileSync(
    resolve(REPO_ROOT, options.outDir, 'phase-e-babel-vs-oxc-bench.md'),
    renderParserReport(parserReport),
    'utf8',
);

console.log(`Wrote ${join(options.outDir, 'phase-e-transform-cache-bench.md')}`);
console.log(`Wrote ${join(options.outDir, 'phase-e-babel-vs-oxc-bench.md')}`);

/**
 * Parse CLI options.
 *
 * @returns Parsed CLI options.
 */
function readOptions(): CliOptions {
    const args = process.argv.slice(2);
    const parsed: CliOptions = {
        sizes: [100, 1000],
        iterations: 5,
        warmups: 2,
        hmrEdits: 1000,
        outDir: DEFAULT_OUT_DIR,
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
        } else if (arg === '--hmr-edits') {
            parsed.hmrEdits = Math.max(1, Number(args[++i] ?? parsed.hmrEdits));
        } else if (arg === '--out-dir') {
            parsed.outDir = args[++i] ?? parsed.outDir;
        }
    }

    return parsed;
}

/**
 * Run transform-cache benchmark cases.
 *
 * @param opts CLI options.
 * @returns benchmark stats.
 */
function runCacheBenchmarks(opts: CliOptions): BenchStats[] {
    const stats: BenchStats[] = [];

    for (const size of opts.sizes) {
        const szFiles = createFiles(size, true);
        const noSzFiles = createFiles(size, false);

        stats.push(
            measureCase(
                `cache/${size}/no-cache-oxc-transform`,
                size,
                opts,
                () => {
                    for (const file of szFiles) {
                        transformOxc(file.source, file.filename);
                    }
                },
                'Baseline: transform every sz file with oxc and do no cache I/O.',
            ),
        );

        stats.push(
            measureCase(
                `cache/${size}/cold-transform-and-write`,
                size,
                opts,
                () => {
                    const root = mkdtempSync(join(tmpdir(), 'csszyx-bench-cold-'));
                    try {
                        const cacheRoot = resolveTransformCacheDir(root);
                        for (const file of szFiles) {
                            const input = cacheInput(file.filename, file.source);
                            const result = transformOxc(file.source, file.filename);
                            writeTransformCache(cacheRoot, input, result);
                        }
                    } finally {
                        rmSync(root, { recursive: true, force: true });
                    }
                },
                'Cold cache: transform every sz file and write one JSON entry per file.',
            ),
        );

        const warmRoot = mkdtempSync(join(tmpdir(), 'csszyx-bench-warm-'));
        try {
            const warmCacheRoot = resolveTransformCacheDir(warmRoot);
            for (const file of szFiles) {
                writeTransformCache(
                    warmCacheRoot,
                    cacheInput(file.filename, file.source),
                    transformOxc(file.source, file.filename),
                );
            }
            stats.push(
                measureCase(
                    `cache/${size}/warm-read-hit`,
                    size,
                    opts,
                    () => {
                        for (const file of szFiles) {
                            const cached = readTransformCache(
                                warmCacheRoot,
                                cacheInput(file.filename, file.source),
                            );
                            if (!cached) {
                                throw new Error(`missing cache entry for ${file.filename}`);
                            }
                        }
                    },
                    'Warm cache: read every sz transform from pre-populated disk JSON.',
                ),
            );
        } finally {
            rmSync(warmRoot, { recursive: true, force: true });
        }

        const memoryCache = new Map<string, ReturnType<typeof transformOxc>>();
        for (const file of szFiles) {
            const input = cacheInput(file.filename, file.source);
            memoryCache.set(
                createTransformCacheKey(input).key,
                transformOxc(file.source, file.filename),
            );
        }
        stats.push(
            measureCase(
                `cache/${size}/l1-memory-hit`,
                size,
                opts,
                () => {
                    for (const file of szFiles) {
                        const input = cacheInput(file.filename, file.source);
                        const cached = memoryCache.get(createTransformCacheKey(input).key);
                        if (!cached) {
                            throw new Error(`missing memory entry for ${file.filename}`);
                        }
                    }
                },
                'L1 memory cache: read every sz transform from an in-process Map.',
            ),
        );

        stats.push(
            measureCase(
                `cache/${size}/no-sz-gate-check`,
                size,
                opts,
                () => {
                    let matches = 0;
                    for (const file of noSzFiles) {
                        if (hasSzProp(file.source)) {
                            matches++;
                        }
                    }
                    if (matches !== 0) {
                        throw new Error('no-sz fixture unexpectedly matched the sz gate');
                    }
                },
                'Actual unplugin gate for files with no sz prop; cache is never entered.',
            ),
        );

        stats.push(
            measureCase(
                `cache/${size}/no-sz-oxc-fast-path`,
                size,
                opts,
                () => {
                    for (const file of noSzFiles) {
                        transformOxc(file.source, file.filename);
                    }
                },
                'Compiler-only no-sz fast path for comparison; real unplugin skips before this.',
            ),
        );
    }

    return stats;
}

/**
 * Run Babel-vs-oxc benchmark cases.
 *
 * @param opts CLI options.
 * @returns benchmark stats.
 */
function runParserBenchmarks(opts: CliOptions): BenchStats[] {
    const fixtureSet = createParserFixtures();
    const repeated = repeatFixtures(fixtureSet, Math.max(...opts.sizes));
    const stats: BenchStats[] = [];

    for (const size of opts.sizes) {
        const files = repeated.slice(0, size);
        stats.push(
            measureCase(
                `parser/${size}/babel-transformSourceCode`,
                size,
                opts,
                () => {
                    for (const file of files) {
                        transformSourceCode(file.source, file.filename);
                    }
                },
                'Babel compatibility path via transformSourceCode().',
            ),
        );
        stats.push(
            measureCase(
                `parser/${size}/oxc-transformOxc`,
                size,
                opts,
                () => {
                    for (const file of files) {
                        transformOxc(file.source, file.filename);
                    }
                },
                'Default oxc-parser + magic-string path.',
            ),
        );
        if (NATIVE_RUST_AVAILABLE) {
            stats.push(
                measureCase(
                    `parser/${size}/rust-transformRust`,
                    size,
                    opts,
                    () => {
                        for (const file of files) {
                            transformRust(file.source, file.filename);
                        }
                    },
                    'Rust native maximum-speed parser path (oxc-parser + string_wizard via napi-rs).',
                ),
            );
            stats.push(
                measureCase(
                    `parser/${size}/rust-transformRustBatch`,
                    size,
                    opts,
                    () => {
                        const results = transformRustBatch(files);
                        if (results.length !== files.length) {
                            throw new Error(
                                `Rust batch returned ${results.length} results for ${files.length} files`,
                            );
                        }
                    },
                    'Rust native batch parser path: one napi-rs transformBatch call for the full fixture set.',
                ),
            );
        } else {
            assertRustScaffoldThrows(
                files[0]?.source ?? '',
                files[0]?.filename ?? '/bench/rust.tsx',
            );
            stats.push(
                notImplementedCase(
                    `parser/${size}/rust-transformRust`,
                    size,
                    'Rust native addon not built for this host. Run `pnpm --filter @csszyx/core native:build -- --native-engine` to enable measured Rust rows.',
                ),
            );
            stats.push(
                notImplementedCase(
                    `parser/${size}/rust-transformRustBatch`,
                    size,
                    'Rust native addon not built for this host. Run `pnpm --filter @csszyx/core native:build -- --native-engine` to enable measured Rust batch rows.',
                ),
            );
        }
    }

    const hmrFiles = createHmrFiles(opts.hmrEdits);
    stats.push(
        measureCase(
            'parser/hmr/oxc-transformOxc',
            opts.hmrEdits,
            opts,
            () => {
                for (const file of hmrFiles) {
                    transformOxc(file.source, file.filename);
                }
            },
            'HMR-shaped baseline: one edited file per transform call through oxc-JS.',
        ),
    );
    if (NATIVE_RUST_AVAILABLE) {
        stats.push(
            measureCase(
                'parser/hmr/rust-transformRust',
                opts.hmrEdits,
                opts,
                () => {
                    for (const file of hmrFiles) {
                        transformRust(file.source, file.filename);
                    }
                },
                'HMR-shaped Rust path: one edited file per transformRust call.',
            ),
        );
        stats.push(
            measureCase(
                'parser/hmr/rust-transformRustBatch1',
                opts.hmrEdits,
                opts,
                () => {
                    for (const file of hmrFiles) {
                        const [result] = transformRustBatch([file]);
                        if (!result) {
                            throw new Error(`missing Rust batch result for ${file.filename}`);
                        }
                    }
                },
                'HMR-shaped Rust batch-of-one path: one napi transformBatch call per edited file.',
            ),
        );
    } else {
        stats.push(
            notImplementedCase(
                'parser/hmr/rust-transformRust',
                opts.hmrEdits,
                'Rust native addon not built for this host.',
            ),
        );
        stats.push(
            notImplementedCase(
                'parser/hmr/rust-transformRustBatch1',
                opts.hmrEdits,
                'Rust native addon not built for this host.',
            ),
        );
    }

    for (const fixture of fixtureSet) {
        stats.push(
            measureCase(
                `parser/fixture/${fixture.name}/babel`,
                1,
                opts,
                () => {
                    transformSourceCode(fixture.source, `/bench/${fixture.name}.tsx`);
                },
                'Single-fixture Babel path timing.',
            ),
        );
        stats.push(
            measureCase(
                `parser/fixture/${fixture.name}/oxc`,
                1,
                opts,
                () => {
                    transformOxc(fixture.source, `/bench/${fixture.name}.tsx`);
                },
                'Single-fixture oxc path timing.',
            ),
        );
        if (NATIVE_RUST_AVAILABLE) {
            stats.push(
                measureCase(
                    `parser/fixture/${fixture.name}/rust`,
                    1,
                    opts,
                    () => {
                        transformRust(fixture.source, `/bench/${fixture.name}.tsx`);
                    },
                    'Single-fixture Rust path timing.',
                ),
            );
        } else {
            stats.push(
                notImplementedCase(
                    `parser/fixture/${fixture.name}/rust`,
                    1,
                    'Rust native addon not built for this host.',
                ),
            );
        }
    }

    return stats;
}

/**
 * Assert that the Rust parser scaffold is still an explicit throw, not a silent fallback.
 *
 * @param source fixture source
 * @param filename fixture filename
 */
function assertRustScaffoldThrows(source: string, filename: string): void {
    try {
        transformRust(source, filename);
    } catch (err) {
        if (err instanceof Error && err.name === 'OxcRustNotImplementedError') {
            return;
        }
        throw err;
    }
    throw new Error('transformRust unexpectedly returned a result');
}

/**
 * Measure one benchmark case.
 *
 * @param name case label
 * @param files file count
 * @param opts CLI options
 * @param fn measured function
 * @param note report note
 * @returns benchmark stats
 */
function measureCase(
    name: string,
    files: number,
    opts: CliOptions,
    fn: () => void,
    note: string,
): BenchStats {
    for (let i = 0; i < opts.warmups; i++) {
        fn();
    }

    const samples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
        const start = performance.now();
        fn();
        samples.push(performance.now() - start);
    }

    const medianMs = median(samples);
    return {
        name,
        files,
        medianMs,
        meanMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        filesPerSecond: (files / medianMs) * 1000,
        note,
        status: 'measured',
    };
}

/**
 * Create a placeholder benchmark row for a parser path that is wired but not implemented.
 *
 * @param name case label
 * @param files file count
 * @param note report note
 * @returns not-implemented benchmark stats
 */
function notImplementedCase(name: string, files: number, note: string): BenchStats {
    return {
        name,
        files,
        medianMs: 0,
        meanMs: 0,
        minMs: 0,
        maxMs: 0,
        filesPerSecond: 0,
        note,
        status: 'not-implemented',
    };
}

/**
 * Create synthetic source files.
 *
 * @param count number of files
 * @param withSz whether fixtures should include sz props
 * @returns generated file fixtures
 */
function createFiles(count: number, withSz: boolean): Array<{ filename: string; source: string }> {
    return Array.from({ length: count }, (_, index) => ({
        filename: `/bench/src/File${index}.tsx`,
        source: withSz ? createSzSource(index) : createNoSzSource(index),
    }));
}

/**
 * Create one sz fixture.
 *
 * @param index fixture index
 * @returns TSX source
 */
function createSzSource(index: number): string {
    return `
const styles${index} = {
  card: { p: ${index % 8}, bg: 'slate-900', color: 'white', rounded: 'lg' },
  button: { px: 4, py: 2, hover: { bg: 'slate-800' }, md: { text: 'lg' } },
} as const;

export function Component${index}({ active, tone }: { active: boolean; tone: string }) {
  const pad = active ? 6 : 3;
  return (
    <section sz={styles${index}.card}>
      <button sz={{ ...styles${index}.button, p: pad, borderColor: tone }}>
        Save
      </button>
    </section>
  );
}
`;
}

/**
 * Create one no-sz fixture.
 *
 * @param index fixture index
 * @returns TSX source
 */
function createNoSzSource(index: number): string {
    return `
export function Plain${index}({ active }: { active: boolean }) {
  const label = active ? 'Enabled' : 'Disabled';
  return <button className={active ? 'is-active' : 'is-idle'}>{label}</button>;
}
`;
}

/**
 * Create HMR-shaped one-file edit fixtures.
 *
 * @param count number of simulated edits
 * @returns TSX source variants for a single hot module
 */
function createHmrFiles(count: number): Array<{ filename: string; source: string }> {
    return Array.from({ length: count }, (_, index) => ({
        filename: '/bench/src/HotModule.tsx',
        source: `const BASE = { p: ${index % 8}, bg: 'blue-500' } as const;
export function HotModule({ active }: { active: boolean }) {
  return <div sz={active ? BASE : { p: ${(index + 1) % 8}, bg: 'red-500' }} />;
}
`,
    }));
}

/**
 * Create parser comparison fixtures.
 *
 * @returns parser fixtures
 */
function createParserFixtures(): ParserFixture[] {
    return [
        {
            name: 'static-object',
            source: `export const App = () => <div sz={{ p: 4, bg: 'red-500', hover: { bg: 'red-600' } }} />;`,
        },
        {
            name: 'string-sz',
            source: `export const App = () => <div sz="p-4 bg-red-500 hover:bg-red-600" />;`,
        },
        {
            name: 'local-binding-spread',
            source: `const base = { p: 4, bg: 'red-500' } as const; export const App = () => <div sz={{ ...base, hover: { bg: 'red-600' } }} />;`,
        },
        {
            name: 'css-var',
            source: `export const App = ({ pad }: { pad: number }) => <div sz={{ p: pad, bg: 'red-500' }} />;`,
        },
        {
            name: 'array-conditional',
            source: `const base = { p: 4 } as const; export const App = ({ active }: { active: boolean }) => <div sz={[base, active && { bg: 'red-500' }]} />;`,
        },
        {
            name: 'recovery-token',
            source: `export const App = () => <div szRecover="csr" sz={{ p: 4, bg: 'red-500' }} />;`,
        },
        {
            name: 'no-sz',
            source: `export const App = ({ active }: { active: boolean }) => <div className={active ? 'on' : 'off'} />;`,
        },
    ];
}

/**
 * Repeat fixtures to a requested count.
 *
 * @param fixtures base fixtures
 * @param count requested count
 * @returns repeated file fixtures
 */
function repeatFixtures(
    fixtures: ParserFixture[],
    count: number,
): Array<{ filename: string; source: string }> {
    return Array.from({ length: count }, (_, index) => {
        const fixture = fixtures[index % fixtures.length];
        return {
            filename: `/bench/parser/${fixture.name}-${index}.tsx`,
            source: fixture.source.replaceAll('App', `App${index}`),
        };
    });
}

/**
 * Create cache-key input for one source file.
 *
 * @param filename source filename
 * @param source source code
 * @returns transform cache input
 */
function cacheInput(filename: string, source: string): TransformCacheKeyInput {
    return {
        pluginVersion: PLUGIN_VERSION,
        compilerVersion: COMPILER_VERSION,
        parserMode: 'oxc',
        producer: 'oxc',
        filename,
        source,
    };
}

/**
 * Match the unplugin sz gate used before compiler/cache work.
 *
 * @param source source code
 * @returns true when the file should enter source transform
 */
function hasSzProp(source: string): boolean {
    return source.includes('sz=') || /\bsz\s*:\s*["'{]/.test(source) || source.includes('sz: "');
}

/**
 * Compute the median of timing samples.
 *
 * @param samples timing samples
 * @returns median sample
 */
function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
}

/**
 * Render transform-cache markdown report.
 *
 * @param stats benchmark stats
 * @returns markdown report
 */
function renderCacheReport(stats: BenchStats[]): string {
    const rows = stats.map(stat => tableRow(stat)).join('\n');
    const speedups = options.sizes
        .map(size => {
            const baseline = findStat(stats, `cache/${size}/no-cache-oxc-transform`);
            const warm = findStat(stats, `cache/${size}/warm-read-hit`);
            const memory = findStat(stats, `cache/${size}/l1-memory-hit`);
            const cold = findStat(stats, `cache/${size}/cold-transform-and-write`);
            return `- ${size} sz files: warm cache is ${formatComparison(
                baseline.medianMs,
                warm.medianMs,
            )} than no-cache oxc; L1 memory is ${formatComparison(
                baseline.medianMs,
                memory.medianMs,
            )} than no-cache oxc; cold write is ${formatRatio(
                cold.medianMs / baseline.medianMs,
            )}x the no-cache baseline.`;
        })
        .join('\n');

    return `# Phase E Transform Cache Benchmark

Generated: ${startedAt.toISOString()}

Environment:
- Node: ${nodeVersion}
- Platform: ${platform}
- Iterations: ${options.iterations}
- Warmups: ${options.warmups}

## Summary

${speedups}

The no-sz case measures the real pre-transform gate separately. Files with no sz prop do not enter the transform cache, so the relevant risk is the string/regex gate cost rather than disk cache overhead.

## Results

| Case | Status | Files | Median ms | Mean ms | Min ms | Max ms | Files/sec | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
${rows}

## Interpretation

- Warm cache should beat no-cache oxc by enough margin to justify disk serialization.
- Cold cache may be slightly slower than no-cache because it transforms and writes JSON.
- If no-sz gate timing is non-trivial, optimize the gate before adding cache work to no-sz paths.
- The L1 row measures the in-process Map layer now used before disk reads.
`;
}

/**
 * Render Babel-vs-oxc markdown report.
 *
 * @param stats benchmark stats
 * @returns markdown report
 */
function renderParserReport(stats: BenchStats[]): string {
    const rows = stats.map(stat => tableRow(stat)).join('\n');
    const speedups = options.sizes
        .map(size => {
            const babel = findStat(stats, `parser/${size}/babel-transformSourceCode`);
            const oxc = findStat(stats, `parser/${size}/oxc-transformOxc`);
            const rust = findStat(stats, `parser/${size}/rust-transformRust`);
            const rustBatch = findStat(stats, `parser/${size}/rust-transformRustBatch`);
            const oxcRatio = `oxc is ${formatRatio(babel.medianMs / oxc.medianMs)}x faster than Babel`;
            const rustClause =
                rust.status === 'measured'
                    ? `rust is ${formatRatio(babel.medianMs / rust.medianMs)}x faster than Babel and ${formatRatio(oxc.medianMs / rust.medianMs)}x faster than oxc-JS`
                    : `${rust.name} is ${rust.status}`;
            const rustBatchClause =
                rustBatch.status === 'measured'
                    ? `rust batch is ${formatRatio(rust.medianMs / rustBatch.medianMs)}x vs per-file Rust and ${formatRatio(oxc.medianMs / rustBatch.medianMs)}x vs oxc-JS`
                    : `${rustBatch.name} is ${rustBatch.status}`;
            return `- ${size} mixed fixtures: ${oxcRatio} by median batch time; ${rustClause}; ${rustBatchClause}.`;
        })
        .join('\n');

    return `# Phase E Babel vs OXC Benchmark

Generated: ${startedAt.toISOString()}

Environment:
- Node: ${nodeVersion}
- Platform: ${platform}
- Iterations: ${options.iterations}
- Warmups: ${options.warmups}
- HMR edits: ${options.hmrEdits}

## Summary

${speedups}

${renderHmrSummary(stats)}

The batch fixtures repeat representative csszyx patterns: static object, string sz, local binding spread, dynamic CSS var, conditional array, recovery token, and no-sz fast path. Rust rows intentionally report not-implemented during the scaffold phase so the harness shape is ready before Rust timings exist.

## Results

| Case | Status | Files | Median ms | Mean ms | Min ms | Max ms | Files/sec | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
${rows}

## Interpretation

- Batch rows show the expected project-level parser delta.
- HMR rows simulate many one-file edits and should guide whether persistent
  worker lifecycle work is worth the complexity.
- Single-fixture rows expose which syntax shapes are expensive enough to skew a project.
- The benchmark measures compiler transform cost only; bundler scheduling, Tailwind scanning, and mangle finalization are outside this harness.
`;
}

/**
 * Render the HMR-shaped benchmark summary.
 *
 * @param stats benchmark stats
 * @returns markdown bullet list
 */
function renderHmrSummary(stats: BenchStats[]): string {
    const oxc = findStat(stats, 'parser/hmr/oxc-transformOxc');
    const rust = findStat(stats, 'parser/hmr/rust-transformRust');
    const rustBatch = findStat(stats, 'parser/hmr/rust-transformRustBatch1');
    if (rust.status !== 'measured' || rustBatch.status !== 'measured') {
        return `- HMR-shaped ${options.hmrEdits} edits: Rust native addon not built; HMR Rust rows are not implemented.`;
    }
    return [
        `- HMR-shaped ${options.hmrEdits} edits: rust is ${formatRatio(
            oxc.medianMs / rust.medianMs,
        )}x faster than oxc-JS.`,
        `- HMR-shaped ${options.hmrEdits} edits: rust batch-of-one is ${formatRatio(
            oxc.medianMs / rustBatch.medianMs,
        )}x faster than oxc-JS and ${formatRatio(
            rust.medianMs / rustBatch.medianMs,
        )}x vs per-file Rust.`,
    ].join('\n');
}

/**
 * Find one stats row.
 *
 * @param stats all stats
 * @param name case name
 * @returns matching stat
 */
function findStat(stats: BenchStats[], name: string): BenchStats {
    const stat = stats.find(item => item.name === name);
    if (!stat) {
        throw new Error(`missing benchmark stat: ${name}`);
    }
    return stat;
}

/**
 * Render one markdown table row.
 *
 * @param stat benchmark stat
 * @returns markdown table row
 */
function tableRow(stat: BenchStats): string {
    return `| \`${stat.name}\` | ${stat.status} | ${stat.files} | ${formatMs(
        stat.medianMs,
    )} | ${formatMs(stat.meanMs)} | ${formatMs(stat.minMs)} | ${formatMs(
        stat.maxMs,
    )} | ${Math.round(stat.filesPerSecond).toLocaleString()} | ${stat.note} |`;
}

/**
 * Format milliseconds.
 *
 * @param ms milliseconds
 * @returns formatted string
 */
function formatMs(ms: number): string {
    return ms.toFixed(ms < 10 ? 3 : 2);
}

/**
 * Format a speed ratio.
 *
 * @param ratio speed ratio
 * @returns formatted ratio
 */
function formatRatio(ratio: number): string {
    return ratio.toFixed(2);
}

/**
 * Format a faster/slower comparison.
 *
 * @param baselineMs baseline duration
 * @param candidateMs candidate duration
 * @returns human-readable comparison
 */
function formatComparison(baselineMs: number, candidateMs: number): string {
    if (candidateMs <= baselineMs) {
        return `${formatRatio(baselineMs / candidateMs)}x faster`;
    }
    return `${formatRatio(candidateMs / baselineMs)}x slower`;
}
