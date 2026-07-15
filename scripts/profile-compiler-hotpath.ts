#!/usr/bin/env tsx
/**
 * Profile csszyx compiler hot paths before adding any memoization.
 *
 * Phase A for roadmap item #25. This script is intentionally read-only:
 * it measures existing `transformSourceCode()` behavior against local source
 * files and synthetic `sz={{...}}` fixtures derived from pinned corpus-combo
 * snapshots.
 *
 * Usage:
 *   pnpm compiler:profile-hotpath
 *   pnpm compiler:profile-hotpath -- --iterations 5 --corpus flowbite,shadcn
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { transform, transformSourceCode } from '../packages/compiler/src/transform.js';
import {
    PROPERTY_MAP,
    type SzObject,
    type SzValue,
} from '../packages/compiler/src/transform-core.js';

/**
 * CLI options for the profiler.
 */
interface CliOptions {
    /** Number of measured transform iterations per file/fixture. */
    iterations: number;
    /** Corpus-combo snapshot names to convert into synthetic sz fixtures. */
    corpus: string[];
    /** Source roots scanned for real sz usage. */
    sourceRoots: string[];
}

/**
 * Per-file transform timing and pattern reuse metrics.
 */
interface TransformTiming {
    /** Relative file or fixture label. */
    file: string;
    /** Average transform time in milliseconds. */
    ms: number;
    /** Number of sz attributes found in this file/fixture. */
    occurrences: number;
    /** Number of unique normalized sz patterns in this file/fixture. */
    uniquePatterns: number;
    /** Whether the compiler transformed the file/fixture. */
    transformed: boolean;
}

/**
 * Synthetic TSX fixture generated from a corpus-combo snapshot.
 */
interface CorpusFixture {
    /** Corpus name. */
    name: string;
    /** Generated TSX source. */
    source: string;
    /** Generated sz object literals. */
    patterns: string[];
    /** Source class-combo lines read from the snapshot. */
    sourceLines: number;
    /** Lines skipped because they could not be safely converted. */
    skippedLines: number;
}

/**
 * Result of converting one class combo into an sz object.
 */
interface CorpusConversion {
    /** Converted sz object. */
    object: SzObject;
    /** Tokens that had no exact sz equivalent. */
    skippedTokens: string[];
    /** Duplicate/conflicting property assignments. */
    conflictCount: number;
}

/**
 * Transform result with a diagnostic flag.
 */
interface QuietTransformResult {
    /** Generated className. */
    className: string;
    /** True when the compiler emitted a warning while transforming. */
    warned: boolean;
}

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js']);
const IGNORE_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.git',
    'pkg',
    'pkg-node',
    'target',
]);
const DEFAULT_SOURCE_ROOTS = ['playground', 'apps/docs/src', 'packages'];
const DEFAULT_CORPUS = ['flowbite', 'shadcn', 'tremor', 'radix', 'catalyst'];

const prefixToKeys = new Map<string, string[]>();
for (const [szKey, twPrefix] of Object.entries(PROPERTY_MAP)) {
    const keys = prefixToKeys.get(twPrefix) ?? [];
    keys.push(szKey);
    prefixToKeys.set(twPrefix, keys);
}
const sortedPrefixes = [...prefixToKeys.keys()].sort((a, b) => b.length - a.length);

/**
 * Parse CLI options.
 * @returns parsed options
 */
function readOptions(): CliOptions {
    const args = process.argv.slice(2);
    const options: CliOptions = {
        iterations: 3,
        corpus: DEFAULT_CORPUS,
        sourceRoots: DEFAULT_SOURCE_ROOTS,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--iterations') {
            options.iterations = Math.max(1, Number(args[++i] ?? '3'));
        } else if (arg === '--corpus') {
            options.corpus = (args[++i] ?? '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        } else if (arg === '--source-roots') {
            options.sourceRoots = (args[++i] ?? '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        }
    }

    return options;
}

/**
 * Recursively list source files under the given roots.
 * @param roots relative or absolute roots
 * @returns source file paths
 */
function listSourceFiles(roots: string[]): string[] {
    const files: string[] = [];

    /**
     * Walk one directory.
     * @param dir directory to walk
     */
    function walk(dir: string): void {
        let entries: Dirent[];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) {
                continue;
            }
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && SOURCE_EXTS.has(full.slice(full.lastIndexOf('.')))) {
                files.push(full);
            }
        }
    }

    for (const root of roots) {
        const full = resolve(REPO_ROOT, root);
        if (existsSync(full) && statSync(full).isDirectory()) {
            walk(full);
        }
    }

    return files.sort();
}

/**
 * Extract `sz=` attribute values with a small balanced scanner.
 * @param code source code
 * @returns normalized sz patterns
 */
