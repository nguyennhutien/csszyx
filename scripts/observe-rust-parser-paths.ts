#!/usr/bin/env tsx
/**
 * Observe native Rust parserPath distribution on repo source fixtures.
 *
 * This is intentionally a reporting harness, not a build hook. It answers
 * whether the narrow AST-free static path is common enough in real app-shaped
 * files to justify widening it before persistent-worker work.
 *
 * Usage:
 *   pnpm observe:rust-parser-paths
 *   pnpm observe:rust-parser-paths -- --roots apps/docs/src,playground/vite-react/src
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    getNativePackageName,
    loadNativeBinding,
    type NativeTransformFile,
    type NativeTransformResult,
    transformBatch,
} from '../packages/core/native/index.js';

interface CliOptions {
    /** Source roots to scan. */
    roots: string[];
    /** Output markdown report. */
    out: string;
    /** Number of files per native batch call. */
    batchSize: number;
}

interface ObservedFile {
    /** Repo-relative filename. */
    filename: string;
    /** Source contents. */
    source: string;
    /** Root label used for grouped stats. */
    root: string;
}

interface ObservationRow {
    /** Source file metadata. */
    file: ObservedFile;
    /** Native transform result. */
    result: NativeTransformResult;
}

interface GroupStats {
    /** Group label. */
    name: string;
    /** File count in this group. */
    files: number;
    /** Files containing an `sz` marker. */
    szMarkerFiles: number;
    /** Files transformed by the native engine. */
    transformedFiles: number;
    /** Files that emitted diagnostics. */
    diagnosticFiles: number;
    /** parserPath counts. */
    parserPaths: Record<string, number>;
    /** Median total native timing in nanoseconds. */
    p50TotalNs: number;
    /** p95 total native timing in nanoseconds. */
    p95TotalNs: number;
    /** Median total timing for files with an sz marker. */
    p50SzTotalNs: number;
    /** p95 total timing for files with an sz marker. */
    p95SzTotalNs: number;
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ROOTS = [
    'apps/docs/src',
    'playground/vite-react/src',
    'playground/live-style/src',
    'playground/nextjs-ssr/app',
    'playground/nextjs-ssr/components',
];
const DEFAULT_OUT = '.agent/reports/phase-e-rust-parser-path-observation.md';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORE_PARTS = new Set([
    'node_modules',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    '.turbo',
]);

const options = readOptions();
const startedAt = new Date();
loadWorkspaceNativeBinding();

const files = collectFiles(options.roots);
const rows = observeFiles(files, options.batchSize);
const report = renderReport(rows);
const outPath = resolve(REPO_ROOT, options.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, report, 'utf8');
console.log(`Wrote ${relative(REPO_ROOT, outPath)}`);

/**
 * Parse CLI options.
 *
 * @returns parsed options
 */
function readOptions(): CliOptions {
    const parsed: CliOptions = {
        roots: DEFAULT_ROOTS,
        out: DEFAULT_OUT,
        batchSize: 128,
    };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--roots') {
            parsed.roots = (args[++i] ?? '')
                .split(',')
                .map(root => root.trim())
                .filter(Boolean);
        } else if (arg === '--out') {
            parsed.out = args[++i] ?? parsed.out;
        } else if (arg === '--batch-size') {
            parsed.batchSize = Math.max(1, Number(args[++i] ?? parsed.batchSize));
        }
    }
    return parsed;
}

/** Load the current workspace native addon. */
function loadWorkspaceNativeBinding(): void {
    const packageName = getNativePackageName();
    if (!packageName) {
        throw new Error('No csszyx native package is defined for this platform.');
    }

    const packageDir = resolve(REPO_ROOT, 'packages', packageName.split('/').pop() ?? '');
    try {
        loadNativeBinding(packageDir);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
            [
                `Unable to load ${packageDir}: ${detail}`,
                'Run: env -u RUSTUP_TOOLCHAIN pnpm --filter @csszyx/core native:build -- --release --clean --native-engine',
            ].join('\n'),
        );
    }
}

/**
 * Collect source files under configured roots.
 *
 * @param roots source roots
 * @returns observed source files
 */
