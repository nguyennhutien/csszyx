#!/usr/bin/env tsx
/**
 * Benchmarks @csszyx/cli Tailwind className -> sz migration hot paths.
 *
 * Usage:
 *   pnpm bench:cli-migrate
 *   pnpm bench:cli-migrate -- --sizes 100,1000 --iterations 7 --warmups 3
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { transformSource } from '../packages/cli/src/migrate/ast-transformer.js';
import { classNameToSzObject } from '../packages/cli/src/migrate/variant-parser.js';

interface CliOptions {
    /** Synthetic component counts to benchmark. */
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
    /** Number of class strings/components processed per sample. */
    items: number;
    /** Median sample milliseconds. */
    medianMs: number;
    /** Mean sample milliseconds. */
    meanMs: number;
    /** Minimum sample milliseconds. */
    minMs: number;
    /** Maximum sample milliseconds. */
    maxMs: number;
    /** Median items processed per second. */
    itemsPerSecond: number;
    /** Raw measured samples. */
    samplesMs: number[];
    /** Human-readable note. */
    note: string;
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

interface FixtureSet {
    /** Repeated class strings shaped like design-system components. */
    repeatedClassNames: string[];
    /** Mostly unique class strings shaped like generated migration input. */
    uniqueClassNames: string[];
    /** JSX source with one static className per component. */
    staticSource: string;
    /** JSX source with clsx/ternary/template migration patterns. */
    dynamicSource: string;
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT_NAME = 'phase-g-cli-migrate-max-speed-bench';

const options = parseArgs(process.argv.slice(2));
const rows = runBenchmarks(options);
const payload: ReportPayload = {
    generated: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    options,
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
 * Parse CLI args.
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
 * Run all benchmark cases.
 *
 * @param opts CLI options.
 * @returns benchmark rows.
 */
function runBenchmarks(opts: CliOptions): BenchRow[] {
    const rows: BenchRow[] = [];

    for (const size of opts.sizes) {
        const fixtures = createFixtures(size);

        rows.push(
            measureCase(
                `cli-migrate/${size}/reverse-repeated`,
                size,
                opts,
                () => {
                    for (const className of fixtures.repeatedClassNames) {
                        classNameToSzObject(className);
                    }
                },
                'Reverse parser only. Repeated design-system class strings exercise token-cache hits.',
            ),
            measureCase(
                `cli-migrate/${size}/reverse-unique`,
                size,
                opts,
                () => {
                    for (const className of fixtures.uniqueClassNames) {
                        classNameToSzObject(className);
                    }
                },
                'Reverse parser only. Mostly unique arbitrary values exercise cache-miss overhead.',
            ),
            measureCase(
                `cli-migrate/${size}/ast-static`,
                size,
                opts,
                () => {
                    transformSource(fixtures.staticSource, `/bench/static-${size}.tsx`);
                },
                'Full JSX/TSX migration with one static className per component.',
            ),
            measureCase(
                `cli-migrate/${size}/ast-dynamic`,
                size,
                opts,
                () => {
                    transformSource(fixtures.dynamicSource, `/bench/dynamic-${size}.tsx`);
                },
                'Full JSX/TSX migration with clsx, ternary, logical, and template literal patterns.',
            ),
        );
    }

    return rows;
}

/**
 * Create synthetic migration fixtures.
 *
 * @param size number of component/className entries.
 * @returns fixture set.
 */
function createFixtures(size: number): FixtureSet {
    const repeatedTemplates = [
        'flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-sm hover:bg-gray-50 md:px-6',
        'grid grid-cols-2 gap-4 rounded-xl bg-blue-500 p-6 text-white md:grid-cols-4 dark:bg-blue-600',
        'relative overflow-hidden rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium',
        'inline-flex items-center justify-center rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white',
    ];

    const repeatedClassNames = Array.from(
        { length: size },
        (_, index) => repeatedTemplates[index % repeatedTemplates.length],
    );

    const uniqueClassNames = Array.from({ length: size }, (_, index) => {
        const color = ['red', 'blue', 'emerald', 'violet', 'amber'][index % 5];
        const shade = 100 + (index % 8) * 100;
        const width = 160 + index;
        return [
            'flex',
            'items-center',
            `gap-${(index % 6) + 1}`,
            `p-${(index % 8) + 1}`,
            `bg-${color}-${shade}`,
            `hover:bg-${color}-${Math.min(shade + 100, 900)}`,
            `w-[${width}px]`,
            `min-[${320 + (index % 12) * 10}px]:grid`,
        ].join(' ');
    });

    const staticLines = repeatedClassNames.map(
        (className, index) =>
            `export const Static${index} = () => <div className="${className}" data-i="${index}" />;`,
    );

    const dynamicLines = repeatedClassNames.map((className, index) => {
        const alternate = uniqueClassNames[index];
        if (index % 4 === 0) {
            return `export const Dynamic${index} = ({ active }) => <div className={clsx("${className}", active && "ring-2 ring-blue-500")} />;`;
        }
        if (index % 4 === 1) {
            return `export const Dynamic${index} = ({ active }) => <div className={active ? "${className}" : "${alternate}"} />;`;
        }
        if (index % 4 === 2) {
            return `export const Dynamic${index} = ({ open }) => <div className={open && "${className}"} />;`;
        }
        return `export const Dynamic${index} = ({ active }) => <div className={\`${className} \${active ? "opacity-100" : "opacity-50"}\`} />;`;
    });

    return {
        repeatedClassNames,
        uniqueClassNames,
        staticSource: `${staticLines.join('\n')}\n`,
        dynamicSource: `import clsx from 'clsx';\n${dynamicLines.join('\n')}\n`,
    };
}

/**
 * Measure one benchmark case.
 *
 * @param name case label.
 * @param items number of items processed per sample.
 * @param opts CLI options.
 * @param run case body.
 * @param note report note.
 * @returns row stats.
 */
function measureCase(
    name: string,
    items: number,
    opts: CliOptions,
    run: () => void,
    note: string,
): BenchRow {
    for (let i = 0; i < opts.warmups; i++) {
        run();
    }

    const samplesMs: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
        const start = performance.now();
        run();
        samplesMs.push(performance.now() - start);
    }

    const medianMs = median(samplesMs);
    const meanMs = samplesMs.reduce((sum, sample) => sum + sample, 0) / samplesMs.length;
    const minMs = Math.min(...samplesMs);
    const maxMs = Math.max(...samplesMs);

    return {
        name,
        items,
        medianMs,
        meanMs,
        minMs,
        maxMs,
        itemsPerSecond: medianMs === 0 ? Number.POSITIVE_INFINITY : items / (medianMs / 1000),
        samplesMs,
        note,
    };
}

/**
 * Return median of a numeric list.
 *
 * @param values input values.
 * @returns median.
 */
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

/**
 * Render the markdown report.
 *
 * @param payload report payload.
 * @returns markdown text.
 */
function renderReport(payload: ReportPayload): string {
    const lines: string[] = [];
    lines.push('# Phase G CLI Migrate Max-Speed Bench', '');
    lines.push(`Generated: ${payload.generated}`);
    lines.push(`Node: ${payload.node}`);
    lines.push(`Platform: ${payload.platform}`);
    lines.push(
        `Options: sizes=${payload.options.sizes.join(',')}, iterations=${payload.options.iterations}, warmups=${payload.options.warmups}`,
        '',
    );

    lines.push('## Summary', '');
    for (const size of payload.options.sizes) {
        const repeated = findRow(payload.rows, `cli-migrate/${size}/reverse-repeated`);
        const unique = findRow(payload.rows, `cli-migrate/${size}/reverse-unique`);
        const astStatic = findRow(payload.rows, `cli-migrate/${size}/ast-static`);
        const astDynamic = findRow(payload.rows, `cli-migrate/${size}/ast-dynamic`);

        if (repeated && unique) {
            lines.push(
                `- ${size} reverse parser rows: repeated=${formatMs(repeated.medianMs)} median, unique=${formatMs(unique.medianMs)} median (${formatRatio(unique.medianMs / repeated.medianMs)}x unique/repeated).`,
            );
        }
        if (astStatic && astDynamic) {
            lines.push(
                `- ${size} AST migration rows: static=${formatMs(astStatic.medianMs)} median, dynamic=${formatMs(astDynamic.medianMs)} median (${formatRatio(astDynamic.medianMs / astStatic.medianMs)}x dynamic/static).`,
            );
        }
    }
    lines.push('');

    lines.push('## Rows', '');
    lines.push('| Case | Items | Median ms | Mean ms | Min ms | Max ms | Items/sec | Note |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
    for (const row of payload.rows) {
        lines.push(
            `| \`${row.name}\` | ${row.items} | ${formatNumber(row.medianMs)} | ${formatNumber(row.meanMs)} | ${formatNumber(row.minMs)} | ${formatNumber(row.maxMs)} | ${formatNumber(row.itemsPerSecond)} | ${row.note} |`,
        );
    }
    lines.push('');

    lines.push('## Notes', '');
    lines.push(
        '- This harness measures migration-tool cost only; it does not measure csszyx build-time `sz` compilation.',
    );
    lines.push(
        '- `reverse-repeated` is the common design-system migration shape where the same Tailwind tokens appear across many components.',
    );
    lines.push(
        '- `reverse-unique` protects against optimizations that only help repeated tokens but harm arbitrary-value-heavy projects.',
    );

    return `${lines.join('\n')}\n`;
}

/**
 * Find a row by name.
 *
 * @param rows all rows.
 * @param name row name.
 * @returns matching row.
 */
function findRow(rows: BenchRow[], name: string): BenchRow | undefined {
    return rows.find(row => row.name === name);
}

/**
 * Format milliseconds in prose.
 *
 * @param value millisecond value.
 * @returns formatted value.
 */
function formatMs(value: number): string {
    return `${formatNumber(value)}ms`;
}

/**
 * Format numeric values for reports.
 *
 * @param value numeric value.
 * @returns formatted value.
 */
function formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return 'Infinity';
    }
    if (Math.abs(value) >= 100) {
        return value.toFixed(1);
    }
    if (Math.abs(value) >= 10) {
        return value.toFixed(2);
    }
    return value.toFixed(3);
}

/**
 * Format a ratio for prose.
 *
 * @param value ratio value.
 * @returns formatted ratio.
 */
function formatRatio(value: number): string {
    if (!Number.isFinite(value)) {
        return 'n/a';
    }
    return value.toFixed(2);
}