function extractSzPatterns(code: string): string[] {
    const patterns: string[] = [];
    const re = /\bsz\s*=/g;
    for (const match of code.matchAll(re)) {
        let i = (match.index ?? 0) + match[0].length;
        while (i < code.length && /\s/.test(code[i])) {
            i++;
        }
        const quote = code[i];
        if (quote === '"' || quote === "'") {
            const end = readQuoted(code, i);
            if (end > i) {
                patterns.push(normalizePattern(code.slice(i, end)));
                re.lastIndex = end;
            }
            continue;
        }
        if (code[i] === '{') {
            const end = readBalanced(code, i);
            if (end > i) {
                patterns.push(normalizePattern(code.slice(i, end)));
                re.lastIndex = end;
            }
        }
    }

    return patterns;
}

/**
 * Read one quoted string literal.
 * @param code source code
 * @param start opening quote offset
 * @returns offset after closing quote, or start on failure
 */
function readQuoted(code: string, start: number): number {
    const quote = code[start];
    let escaped = false;
    for (let i = start + 1; i < code.length; i++) {
        const ch = code[i];
        if (escaped) {
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (ch === quote) {
            return i + 1;
        }
    }
    return start;
}

/**
 * Read one balanced expression container.
 * @param code source code
 * @param start opening brace offset
 * @returns offset after closing brace, or start on failure
 */
function readBalanced(code: string, start: number): number {
    let depth = 0;
    for (let i = start; i < code.length; i++) {
        const ch = code[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            const end = readQuoted(code, i);
            if (end === i) {
                return start;
            }
            i = end - 1;
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return i + 1;
            }
        }
    }
    return start;
}

/**
 * Normalize a pattern for cache-hit estimation.
 * @param pattern raw pattern source
 * @returns whitespace-normalized pattern
 */
function normalizePattern(pattern: string): string {
    return pattern.replace(/\s+/g, ' ').trim();
}

/**
 * Profile real source files that contain an `sz` token.
 * @param files source files
 * @param iterations measured iterations per file
 * @returns transform timings
 */
function profileSourceFiles(files: string[], iterations: number): TransformTiming[] {
    const timings: TransformTiming[] = [];
    for (const file of files) {
        const code = readFileSync(file, 'utf-8');
        if (!code.includes('sz')) {
            continue;
        }
        const patterns = extractSzPatterns(code);
        const start = performance.now();
        let transformed = false;
        for (let i = 0; i < iterations; i++) {
            transformed =
                withSilencedWarnings(() => transformSourceCode(code, file).transformed) ||
                transformed;
        }
        const ms = (performance.now() - start) / iterations;
        timings.push({
            file: relative(REPO_ROOT, file),
            ms,
            occurrences: patterns.length,
            uniquePatterns: new Set(patterns).size,
            transformed,
        });
    }
    return timings;
}

/**
 * Build synthetic source fixtures from corpus-combo snapshots.
 * @param corpusNames corpus names to load
 * @returns converted corpus fixtures
 */
