#!/usr/bin/env node
// Patch coverage, measured where the change is made instead of after it lands.
//
// Codecov reports this on every pull request and nothing here reproduced it, so
// the first time an author learns a changed line is untested is after a push.
// The rule the project already holds itself to — 100% of changed lines covered,
// measured before pushing — had no runnable check behind it.
//
// The measurement is the intersection of two things this repository already
// produces: the lines a diff touches, and the lines the coverage run recorded.
// Both come from files on disk, so nothing here talks to a service.
//
// Usage:
//   node scripts/check-patch-coverage.mjs [--base=<ref>] [--report=<lcov>]...
//
// Run the coverage suites first — `pnpm test:coverage` and `pnpm cov:rust` —
// or the reports describe an older tree than the diff does.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Reports read when none are named. Each is written by a coverage script. */
const DEFAULT_REPORTS = [
    'coverage/lcov.info',
    'coverage/rust-lcov.info',
    'packages/ts-plugin/coverage/lcov.info',
];

/**
 * Paths that carry no coverable lines, so a diff touching them proves nothing.
 * Mirrors `vitest.config.ts` — a narrower list here would report a gap in a
 * file the coverage run was never asked to measure.
 */
const UNMEASURED = [
    /(^|\/)tests?\//,
    /\.test\.[cm]?tsx?$/,
    /\.type-test\.ts$/,
    /\.d\.ts$/,
    /(^|\/)scripts\//,
    /^packages\/e2e\//,
    /^packages\/types\//,
    /^packages\/vscode\/src\/extension\.ts$/,
];

/** Extensions the coverage runs instrument. Anything else is not measurable. */
const MEASURED_EXTENSION = /\.(?:[cm]?tsx?|rs)$/;

/**
 * Resolve an lcov source path to one the diff also uses.
 *
 * lcov records paths relative to wherever the coverage tool ran, and this
 * repository runs coverage in two places: once at the root and once inside
 * `packages/ts-plugin`, whose report therefore says `src/…` for a file the
 * diff calls `packages/ts-plugin/src/…`. Keying on the raw path silently
 * matched nothing for that package, which reads as full coverage.
 *
 * @param source - Path as written in the report.
 * @param report - Path of the report it came from.
 * @returns Repo-relative source path.
 */
export function repoRelativeSource(source, report) {
    // `<pkg>/coverage/lcov.info` describes files under `<pkg>`; a root report
    // sits in `coverage/`, whose parent is the root, so one rule covers both.
    const reportRoot = path.resolve(path.dirname(report), '..');
    for (const candidate of [path.resolve(reportRoot, source), path.resolve(source)]) {
        if (existsSync(candidate)) return path.relative(process.cwd(), candidate);
    }
    // Unresolvable: keep the raw path so the file is still reported rather than
    // quietly dropped into a bucket nothing compares against.
    return source;
}

/**
 * Read one lcov report into covered and uncovered line numbers per file.
 *
 * @param file - Path to an lcov report.
 * @returns Repo-relative source path mapped to its recorded lines.
 */
function readLcov(file) {
    const records = new Map();
    let current = null;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.startsWith('SF:')) {
            const source = repoRelativeSource(line.slice(3).trim(), file);
            current = records.get(source);
            if (current === undefined) {
                current = { covered: new Set(), uncovered: new Set() };
                records.set(source, current);
            }
            continue;
        }
        if (current === null || !line.startsWith('DA:')) continue;
        const [rawLine, rawHits] = line.slice(3).split(',');
        const lineNumber = Number(rawLine);
        if (!Number.isInteger(lineNumber)) continue;
        // A line recorded as covered by ANY report stays covered: the rust and
        // TypeScript runs describe different files, and ts-plugin measures its
        // own package that the root run deliberately skips. Reading them as one
        // set is what makes "covered somewhere" the answer.
        if (Number(rawHits) > 0) {
            current.covered.add(lineNumber);
            current.uncovered.delete(lineNumber);
        } else if (!current.covered.has(lineNumber)) {
            current.uncovered.add(lineNumber);
        }
    }
    return records;
}

/**
 * Line numbers each file gained or changed, relative to a base revision.
 *
 * @param base - Revision to compare against.
 * @returns Repo-relative path mapped to the set of added or changed lines.
 */
