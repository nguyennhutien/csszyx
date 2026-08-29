/**
 * A synthetic repository shaped like the ones that break benchmarks.
 *
 * Every measurement this project took on uniform fixtures reached a wrong
 * conclusion at least once: files of one size cannot tell a chunking strategy
 * by count from one by bytes; files whose classes all resolve never touch the
 * accumulator for the ones that do not; modules with no barrel never reach the
 * parser gate that admitted 92 % of them; and components with no dynamic value
 * never exercise the variable-mangle map that grew quadratically. This
 * generator holds all of those at once, deterministically, so a benchmark can
 * be run on the shape a repository nobody has refactored actually has.
 *
 * Usage:
 *   node --import tsx/esm scripts/chaos-repo-fixture.ts <dir> [files] [seed]
 *
 * @module
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What to generate. */
export interface ChaosRepoOptions {
    /** How many component files. */
    files: number;
    /** Generator seed; the same seed yields byte-identical output. */
    seed?: number;
    /** Distinct legacy (unrecognised) class names to draw from. */
    legacyVocabulary?: number;
    /** One barrel and one provider pair per this many components. */
    groupSize?: number;
}

/** One generated file. */
export interface ChaosRepoFile {
    /** Path relative to the repository root, POSIX separators. */
    path: string;
    /** File contents. */
    source: string;
}

/** What the generator produced, for a benchmark to print beside its numbers. */
export interface ChaosRepoStats {
    files: number;
    bytes: number;
    medianBytes: number;
    p99Bytes: number;
    maxBytes: number;
    /** Share of all bytes carried by the largest 1 % of files. */
    topOnePercentShare: number;
    barrels: number;
    providers: number;
    /** Occurrences of legacy class names across every component. */
    unrecognisedOccurrences: number;
}

/**
 * @param seed - Starting state.
 * @returns A deterministic generator of numbers in [0, 1).
 */
function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * A heavy-tailed file size: most files small, a few carrying most of the
 * bytes - pages and small components at the bottom, generated or God files
 * nobody dared split at the top.
 *
 * @param next - The generator.
 * @returns A size in bytes.
 */
function chaosSize(next: () => number): number {
    const roll = next();
    if (roll < 0.85) return Math.round(200 + next() * 1800);
    if (roll < 0.97) return Math.round(2000 + next() * 18000);
    if (roll < 0.995) return Math.round(20000 + next() * 180000);
    return Math.round(200000 + next() * 1300000);
}

/**
 * @param distinct - Vocabulary size.
 * @returns Legacy class names no map resolves.
 */
function legacyPool(distinct: number): string[] {
    const blocks = ['btn', 'card', 'nav', 'hero', 'panel', 'modal', 'grid', 'form'];
    return Array.from(
        { length: distinct },
        (_, index) => `${blocks[index % blocks.length]}__element--modifier-${index}`,
    );
}

/**
 * One component: dynamic sz values (so the variable-mangle map is fed), an
 * import from its group's provider (so the demand pass reads it), utility
 * classes that resolve and legacy ones that do not.
 *
 * @param index - Component number.
 * @param group - Group number, naming the provider and barrel it belongs to.
 * @param targetBytes - Rough size.
 * @param pool - Legacy class names.
 * @param next - The generator.
 * @returns Source text and how many legacy occurrences it holds.
 */
function component(
    index: number,
    group: number,
    targetBytes: number,
    pool: string[],
    next: () => number,
): { source: string; occurrences: number } {
    const head =
        `import React from 'react';\n` +
        `import { cardSz } from './tokens${group}';\n\n` +
        `export function Card${index}({ w, color, active }: { w: number; color: string; active: boolean }) {\n` +
        `    return (\n        <div sz={{ w, p: 4, bg: color, hover: { opacity: 0.5 } }} className="flex gap-4 rounded-lg border p-6">\n`;
    const tail = `        </div>\n    );\n}\n`;
    let body = '';
    let occurrences = 0;
    // At least one row, so even the smallest file carries a legacy class and a
    // second dynamic value; then rows until the target size is reached.
    do {
        const legacy = Array.from({ length: 4 }, () => pool[Math.floor(next() * pool.length)]);
        occurrences += legacy.length + 1;
        body +=
            `            <div className="flex items-center gap-3 ${legacy.join(' ')}">\n` +
            `                <span sz={{ color, mt: active ? 2 : 4 }} className="text-sm font-medium ${pool[Math.floor(next() * pool.length)]}">Row</span>\n` +
            `                <span sz={cardSz}>Card</span>\n` +
            `            </div>\n`;
    } while (head.length + body.length + tail.length < targetBytes);
    return { source: head + body + tail, occurrences };
}