function collectFiles(roots: string[]): ObservedFile[] {
    const files: ObservedFile[] = [];
    for (const root of roots) {
        const absRoot = resolve(REPO_ROOT, root);
        if (!existsSync(absRoot)) {
            continue;
        }
        for (const filename of walk(absRoot)) {
            const repoRelative = relative(REPO_ROOT, filename).replace(/\\/g, '/');
            if (repoRelative.endsWith('.d.ts')) {
                continue;
            }
            files.push({
                filename: repoRelative,
                source: readFileSync(filename, 'utf8'),
                root,
            });
        }
    }
    files.sort((a, b) => a.filename.localeCompare(b.filename));
    return files;
}

/**
 * Recursively walk source files.
 *
 * @param dir directory to walk
 * @returns source file paths
 */
function walk(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE_PARTS.has(entry.name)) {
            continue;
        }
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) {
            files.push(fullPath);
        }
    }
    return files;
}

/**
 * Return a filename extension.
 *
 * @param filename source filename
 * @returns extension including the dot
 */
function extension(filename: string): string {
    const index = filename.lastIndexOf('.');
    return index === -1 ? '' : filename.slice(index);
}

/**
 * Transform files through the native batch API.
 *
 * @param files source files
 * @param batchSize files per native batch call
 * @returns observation rows
 */
function observeFiles(files: ObservedFile[], batchSize: number): ObservationRow[] {
    const rows: ObservationRow[] = [];
    for (let i = 0; i < files.length; i += batchSize) {
        const chunk = files.slice(i, i + batchSize);
        const nativeFiles: NativeTransformFile[] = chunk.map(file => ({
            filename: file.filename,
            source: file.source,
        }));
        const results = transformBatch(nativeFiles);
        if (results.length !== chunk.length) {
            throw new Error(
                `Native batch returned ${results.length} rows for ${chunk.length} files`,
            );
        }
        for (let index = 0; index < chunk.length; index++) {
            const file = chunk[index];
            const result = results[index];
            if (!file || !result) {
                throw new Error(`Missing native batch result for chunk index ${index}`);
            }
            rows.push({
                file,
                result,
            });
        }
    }
    return rows;
}

/**
 * Render the markdown observation report.
 *
 * @param rows observation rows
 * @returns markdown report
 */
function renderReport(rows: ObservationRow[]): string {
    const allStats = summarize('all scanned source files', rows);
    const szRows = rows.filter(row => hasSzMarker(row.file.source));
    const szStats = summarize('files containing `sz` marker', szRows);
    const rootStats = options.roots.map(root =>
        summarize(
            root,
            rows.filter(row => row.file.root === root),
        ),
    );
    const slowRows = [...rows]
        .sort((a, b) => b.result.metadata.timings.totalNs - a.result.metadata.timings.totalNs)
        .slice(0, 10);
    const diagnosticRows = rows.filter(row => row.result.diagnostics.length > 0).slice(0, 20);

    return `# Phase E Rust ParserPath Observation

Generated: ${startedAt.toISOString()}

Environment:
- Node: ${process.version}
- Platform: ${process.platform}-${process.arch}
- Roots: ${options.roots.map(root => `\`${root}\``).join(', ')}
- Batch size: ${options.batchSize}

## Summary

${statsBullets(allStats)}

For files with an \`sz\` marker:

${statsBullets(szStats)}

## Root Breakdown

| Root | Files | sz marker | Transformed | Diagnostics | parserPath | p50 total | p95 total | p50 sz | p95 sz |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
${rootStats.map(statsTableRow).join('\n')}

## Slowest Files

| File | parserPath | Transformed | Total | Diagnostics |
|---|---|---:|---:|---:|
${slowRows.map(slowTableRow).join('\n')}

## Diagnostic Files

${renderDiagnosticRows(diagnosticRows)}

## Interpretation

- \`fastRegex\` includes no-op files and AST-free flat static \`sz\` files; use the \`sz marker\` subset to judge fast-path value.
- If most \`sz\` marker files stay on \`static\`, widening AST-free matching is low leverage.
- Diagnostic rows are expected for unsupported dynamic safety cases; they should stay unchanged until a dedicated runtime-fallback slice owns them.
`;
}

/**
 * Summarize observation rows.
 *
 * @param name group name
 * @param rows observation rows
 * @returns group stats
 */
