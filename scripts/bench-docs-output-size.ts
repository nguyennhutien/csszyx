#!/usr/bin/env tsx

/**
 * Benchmarks apps/docs production output size with csszyx CSS-variable
 * optimization modes off and on. This measures artifact bytes after the real
 * Astro/Vite/Tailwind production build, plus gzip and brotli transfer
 * estimates.
 *
 * Usage:
 *   pnpm bench:docs-size
 */

import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

type BenchMode = 'mangle-vars-off' | 'mangle-vars-on' | 'global-vars-on' | 'global-vars-no-map';
type AssetGroup = 'all' | 'runtime' | 'html' | 'js' | 'css' | 'tooling' | 'other';

interface AssetStats {
    files: number;
    bytes: number;
    gzipBytes: number;
    brotliBytes: number;
}

interface BenchRow {
    name: string;
    mode: BenchMode;
    status: 'measured' | 'failed';
    groups: Record<AssetGroup, AssetStats>;
    note: string;
}

interface ReportPayload {
    generated: string;
    node: string;
    platform: string;
    cpuParallelism: number;
    rows: BenchRow[];
}

function noteForMode(mode: BenchMode): string {
    if (mode === 'mangle-vars-on') return 'Rust parser build with CSSZYX_BENCH_MANGLE_VARS=1.';
    if (mode === 'global-vars-on') {
        return 'Rust parser build with CSSZYX_BENCH_MANGLE_GLOBAL_VARS=1.';
    }
    if (mode === 'global-vars-no-map') {
        return 'Rust parser build with CSSZYX_BENCH_MANGLE_GLOBAL_VARS=1 and standalone global-var map disabled.';
    }
    return 'Rust parser build with CSS variable optimizations left disabled.';
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS_ROOT = join(REPO_ROOT, 'apps/docs');
const BACKSLASH = String.fromCodePoint(92);
const DIST_ROOT = join(DOCS_ROOT, 'dist');
const REPORT_MD = join(REPO_ROOT, '.agent/reports/phase-f-docs-mangle-vars-size-bench.md');
const REPORT_JSON = join(REPO_ROOT, '.agent/reports/phase-f-docs-mangle-vars-size-bench.json');
const BUILD_OUTPUTS = [
    DIST_ROOT,
    join(DOCS_ROOT, '.astro'),
    join(DOCS_ROOT, '.csszyx/cache/transform'),
];
const ASSET_GROUPS = [
    'all',
    'runtime',
    'html',
    'js',
    'css',
    'tooling',
    'other',
] as const satisfies readonly AssetGroup[];

const rows = [
    runBuildCase('mangle-vars-off'),
    runBuildCase('mangle-vars-on'),
    runBuildCase('global-vars-on'),
    runBuildCase('global-vars-no-map'),
];
const payload: ReportPayload = {
    generated: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpuParallelism: availableParallelism(),
    rows,
};

mkdirSync(join(REPO_ROOT, '.agent/reports'), { recursive: true });
writeFileSync(REPORT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
writeFileSync(REPORT_MD, renderReport(payload), 'utf8');
console.log(`Wrote ${relative(REPO_ROOT, REPORT_MD)}`);
console.log(`Wrote ${relative(REPO_ROOT, REPORT_JSON)}`);

/**
 * Runs one docs build and collects output sizes.
 *
 * @param mode mangleVars mode
 * @returns benchmark row
 */
function runBuildCase(mode: BenchMode): BenchRow {
    cleanBuildOutputs();

    const result = spawnSync('pnpm', ['--filter', '@csszyx/docs', 'build'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            CSSZYX_BENCH_MANGLE_VARS: mode === 'mangle-vars-on' ? '1' : '0',
            CSSZYX_BENCH_MANGLE_GLOBAL_VARS:
                mode === 'global-vars-on' || mode === 'global-vars-no-map' ? '1' : '0',
            CSSZYX_BENCH_NO_GLOBAL_VAR_MAP: mode === 'global-vars-no-map' ? '1' : '0',
            CSSZYX_PARSER: 'rust',
            NODE_ENV: 'production',
        },
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status !== 0) {
        return {
            name: `docs-output-size/${mode}`,
            mode,
            status: 'failed',
            groups: emptyGroups(),
            note: summarizeFailure(result.stderr || result.stdout),
        };
    }

    return {
        name: `docs-output-size/${mode}`,
        mode,
        status: 'measured',
        groups: collectOutputStats(DIST_ROOT),
        note: noteForMode(mode),
    };
}

/**
 * Clears build output before each size sample.
 */
function cleanBuildOutputs(): void {
    for (const output of BUILD_OUTPUTS) {
        rmSync(output, { force: true, recursive: true });
    }
}

/**
 * Recursively collects output artifact byte counts.
 *
 * @param root build output directory
 * @returns grouped raw/gzip/brotli stats
 */
function collectOutputStats(root: string): Record<AssetGroup, AssetStats> {
    const groups = emptyGroups();
    if (!existsSync(root)) {
        return groups;
    }

    for (const file of walkFiles(root)) {
        const buffer = readFileSync(file);
        const stats = compressedStats(buffer);
        addStats(groups.all, stats);
        if (isGlobalVarToolingMap(root, file)) {
            addStats(groups.tooling, stats);
        } else {
            addStats(groups.runtime, stats);
            addStats(groups[groupForFile(file)], stats);
        }
    }

    return groups;
}

/**
 * Walks files below a directory in stable order.
 *
 * @param root directory to walk
 * @returns file paths
 */
function walkFiles(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root).sort()) {
        const path = join(root, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...walkFiles(path));
        } else if (stat.isFile()) {
            files.push(path);
        }
    }
    return files;
}