/**
 * Generate the repository's files, God files clustered as a directory that
 * grew them would cluster them.
 *
 * @param options - What to generate.
 * @returns The files in the order a walk would meet them, plus their stats.
 */
export function chaosRepoFiles(options: ChaosRepoOptions): {
    files: ChaosRepoFile[];
    stats: ChaosRepoStats;
} {
    const seed = options.seed ?? 7;
    const groupSize = options.groupSize ?? 25;
    const next = random(seed);
    const pool = legacyPool(options.legacyVocabulary ?? 200);
    // Sizes are drawn first and sorted, so the largest files sit together at
    // the end of the walk instead of being spread across it.
    const sizes = Array.from({ length: options.files }, () => chaosSize(next)).sort(
        (a, b) => a - b,
    );
    const files: ChaosRepoFile[] = [];
    let bytes = 0;
    let occurrences = 0;
    const groups = Math.ceil(options.files / groupSize);
    for (let index = 0; index < options.files; index++) {
        const group = Math.floor(index / groupSize);
        const { source, occurrences: found } = component(
            index,
            group,
            sizes[index] ?? 0,
            pool,
            next,
        );
        occurrences += found;
        bytes += source.length;
        files.push({ path: `src/Card${String(index).padStart(6, '0')}.tsx`, source });
    }
    for (let group = 0; group < groups; group++) {
        const first = group * groupSize;
        const last = Math.min(first + groupSize, options.files) - 1;
        // A provider: one static sz object and one szv factory, the two
        // registry kinds the prescan's demand pass reads.
        const provider =
            `import { szv } from '@csszyx/runtime';\n\n` +
            `export const cardSz = { p: 4, rounded: 'lg', bg: 'white' } as const;\n` +
            `export const badgeSz = szv({ base: { px: 2, text: 'xs' }, variants: { tone: { info: { bg: 'blue-100' }, warn: { bg: 'amber-100' } } } });\n`;
        // A barrel in both forward shapes: the re-export clause and the
        // imported binding exported by name.
        const barrel =
            `import { Card${String(first).padStart(0, '0')} } from './Card${String(first).padStart(6, '0')}';\n` +
            `export { Card${first} };\n` +
            `export { Card${last} as Last${group} } from './Card${String(last).padStart(6, '0')}';\n` +
            `export { cardSz, badgeSz } from './tokens${group}';\n`;
        files.push({ path: `src/tokens${group}.ts`, source: provider });
        files.push({ path: `src/index${group}.ts`, source: barrel });
        bytes += provider.length + barrel.length;
    }
    const sorted = [...sizes];
    const top = sorted
        .slice(-Math.max(1, Math.ceil(options.files * 0.01)))
        .reduce((sum, size) => sum + size, 0);
    return {
        files,
        stats: {
            files: files.length,
            bytes,
            medianBytes: sorted[Math.floor(sorted.length / 2)] ?? 0,
            p99Bytes: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0,
            maxBytes: sorted[sorted.length - 1] ?? 0,
            topOnePercentShare:
                top /
                Math.max(
                    1,
                    sorted.reduce((sum, size) => sum + size, 0),
                ),
            barrels: groups,
            providers: groups,
            unrecognisedOccurrences: occurrences,
        },
    };
}

/**
 * Write the repository to disk.
 *
 * @param dir - Target directory, created if missing.
 * @param options - What to generate.
 * @returns The stats.
 */
export function writeChaosRepo(dir: string, options: ChaosRepoOptions): ChaosRepoStats {
    const { files, stats } = chaosRepoFiles(options);
    for (const file of files) {
        const target = join(dir, file.path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.source);
    }
    return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const [dir, files = '2000', seed = '7'] = process.argv.slice(2);
    if (!dir) {
        console.error('usage: chaos-repo-fixture.ts <dir> [files] [seed]');
        process.exit(1);
    }
    console.log(JSON.stringify(writeChaosRepo(dir, { files: Number(files), seed: Number(seed) })));
}