function summarize(name: string, rows: ObservationRow[]): GroupStats {
    const totalNs = rows.map(row => row.result.metadata.timings.totalNs);
    const szRows = rows.filter(row => hasSzMarker(row.file.source));
    const szTotalNs = szRows.map(row => row.result.metadata.timings.totalNs);
    return {
        name,
        files: rows.length,
        szMarkerFiles: szRows.length,
        transformedFiles: rows.filter(row => row.result.metadata.transformed).length,
        diagnosticFiles: rows.filter(row => row.result.diagnostics.length > 0).length,
        parserPaths: countParserPaths(rows),
        p50TotalNs: percentile(totalNs, 50),
        p95TotalNs: percentile(totalNs, 95),
        p50SzTotalNs: percentile(szTotalNs, 50),
        p95SzTotalNs: percentile(szTotalNs, 95),
    };
}

/**
 * Count parserPath values.
 *
 * @param rows observation rows
 * @returns count by path
 */
function countParserPaths(rows: ObservationRow[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        counts[row.result.parserPath] = (counts[row.result.parserPath] ?? 0) + 1;
    }
    return counts;
}

/**
 * Render stats as bullets.
 *
 * @param stats group stats
 * @returns markdown bullets
 */
function statsBullets(stats: GroupStats): string {
    return [
        `- Files: ${stats.files}`,
        `- sz marker files: ${stats.szMarkerFiles}`,
        `- Transformed files: ${stats.transformedFiles}`,
        `- Diagnostic files: ${stats.diagnosticFiles}`,
        `- parserPath distribution: ${formatParserPaths(stats.parserPaths)}`,
        `- p50 total: ${formatNs(stats.p50TotalNs)}`,
        `- p95 total: ${formatNs(stats.p95TotalNs)}`,
    ].join('\n');
}

/**
 * Render one root stats row.
 *
 * @param stats group stats
 * @returns markdown table row
 */
function statsTableRow(stats: GroupStats): string {
    return `| \`${stats.name}\` | ${stats.files} | ${stats.szMarkerFiles} | ${stats.transformedFiles} | ${stats.diagnosticFiles} | ${formatParserPaths(stats.parserPaths)} | ${formatNs(stats.p50TotalNs)} | ${formatNs(stats.p95TotalNs)} | ${formatNs(stats.p50SzTotalNs)} | ${formatNs(stats.p95SzTotalNs)} |`;
}

/**
 * Render one slow-file row.
 *
 * @param row observation row
 * @returns markdown table row
 */
function slowTableRow(row: ObservationRow): string {
    return `| \`${row.file.filename}\` | ${row.result.parserPath} | ${row.result.metadata.transformed ? 'yes' : 'no'} | ${formatNs(row.result.metadata.timings.totalNs)} | ${row.result.diagnostics.length} |`;
}

/**
 * Render diagnostic rows.
 *
 * @param rows observation rows with diagnostics
 * @returns markdown body
 */
function renderDiagnosticRows(rows: ObservationRow[]): string {
    if (rows.length === 0) {
        return 'No diagnostic files observed.';
    }
    return rows
        .map(row => {
            const diagnostics = row.result.diagnostics
                .map(diagnostic => `  - ${diagnostic.replaceAll('\n', ' ')}`)
                .join('\n');
            return `- \`${row.file.filename}\` (${row.result.parserPath})\n${diagnostics}`;
        })
        .join('\n');
}

/**
 * Format parserPath counts.
 *
 * @param counts parserPath counts
 * @returns formatted counts
 */
function formatParserPaths(counts: Record<string, number>): string {
    const entries = Object.entries(counts);
    if (entries.length === 0) {
        return 'none';
    }
    return entries.map(([path, count]) => `${path}: ${count}`).join(', ');
}

/**
 * Check for a source marker.
 *
 * @param source source text
 * @returns true when source contains sz
 */
function hasSzMarker(source: string): boolean {
    return source.includes('sz');
}

/**
 * Compute percentile over numeric samples.
 *
 * @param samples numeric samples
 * @param percentileValue percentile between 0 and 100
 * @returns percentile sample
 */
function percentile(samples: number[], percentileValue: number): number {
    if (samples.length === 0) {
        return 0;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
    );
    return sorted[index];
}

/**
 * Format nanoseconds.
 *
 * @param ns nanoseconds
 * @returns compact duration
 */
function formatNs(ns: number): string {
    if (ns === 0) {
        return '0 ns';
    }
    if (ns >= 1_000_000) {
        return `${(ns / 1_000_000).toFixed(3)} ms`;
    }
    if (ns >= 1_000) {
        return `${(ns / 1_000).toFixed(2)} us`;
    }
    return `${Math.round(ns)} ns`;
}