/**
 * Maps a file extension to the report group.
 *
 * @param file output file path
 * @returns group name
 */
function groupForFile(file: string): Exclude<AssetGroup, 'all' | 'runtime' | 'tooling'> {
    const extension = extname(file).toLowerCase();
    if (extension === '.html') {
        return 'html';
    }
    if (extension === '.js' || extension === '.mjs') {
        return 'js';
    }
    if (extension === '.css') {
        return 'css';
    }
    return 'other';
}

/**
 * Checks whether a build artifact is g-tier tooling metadata.
 *
 * The standalone global-var map is useful for diagnostics/tooling, but it can
 * dominate small-app transfer deltas. Keeping it separate in reports lets the
 * runtime artifact numbers stay visible without hiding deployed-total cost.
 *
 * @param root build output directory
 * @param file output file path
 * @returns true when the file is the standalone global variable map
 */
function isGlobalVarToolingMap(root: string, file: string): boolean {
    return relative(root, file).split(BACKSLASH).join('/') === '.csszyx/global-var-map.json';
}

/**
 * Computes raw and compressed byte counts for one artifact.
 *
 * @param buffer file contents
 * @returns byte stats
 */
function compressedStats(buffer: Buffer): AssetStats {
    return {
        files: 1,
        bytes: buffer.byteLength,
        gzipBytes: gzipSync(buffer).byteLength,
        brotliBytes: brotliCompressSync(buffer, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).byteLength,
    };
}

/**
 * Adds one stat object into another.
 *
 * @param target stat accumulator
 * @param stats stats to add
 */
function addStats(target: AssetStats, stats: AssetStats): void {
    target.files += stats.files;
    target.bytes += stats.bytes;
    target.gzipBytes += stats.gzipBytes;
    target.brotliBytes += stats.brotliBytes;
}

/**
 * Creates empty group accumulators.
 *
 * @returns empty stats by group
 */
function emptyGroups(): Record<AssetGroup, AssetStats> {
    return Object.fromEntries(
        ASSET_GROUPS.map(group => [group, { files: 0, bytes: 0, gzipBytes: 0, brotliBytes: 0 }]),
    ) as Record<AssetGroup, AssetStats>;
}

/**
 * Keeps failure output short enough for the report.
 *
 * @param output build output
 * @returns failure summary
 */
function summarizeFailure(output: string): string {
    const lines = output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    return (
        lines.find(line => /error|csszyx|vite|astro/i.test(line)) ??
        lines.at(-1) ??
        'build failed'
    )
        .slice(0, 240)
        .split('|')
        .join(`${BACKSLASH}|`);
}

/**
 * Renders markdown report.
 *
 * @param payload report payload
 * @returns markdown
 */