export function changedLines(base) {
    const diff = execFileSync('git', ['diff', '-U0', `${base}...HEAD`], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return parseDiffHunks(diff);
}

/**
 * Read added-line numbers out of a unified diff produced with zero context.
 *
 * Split out so the hunk arithmetic is testable without a repository: the `+`
 * side of a hunk header names the first added line and how many follow, and a
 * header with no count is one line.
 *
 * @param diff - Unified diff text.
 * @returns Repo-relative path mapped to the set of added or changed lines.
 */
export function parseDiffHunks(diff) {
    const perFile = new Map();
    let file = null;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            file = target === '/dev/null' ? null : target.replace(/^b\//, '');
            if (file !== null && !perFile.has(file)) perFile.set(file, new Set());
            continue;
        }
        if (file === null || !line.startsWith('@@')) continue;
        const header = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (header === null) continue;
        const start = Number(header[1]);
        const count = header[2] === undefined ? 1 : Number(header[2]);
        for (let offset = 0; offset < count; offset++) perFile.get(file).add(start + offset);
    }
    return perFile;
}

/**
 * Whether a changed file carries lines a coverage run would record.
 *
 * @param file - Repo-relative path.
 * @returns True when the file should be measured.
 */
export function isMeasurable(file) {
    if (!MEASURED_EXTENSION.test(file)) return false;
    return !UNMEASURED.some(pattern => pattern.test(file));
}

/**
 * Compare a diff against coverage reports and print what the diff left untested.
 *
 * @param options - Base revision and report paths.
 * @returns Process exit code.
 */
function main({ base, reports }) {
    const present = reports.filter(report => existsSync(report));
    if (present.length === 0) {
        console.error(
            `[patch-coverage] no coverage report found (looked for ${reports.join(', ')}).\n` +
                'Run `pnpm test:coverage` and `pnpm cov:rust` first — without them this ' +
                'check would pass by having nothing to read, which is worse than not running.',
        );
        return 1;
    }

    const recorded = new Map();
    for (const report of present) {
        for (const [file, lines] of readLcov(report)) {
            const merged = recorded.get(file);
            if (merged === undefined) {
                recorded.set(file, lines);
                continue;
            }
            for (const line of lines.covered) {
                merged.covered.add(line);
                merged.uncovered.delete(line);
            }
            for (const line of lines.uncovered) {
                if (!merged.covered.has(line)) merged.uncovered.add(line);
            }
        }
    }

    const gaps = [];
    const unmeasured = [];
    let changedCount = 0;
    for (const [file, lines] of changedLines(base)) {
        if (!isMeasurable(file)) continue;
        const record = recorded.get(file);
        if (record === undefined) {
            // Present in the diff, absent from every report: a source file the
            // coverage run never loaded, which is a zero rather than a pass.
            unmeasured.push(file);
            continue;
        }
        const missed = [...lines].filter(line => record.uncovered.has(line)).sort((a, b) => a - b);
        changedCount += [...lines].filter(
            line => record.uncovered.has(line) || record.covered.has(line),
        ).length;
        if (missed.length > 0) gaps.push({ file, missed });
    }

    console.log(
        `[patch-coverage] ${changedCount} changed coverable line(s) against ${base}, ` +
            `read from ${present.length} report(s).`,
    );

    for (const file of unmeasured) {
        console.error(`  ${file}: changed, and no coverage report mentions it`);
    }
    for (const { file, missed } of gaps) {
        console.error(`  ${file}: uncovered changed line(s) ${missed.join(',')}`);
    }

    if (gaps.length === 0 && unmeasured.length === 0) {
        console.log('[patch-coverage] Every changed line is covered.');
        return 0;
    }
    console.error(
        '\n✖ Changed lines are not covered. Add the test, or state the reason in ' +
            'review — this is the same measurement Codecov reports on the pull request.',
    );
    return 1;
}

/**
 * Read the command line.
 *
 * @param argv - Arguments after the script name.
 * @returns Base revision and report paths.
 */
export function parseArgs(argv) {
    let base = 'origin/main';
    const reports = [];
    for (const arg of argv) {
        if (arg.startsWith('--base=')) base = arg.slice('--base='.length);
        else if (arg.startsWith('--report=')) reports.push(arg.slice('--report='.length));
    }
    return { base, reports: reports.length > 0 ? reports : DEFAULT_REPORTS };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    process.exitCode = main(parseArgs(process.argv.slice(2)));
}