function buildCorpusFixtures(corpusNames: string[]): CorpusFixture[] {
    const fixtures: CorpusFixture[] = [];
    for (const name of corpusNames) {
        const file = join(REPO_ROOT, 'scripts', 'corpus-combo', `${name}.txt`);
        if (!existsSync(file)) {
            continue;
        }

        const lines = readFileSync(file, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        const snippets: string[] = [];
        const patterns: string[] = [];
        let skippedLines = 0;

        lines.forEach((line, index) => {
            const converted = classComboToSzObject(line);
            if (!converted || converted.skippedTokens.length > 0 || converted.conflictCount > 0) {
                skippedLines++;
                return;
            }
            const literal = stringifySzObject(converted.object);
            patterns.push(literal);
            snippets.push(`export const ${name}_${index} = <div sz={${literal}} />;`);
        });

        fixtures.push({
            name,
            source: snippets.join('\n'),
            patterns,
            sourceLines: lines.length,
            skippedLines,
        });
    }

    return fixtures;
}

/**
 * Convert a Tailwind class combo into a best-effort sz object.
 * @param combo Tailwind class list from corpus-combo
 * @returns converted object and skip metadata
 */
function classComboToSzObject(combo: string): CorpusConversion | null {
    const object: SzObject = {};
    const skippedTokens: string[] = [];
    let conflictCount = 0;

    for (const token of combo.split(/\s+/).filter(Boolean)) {
        const converted = classTokenToEntry(token);
        if (!converted) {
            skippedTokens.push(token);
            continue;
        }
        const hadConflict = !assignEntry(object, converted.path, converted.value);
        if (hadConflict) {
            conflictCount++;
        }
    }

    return { object, skippedTokens, conflictCount };
}

/**
 * Convert one class token to a nested object path.
 * @param token Tailwind class token
 * @returns object path and value, or null when unsupported
 */
function classTokenToEntry(token: string): { path: string[]; value: SzValue } | null {
    const parts = token.split(':');
    const base = parts.pop();
    if (!base) {
        return null;
    }
    const baseEntry = baseClassToEntry(base);
    if (!baseEntry) {
        return null;
    }
    return {
        path: [...parts, baseEntry.key],
        value: baseEntry.value,
    };
}

/**
 * Check whether one sz entry reproduces a Tailwind class without diagnostics.
 * @param key Candidate sz property.
 * @param value Candidate sz value.
 * @param twClass Expected Tailwind class.
 * @returns True when the compiler produces the exact class.
 */
function reproducesClass(key: string, value: SzValue, twClass: string): boolean {
    try {
        const result = transformQuiet({ [key]: value });
        return !result.warned && result.className === twClass;
    } catch {
        return false;
    }
}

/**
 * Find the first sz property for a mapped prefix that reproduces a class.
 * @param prefix Tailwind prefix mapped from sz properties.
 * @param value Candidate sz value.
 * @param twClass Expected Tailwind class.
 * @returns Matching sz property, or undefined when none is exact.
 */
function findMatchingKey(prefix: string, value: SzValue, twClass: string): string | undefined {
    return prefixToKeys.get(prefix)?.find(candidate => reproducesClass(candidate, value, twClass));
}

/**
 * Convert a non-variant Tailwind class to an sz key/value pair.
 * @param twClass Tailwind utility without variants
 * @returns sz key/value pair, or null when unsupported
 */
function baseClassToEntry(twClass: string): { key: string; value: SzValue } | null {
    if (!twClass.includes('-') && reproducesClass(twClass, true, twClass)) {
        return { key: twClass, value: true };
    }

    for (const prefix of sortedPrefixes) {
        const sep = `${prefix}-`;
        if (twClass === prefix) {
            const key = findMatchingKey(prefix, true, twClass);
            return key ? { key, value: true } : null;
        }
        if (!twClass.startsWith(sep)) {
            continue;
        }
        const rawValue = twClass.slice(sep.length);
        const value = parseValue(rawValue);
        const key = findMatchingKey(prefix, value, twClass);
        return key ? { key, value } : null;
    }

    return null;
}

/**
 * Parse a Tailwind suffix into the closest sz value.
 * @param value raw Tailwind suffix
 * @returns number or string value
 */
function parseValue(value: string): string | number {
    const numberValue = Number(value);
    return !Number.isNaN(numberValue) && value !== '' ? numberValue : value;
}

/**
 * Assign a nested key path into an sz object.
 * @param target object to mutate
 * @param pathParts nested path
 * @param value value to assign
 * @returns true when assigned without conflict
 */
function assignEntry(target: SzObject, pathParts: string[], value: SzValue): boolean {
    let node: Record<string, unknown> = target as Record<string, unknown>;
    for (let i = 0; i < pathParts.length - 1; i++) {
        const key = pathParts[i];
        const existing = node[key];
        if (
            existing !== undefined &&
            (typeof existing !== 'object' || existing === null || Array.isArray(existing))
        ) {
            return false;
        }
        if (existing === undefined) {
            node[key] = {};
        }
        node = node[key] as Record<string, unknown>;
    }
    const leaf = pathParts[pathParts.length - 1];
    if (node[leaf] !== undefined) {
        return false;
    }
    node[leaf] = value;
    return true;
}

/**
 * Serialize an sz object as a stable object literal.
 * @param value value to stringify
 * @returns TypeScript object literal
 */
function stringifySzObject(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stringifySzObject).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}: ${stringifySzObject(child)}`);
        return `{ ${entries.join(', ')} }`;
    }
    return JSON.stringify(value);
}

/**
 * Profile generated corpus fixtures.
 * @param fixtures fixtures to profile
 * @param iterations measured iterations per fixture
 * @returns transform timings
 */
function profileCorpusFixtures(fixtures: CorpusFixture[], iterations: number): TransformTiming[] {
    return fixtures
        .filter(fixture => fixture.source.trim())
        .map(fixture => {
            const start = performance.now();
            let transformed = false;
            for (let i = 0; i < iterations; i++) {
                transformed =
                    withSilencedWarnings(
                        () =>
                            transformSourceCode(fixture.source, `${fixture.name}.tsx`).transformed,
                    ) || transformed;
            }
            return {
                file: `corpus-combo/${fixture.name}`,
                ms: (performance.now() - start) / iterations,
                occurrences: fixture.patterns.length,
                uniquePatterns: new Set(fixture.patterns).size,
                transformed,
            };
        });
}

/**
 * Compute summary metrics for timings.
 * @param timings timings to summarize
 * @returns summary numbers
 */
function summarize(timings: TransformTiming[]): {
    files: number;
    transformed: number;
    totalMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    occurrences: number;
    uniquePatterns: number;
    estimatedHitRate: number;
} {
    const sorted = timings.map(t => t.ms).sort((a, b) => a - b);
    const occurrences = timings.reduce((sum, t) => sum + t.occurrences, 0);
    const uniquePatterns = timings.reduce((sum, t) => sum + t.uniquePatterns, 0);
    const totalMs = timings.reduce((sum, t) => sum + t.ms, 0);
    return {
        files: timings.length,
        transformed: timings.filter(t => t.transformed).length,
        totalMs,
        avgMs: timings.length > 0 ? totalMs / timings.length : 0,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        occurrences,
        uniquePatterns,
        estimatedHitRate: occurrences > 0 ? 1 - uniquePatterns / occurrences : 0,
    };
}

/**
 * Read a percentile from sorted values.
 * @param sorted sorted numbers
 * @param pct percentile from 0-100
 * @returns percentile value
 */
function percentile(sorted: number[], pct: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
    );
    return sorted[index];
}

/**
 * Format milliseconds.
 * @param value milliseconds
 * @returns formatted string
 */
function fmtMs(value: number): string {
    return `${value.toFixed(2)}ms`;
}

/**
 * Format percent.
 * @param value 0-1 percentage value
 * @returns formatted percent
 */
function fmtPct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

/**
 * Run a function while suppressing compiler diagnostics printed to stderr.
 * @param fn function to execute
 * @returns function result
 */
function withSilencedWarnings<T>(fn: () => T): T {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
        return fn();
    } finally {
        console.warn = originalWarn;
    }
}

/**
 * Transform one sz object and report whether compiler diagnostics fired.
 * @param object sz object to transform
 * @returns className and diagnostic flag
 */
function transformQuiet(object: SzObject): QuietTransformResult {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
        warned = true;
    };
    try {
        return { className: transform(object).className, warned };
    } finally {
        console.warn = originalWarn;
    }
}

/**
 * Print one summary block.
 * @param label block label
 * @param timings timings to print
 */
function printSummary(label: string, timings: TransformTiming[]): void {
    const summary = summarize(timings);
    console.log(`\n${label}`);
    console.log('='.repeat(label.length));
    console.log(`Files/fixtures:       ${summary.files}`);
    console.log(`Transformed:          ${summary.transformed}`);
    console.log(`Transform wall time:  ${fmtMs(summary.totalMs)}`);
    console.log(
        `Avg / p50 / p95:      ${fmtMs(summary.avgMs)} / ${fmtMs(summary.p50Ms)} / ${fmtMs(summary.p95Ms)}`,
    );
    console.log(`sz occurrences:       ${summary.occurrences}`);
    console.log(`Unique patterns:      ${summary.uniquePatterns}`);
    console.log(`Est. cache hit rate:  ${fmtPct(summary.estimatedHitRate)}`);
}

const options = readOptions();
const sourceStart = performance.now();
const sourceFiles = listSourceFiles(options.sourceRoots);
const sourceTimings = profileSourceFiles(sourceFiles, options.iterations);
const sourceElapsed = performance.now() - sourceStart;

const corpusStart = performance.now();
const fixtures = buildCorpusFixtures(options.corpus);
const corpusTimings = profileCorpusFixtures(fixtures, options.iterations);
const corpusElapsed = performance.now() - corpusStart;

console.log('\ncsszyx compiler hot-path profile');
console.log('================================');
console.log(`Iterations:           ${options.iterations}`);
console.log(`Source roots:         ${options.sourceRoots.join(', ')}`);
console.log(`Source scan wall:     ${fmtMs(sourceElapsed)}`);
console.log(`Corpus wall:          ${fmtMs(corpusElapsed)}`);

printSummary('Real source files', sourceTimings);
printSummary('Synthetic corpus-combo sz objects', corpusTimings);

console.log('\nCorpus conversion');
console.log('=================');
for (const fixture of fixtures) {
    console.log(
        `${fixture.name}: ${fixture.patterns.length}/${fixture.sourceLines} converted, ${fixture.skippedLines} skipped`,
    );
}

const combined = summarize([...sourceTimings, ...corpusTimings]);
console.log('\nDecision gate');
console.log('=============');
console.log(`Combined estimated hit rate: ${fmtPct(combined.estimatedHitRate)}`);
console.log(`Combined transform wall:     ${fmtMs(combined.totalMs)}`);
if (combined.estimatedHitRate < 0.3) {
    console.log(
        'Recommendation: drop memoization unless a larger real-app corpus shows materially higher reuse.',
    );
} else {
    console.log(
        'Recommendation: memoization may be worth a Phase B spike; benchmark JSON/stringify key cost first.',
    );
}