function renderReport(payload: ReportPayload): string {
    const off = payload.rows.find(row => row.mode === 'mangle-vars-off');
    const mangleVarsOn = payload.rows.find(row => row.mode === 'mangle-vars-on');
    const globalVarsOn = payload.rows.find(row => row.mode === 'global-vars-on');
    const globalVarsNoMap = payload.rows.find(row => row.mode === 'global-vars-no-map');
    const summary = [
        renderSummary('mangle-vars-on', off, mangleVarsOn),
        renderSummary('global-vars-on', off, globalVarsOn),
        renderSummary('global-vars-no-map', off, globalVarsNoMap),
    ].join('\n');

    return `# Docs CSS Variable Output Size Benchmark

Generated: ${payload.generated}

Environment:

- Node: ${payload.node}
- Platform: ${payload.platform}
- CPU parallelism: ${payload.cpuParallelism}
- App: \`apps/docs\`
- Parser: Rust
- Compression: Node gzip default; brotli quality 11

## Summary

${summary}

## Results

| Case | Status | Group | Files | Raw bytes | Gzip bytes | Brotli bytes | Note |
|---|---|---|---:|---:|---:|---:|---|
${payload.rows.flatMap(renderRows).join('\n')}

## Interpretation

- This is an end-to-end production artifact-size bench. It includes Astro,
  Vite, Tailwind, csszyx, minification, hashed assets, and generated HTML.
- The \`mangle-vars-on\` row is enabled only by \`CSSZYX_BENCH_MANGLE_VARS=1\`;
  docs production config still keeps \`production.mangleVars\` off by default.
- The \`global-vars-on\` row is enabled only by
  \`CSSZYX_BENCH_MANGLE_GLOBAL_VARS=1\`; docs production config still keeps
  \`production.mangleGlobalVars\` unset by default.
- The \`global-vars-no-map\` row also disables the standalone
  \`.csszyx/global-var-map.json\` asset via
  \`CSSZYX_BENCH_NO_GLOBAL_VAR_MAP=1\`; the manifest still carries
  \`globalVarAliases\`.
- Raw bytes show emitted artifact size. Gzip and brotli bytes better approximate
  transfer size and are the gating numbers for any future default flip.
- The \`runtime\` group excludes only \`.csszyx/global-var-map.json\`; the
  \`all\` group still includes that tooling asset because many deploy pipelines
  publish the whole output directory.
- This report does not measure runtime style invalidation. Keep default-on work
  gated until a runtime harness proves updates stay correct.

## G-tier Remaining

- Need a token-heavy real app before making product-size claims.
- \`autoPrefix\` stays blocked until alias discovery can happen before source
  transforms.
- Runtime fallback alias tables stay deferred unless real apps show frequent
  \`sz={expr}\` global-token usage.
`;
}

/**
 * Renders summary bullets comparing enabled and disabled rows.
 *
 * @param label enabled case label
 * @param off disabled row
 * @param on enabled row
 * @returns markdown bullets
 */
function renderSummary(
    label: BenchMode,
    off: BenchRow | undefined,
    on: BenchRow | undefined,
): string {
    if (!off || !on || off.status !== 'measured' || on.status !== 'measured') {
        return `- ${label}: one or more build cases failed; see the result table.`;
    }

    return ASSET_GROUPS.map(group => {
        const disabled = off.groups[group];
        const enabled = on.groups[group];
        return `- ${label} ${group}: enabled vs disabled ${formatDelta(
            enabled.bytes,
            disabled.bytes,
        )} raw, ${formatDelta(enabled.gzipBytes, disabled.gzipBytes)} gzip, ${formatDelta(
            enabled.brotliBytes,
            disabled.brotliBytes,
        )} brotli.`;
    }).join('\n');
}

/**
 * Renders one row into per-group markdown rows.
 *
 * @param row benchmark row
 * @returns markdown rows
 */
function renderRows(row: BenchRow): string[] {
    return ASSET_GROUPS.map(group => {
        const stats = row.groups[group];
        return `| \`${row.name}\` | ${row.status} | ${group} | ${stats.files} | ${stats.bytes} | ${stats.gzipBytes} | ${stats.brotliBytes} | ${row.note} |`;
    });
}

/**
 * Formats delta and percent change.
 *
 * @param next enabled value
 * @param prev disabled value
 * @returns formatted delta
 */
function formatDelta(next: number, prev: number): string {
    const delta = next - prev;
    if (prev === 0) {
        return `${formatSigned(delta)} bytes`;
    }
    return `${formatSigned(delta)} bytes (${formatSigned((delta / prev) * 100, 2)}%)`;
}

/**
 * Formats signed numeric output.
 *
 * @param value value
 * @param digits decimal digits
 * @returns formatted signed value
 */
function formatSigned(value: number, digits = 0): string {
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(digits)}`;
}
